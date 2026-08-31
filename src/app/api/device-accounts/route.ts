import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { canWriteDeviceAccounts, findLivePermissionUser, type PermissionUser } from "../../../lib/permissions";
import { API_LIMITS } from "../../../lib/request-limits";
import { authorizationDenied } from "../../../lib/security-events";

const nullableText = (max: number) =>
  z.string().trim().max(max).nullable().optional();

const accountFields = z.object({
  accountType: z.enum(["NORMAL_WS", "BUSINESS_WS", "RCS", "SIG"]),
  provider: z.string().trim().min(1, "请输入号商").max(80),
  accountNumber: z.string().trim().min(1, "请输入号码").max(80),
  renewalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "续费日期格式不正确")
    .nullable()
    .optional(),
  purpose: nullableText(160),
  situation: nullableText(200),
  phoneCode: nullableText(80),
  followUp: nullableText(300),
  ownerId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
});

const createSchema = accountFields.strict();
const updateSchema = accountFields.extend({ id: z.string().min(1).max(API_LIMITS.identifierCharacters) }).strict();
const deleteSchema = z.object({ id: z.string().min(1).max(API_LIMITS.identifierCharacters) }).strict();

type SupportedUser = {
  id: string;
  role: "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  groupId: string;
};

function toSupportedUser(user: PermissionUser): SupportedUser | null {
  if (!canWriteDeviceAccounts(user)) return null;
  return user as SupportedUser;
}

async function getSupportedUser(): Promise<
  | { user: SupportedUser }
  | { response: NextResponse }
> {
  try {
    const user = await requireUser();
    if (!toSupportedUser(user)) {
      return {
        response: authorizationDenied(user, "当前岗位不能使用设备账号"),
      };
    }
    return { user: toSupportedUser(user)! };
  } catch (error) {
    if (error instanceof AuthenticationError)
      return {
        response: NextResponse.json({ error: error.message }, { status: 401 }),
      };
    throw error;
  }
}

function clean(value: string | null | undefined) {
  return value?.trim() || null;
}

async function resolveOwner(
  user: SupportedUser,
  _requestedOwnerId: string | undefined,
  client: Pick<typeof db, "user"> = db,
) {
  return client.user.findFirst({
    where: {
      id: user.id,
      groupId: user.groupId,
      active: true,
      role: { in: ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] },
    },
    select: { id: true, name: true },
  });
}

function accountScope(user: SupportedUser, id?: string) {
  return {
    ...(id ? { id } : {}),
    groupId: user.groupId,
    ownerId: user.id,
  };
}

export async function GET() {
  try {
    const user = await requireUser();
    if (user.role === "ADMIN") {
      const accounts = await db.deviceAccount.findMany({
        include: {
          group: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true, role: true } },
        },
        orderBy: [
          { renewalDate: { sort: "asc", nulls: "last" } },
          { updatedAt: "desc" },
        ],
      });
      return NextResponse.json({ accounts, readOnly: true });
    }
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  const access = await getSupportedUser();
  if ("response" in access) return access.response;
  const accounts = await db.deviceAccount.findMany({
    where: accountScope(access.user),
    include: { owner: { select: { id: true, name: true, role: true } } },
    orderBy: [
      { renewalDate: { sort: "asc", nulls: "last" } },
      { updatedAt: "desc" },
    ],
  });
  return NextResponse.json({ accounts });
}

export async function POST(request: Request) {
  const access = await getSupportedUser();
  if ("response" in access) return access.response;
  try {
    const input = createSchema.parse(await request.json());
    if (
      input.ownerId &&
      input.ownerId !== access.user.id
    )
      return authorizationDenied(access.user, "只能为自己添加设备账号");
    const result = await db.$transaction(async (transaction) => {
      // 真正落库时再确认一次账号、岗位和小组，不能相信旧会话。
      const liveActor = await findLivePermissionUser(transaction, access.user.id);
      const actor = liveActor && toSupportedUser(liveActor);
      if (!actor) return { error: "当前账号已停用或岗位/小组已变更，不能继续维护设备账号", status: 403 as const };
      if (input.ownerId && input.ownerId !== actor.id) return { error: "只能为自己添加设备账号", status: 403 as const };
      const owner = await resolveOwner(actor, input.ownerId, transaction);
      if (!owner) return { error: "只能选择本组在职人员", status: 400 as const };
      const created = await transaction.deviceAccount.create({
        data: {
          groupId: actor.groupId,
          ownerId: owner.id,
          accountType: input.accountType,
          provider: input.provider.trim(),
          accountNumber: input.accountNumber.trim(),
          renewalDate: input.renewalDate ?? null,
          purpose: clean(input.purpose),
          situation: clean(input.situation),
          phoneCode: clean(input.phoneCode),
          followUp: clean(input.followUp),
        },
        include: { owner: { select: { id: true, name: true, role: true } } },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          action: "DEVICE_ACCOUNT_CREATED",
          entityType: "DeviceAccount",
          entityId: created.id,
          summary: `${created.accountNumber} · ${owner.name}`,
        },
      });
      return { account: created };
    });
    if ("error" in result) return result.status === 403 ? authorizationDenied(access.user, result.error) : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "请检查填写内容" },
        { status: 400 },
      );
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "本组已经存在这个号码" }, { status: 409 });
    throw error;
  }
}

export async function PATCH(request: Request) {
  const access = await getSupportedUser();
  if ("response" in access) return access.response;
  try {
    const input = updateSchema.parse(await request.json());
    if (
      input.ownerId &&
      input.ownerId !== access.user.id
    )
      return authorizationDenied(access.user, "只能维护自己的设备账号");
    const result = await db.$transaction(async (transaction) => {
      const liveActor = await findLivePermissionUser(transaction, access.user.id);
      const actor = liveActor && toSupportedUser(liveActor);
      if (!actor) return { error: "当前账号已停用或岗位/小组已变更，不能继续维护设备账号", status: 403 as const };
      if (input.ownerId && input.ownerId !== actor.id) return { error: "只能维护自己的设备账号", status: 403 as const };
      const existing = await transaction.deviceAccount.findFirst({
        where: accountScope(actor, input.id),
        select: { id: true, ownerId: true },
      });
      if (!existing) return { error: "设备账号不存在或无权修改", status: 404 as const };
      const owner = await resolveOwner(actor, actor.id, transaction);
      if (!owner) return { error: "只能选择本组在职人员", status: 400 as const };
      const updated = await transaction.deviceAccount.update({
        where: { id: existing.id },
        data: {
          ownerId: owner.id,
          accountType: input.accountType,
          provider: input.provider.trim(),
          accountNumber: input.accountNumber.trim(),
          renewalDate: input.renewalDate ?? null,
          purpose: clean(input.purpose),
          situation: clean(input.situation),
          phoneCode: clean(input.phoneCode),
          followUp: clean(input.followUp),
        },
        include: { owner: { select: { id: true, name: true, role: true } } },
      });
      await transaction.auditLog.create({
        data: {
          actorId: actor.id,
          action: "DEVICE_ACCOUNT_UPDATED",
          entityType: "DeviceAccount",
          entityId: updated.id,
          summary: `${updated.accountNumber} · ${owner.name}`,
        },
      });
      return { account: updated };
    });
    if ("error" in result) return result.status === 403 ? authorizationDenied(access.user, result.error) : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "请检查填写内容" },
        { status: 400 },
      );
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "本组已经存在这个号码" }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request) {
  const access = await getSupportedUser();
  if ("response" in access) return access.response;
  const input = deleteSchema.safeParse(await request.json());
  if (!input.success)
    return NextResponse.json({ error: "设备账号参数不正确" }, { status: 400 });
  const result = await db.$transaction(async (transaction) => {
    const liveActor = await findLivePermissionUser(transaction, access.user.id);
    const actor = liveActor && toSupportedUser(liveActor);
    if (!actor) return { error: "当前账号已停用或岗位/小组已变更，不能继续维护设备账号", status: 403 as const };
    const existing = await transaction.deviceAccount.findFirst({
      where: accountScope(actor, input.data.id),
      select: { id: true, accountNumber: true },
    });
    if (!existing) return { error: "设备账号不存在或无权删除", status: 404 as const };
    await transaction.deviceAccount.delete({ where: { id: existing.id } });
    await transaction.auditLog.create({
      data: {
        actorId: actor.id,
        action: "DEVICE_ACCOUNT_DELETED",
        entityType: "DeviceAccount",
        entityId: existing.id,
        summary: existing.accountNumber,
      },
    });
    return { deleted: true };
  });
  if ("error" in result) return result.status === 403 ? authorizationDenied(access.user, result.error) : NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ deleted: true });
}
