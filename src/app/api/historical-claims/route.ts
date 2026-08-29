import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { db } from "../../../lib/db";
import { isCalendarDate, localDateYYYYMMDD } from "../../../lib/dates";
import { entryDateError } from "../../../lib/entry-date-validation";
import { normalizeCustomerPhone } from "../../../lib/entry-ledger";
import { API_LIMITS } from "../../../lib/request-limits";
import { getAssignedRoles, hasAssignedRole } from "../../../lib/role-access";
import { authorizationDenied } from "../../../lib/security-events";
import { getSystemSettings } from "../../../lib/settings";

const claimStages = ["NOT_REPLIED", "REPLIED", "JOINED", "INTRODUCED", "REGISTERED"] as const;
type ClaimStage = (typeof claimStages)[number];

const inputSchema = z.object({
  phone: z.string().trim().min(1, "请输入客户号码").max(80, "客户号码不能超过 80 个字"),
  customerName: z.string().trim().max(100, "客户姓名不能超过 100 个字").optional(),
  channelId: z.string().min(1, "请选择历史渠道").max(API_LIMITS.identifierCharacters),
  baselineStage: z.enum(claimStages),
  baselineOn: z.string().refine(isCalendarDate, "日期必须是实际存在的 YYYY-MM-DD"),
  receptionOwnerId: z.string().min(1, "请选择接粉归属").max(API_LIMITS.identifierCharacters),
  groupOperatorOwnerId: z.string().max(API_LIMITS.identifierCharacters).optional(),
  expertOwnerId: z.string().max(API_LIMITS.identifierCharacters).optional(),
  notes: z.string().trim().max(1_000, "备注不能超过 1,000 个字").optional(),
}).superRefine((value, context) => {
  const rank = claimStages.indexOf(value.baselineStage);
  if (rank >= claimStages.indexOf("JOINED") && !value.groupOperatorOwnerId)
    context.addIssue({ code: "custom", path: ["groupOperatorOwnerId"], message: "已进群客户必须选择炒群归属" });
  if (rank >= claimStages.indexOf("INTRODUCED") && !value.expertOwnerId)
    context.addIssue({ code: "custom", path: ["expertOwnerId"], message: "已推专家客户必须选择专家归属" });
});

function claimRoleFor(stage: ClaimStage) {
  if (stage === "NOT_REPLIED" || stage === "REPLIED") return "RECEPTION" as const;
  if (stage === "JOINED") return "GROUP_OPERATOR" as const;
  return "EXPERT" as const;
}

function claimedOwnerId(input: z.infer<typeof inputSchema>) {
  const role = claimRoleFor(input.baselineStage);
  if (role === "RECEPTION") return input.receptionOwnerId;
  if (role === "GROUP_OPERATOR") return input.groupOperatorOwnerId;
  return input.expertOwnerId;
}

async function sessionActor() {
  try { return { actor: await requireUser(), error: null } as const; }
  catch (error) {
    if (error instanceof AuthenticationError)
      return { actor: null, error: NextResponse.json({ error: "请先登录" }, { status: 401 }) } as const;
    throw error;
  }
}

/**
 * 各岗位认领仍需继续处理的历史客户。
 * 待审核记录用 invalid=true 锁住，且不写回复/进群/推专家/注册日期；因此审核前不会进入待办或报表。
 */
export async function POST(request: Request) {
  const session = await sessionActor();
  if (session.error) return session.error;
  const sessionUser = session.actor;
  const roles = getAssignedRoles(sessionUser);
  if (!roles.some((role) => ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"].includes(role)))
    return authorizationDenied(sessionUser, "当前岗位不能认领历史客户");
  if (!sessionUser.groupId) return authorizationDenied(sessionUser, "当前账号未绑定小组");

  try {
    const input = inputSchema.parse(await request.json());
    const phone = normalizeCustomerPhone(input.phone);
    const settings = await getSystemSettings();
    const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(sessionUser, settings.timezone));
    const dateError = entryDateError(input.baselineOn, today, "历史状态日期");
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

    const result = await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, active: true, groupId: true, role: true, roleAssignments: { select: { role: true } } },
      });
      if (!actor?.active || !actor.groupId)
        return { status: 403 as const, error: "当前账号不能认领历史客户" };
      const requiredRole = claimRoleFor(input.baselineStage);
      if (!hasAssignedRole(actor, "LEAD")) {
        if (!hasAssignedRole(actor, requiredRole))
          return { status: 403 as const, error: `当前阶段只能由${requiredRole === "RECEPTION" ? "接粉" : requiredRole === "GROUP_OPERATOR" ? "炒群" : "专家"}岗位认领` };
        if (claimedOwnerId(input) !== actor.id)
          return { status: 403 as const, error: "一线岗位只能把历史客户认领给自己" };
      }

      const duplicate = await tx.leadCustomer.findUnique({ where: { phone }, select: { batch: { select: { groupId: true } } } });
      if (duplicate)
        return { status: 409 as const, error: duplicate.batch.groupId === actor.groupId ? "该号码已在本组客户库中，请打开原档案继续跟进" : "该手机号已存在" };

      const ownerIds = [input.receptionOwnerId, input.groupOperatorOwnerId, input.expertOwnerId]
        .filter((value): value is string => Boolean(value));
      const [members, channel] = await Promise.all([
        tx.user.findMany({ where: { id: { in: ownerIds }, groupId: actor.groupId }, select: { id: true } }),
        tx.channel.findFirst({ where: { id: input.channelId, groupId: actor.groupId }, select: { id: true, name: true, channelType: true } }),
      ]);
      if (members.length !== new Set(ownerIds).size)
        return { status: 400 as const, error: "归属只能选择本组成员" };
      if (!channel) return { status: 400 as const, error: "历史渠道只能选择本组渠道" };

      const batch = await tx.sourceBatch.upsert({
        where: { groupId_channelId_sourceDate: { groupId: actor.groupId, channelId: channel.id, sourceDate: input.baselineOn } },
        update: {},
        create: { groupId: actor.groupId, channelId: channel.id, sourceDate: input.baselineOn, channelTypeSnapshot: channel.channelType, isHistoricalRecord: true },
      });
      const lead = await tx.leadCustomer.create({ data: {
        phone,
        batchId: batch.id,
        ownerId: input.receptionOwnerId,
        attributionOwnerId: input.receptionOwnerId,
        groupOperatorOwnerId: input.groupOperatorOwnerId || null,
        expertOwnerId: input.expertOwnerId || null,
        customerName: input.customerName || null,
        notes: input.notes || null,
        historicalSourceName: channel.name,
        historicalBaselineStage: input.baselineStage,
        isHistoricalRecord: true,
        historicalReviewStatus: "PENDING",
        invalid: true,
        invalidReason: "历史客户认领待组长审核",
      } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "HISTORICAL_CUSTOMER_CLAIMED",
        entityType: "LeadCustomer",
        entityId: lead.id,
        summary: { baselineStage: input.baselineStage, channelId: channel.id, reviewStatus: "PENDING" },
      });
      return { status: 201 as const, leadId: lead.id, reviewStatus: "PENDING" as const };
    }, { isolationLevel: "Serializable" });

    if (result.status === 403) return authorizationDenied(sessionUser, result.error);
    if (result.status !== 201) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "该号码刚刚被其他人认领，请打开原客户档案" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "认领失败" }, { status: 400 });
  }
}
