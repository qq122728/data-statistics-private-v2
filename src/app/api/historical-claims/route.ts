import { Prisma, type Role } from "@prisma/client";
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

const frontlineRoles = ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const satisfies readonly Role[];

function splitRoles(value: string | null | undefined): Role[] {
  return (value ?? "").split(",").map((role) => role.trim()).filter((role): role is Role =>
    frontlineRoles.includes(role as (typeof frontlineRoles)[number]));
}

function activeOn(effectiveFrom: string, effectiveTo: string | null, baselineOn: string) {
  return effectiveFrom <= baselineOn && (!effectiveTo || effectiveTo >= baselineOn);
}

type HistoricalMember = {
  id: string;
  name: string;
  active: boolean;
  groupId: string | null;
  role: Role;
  roleAssignments: Array<{ role: Role }>;
  positionHistory: Array<{ position: string; secondaryPositions: string | null; effectiveFrom: string; effectiveTo: string | null }>;
  membershipHistory: Array<{ role: Role; secondaryRoles: string | null; effectiveFrom: string; effectiveTo: string | null }>;
};

function rolesForHistoricalMember(member: HistoricalMember, groupId: string, baselineOn: string) {
  const roles = new Set<Role>();
  if (member.active && member.groupId === groupId) {
    roles.add(member.role);
    member.roleAssignments.forEach((assignment) => roles.add(assignment.role));
  }
  member.positionHistory.filter((row) => activeOn(row.effectiveFrom, row.effectiveTo, baselineOn)).forEach((row) => {
    if (frontlineRoles.includes(row.position as (typeof frontlineRoles)[number])) roles.add(row.position as Role);
    splitRoles(row.secondaryPositions).forEach((role) => roles.add(role));
  });
  member.membershipHistory.filter((row) => activeOn(row.effectiveFrom, row.effectiveTo, baselineOn)).forEach((row) => {
    roles.add(row.role);
    splitRoles(row.secondaryRoles).forEach((role) => roles.add(role));
  });
  return [...roles].filter((role) => frontlineRoles.includes(role as (typeof frontlineRoles)[number]));
}

async function loadHistoricalMembers(client: Prisma.TransactionClient | typeof db, groupId: string, baselineOn: string) {
  const members = await client.user.findMany({
    where: {
      OR: [
        { groupId },
        { positionHistory: { some: { groupId } } },
        { membershipHistory: { some: { groupId } } },
      ],
    },
    select: {
      id: true, name: true, active: true, groupId: true, role: true,
      roleAssignments: { select: { role: true } },
      positionHistory: { where: { groupId }, select: { position: true, secondaryPositions: true, effectiveFrom: true, effectiveTo: true } },
      membershipHistory: { where: { groupId }, select: { role: true, secondaryRoles: true, effectiveFrom: true, effectiveTo: true } },
    },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return members.map((member) => ({
    id: member.id,
    name: member.name,
    current: member.active && member.groupId === groupId,
    roles: rolesForHistoricalMember(member, groupId, baselineOn),
  })).filter((member) => member.roles.length > 0);
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
 * v2 一线认领面板所需的真实选项和本人最近提交记录。
 * 人员候选按历史状态日期读取岗位历史，转岗后仍可还原当时的真实负责人。
 */
export async function GET(request: Request) {
  const session = await sessionActor();
  if (session.error) return session.error;
  const actor = session.actor;
  const roles = getAssignedRoles(actor);
  if (!roles.some((role) => ["LEAD", ...frontlineRoles].includes(role as "LEAD" | (typeof frontlineRoles)[number])))
    return authorizationDenied(actor, "当前岗位不能认领历史客户");
  if (!actor.groupId) return authorizationDenied(actor, "当前账号未绑定小组");

  const settings = await getSystemSettings();
  const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(actor, settings.timezone));
  const requestedOn = new URL(request.url).searchParams.get("baselineOn") || today;
  const baselineOn = isCalendarDate(requestedOn) && requestedOn <= today ? requestedOn : today;
  const allowedStages = claimStages.filter((stage) => hasAssignedRole(actor, "LEAD") || hasAssignedRole(actor, claimRoleFor(stage)));

  const [channels, members, claimAudits] = await Promise.all([
    db.channel.findMany({ where: { groupId: actor.groupId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    loadHistoricalMembers(db, actor.groupId, baselineOn),
    db.auditLog.findMany({
      where: { actorId: actor.id, action: "HISTORICAL_CUSTOMER_CLAIMED", entityType: "LeadCustomer" },
      select: { entityId: true }, orderBy: { createdAt: "desc" }, take: 20,
    }),
  ]);
  const claimIds = claimAudits.map((audit) => audit.entityId);
  const claims = claimIds.length ? await db.leadCustomer.findMany({
    where: { id: { in: claimIds }, batch: { groupId: actor.groupId } },
    select: {
      id: true, phone: true, customerName: true, historicalBaselineStage: true, historicalReviewStatus: true,
      historicalSourceName: true, invalidReason: true, createdAt: true,
    },
  }) : [];
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));

  return NextResponse.json({
    baselineOn,
    today,
    actor: { id: actor.id, name: actor.name },
    allowedStages,
    channels,
    members: {
      reception: members.filter((member) => member.roles.includes("RECEPTION")),
      groupOperator: members.filter((member) => member.roles.includes("GROUP_OPERATOR")),
      expert: members.filter((member) => member.roles.includes("EXPERT")),
    },
    claims: claimIds.map((id) => claimById.get(id)).filter(Boolean),
  });
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
        loadHistoricalMembers(tx, actor.groupId, input.baselineOn),
        tx.channel.findFirst({ where: { id: input.channelId, groupId: actor.groupId }, select: { id: true, name: true, channelType: true } }),
      ]);
      const memberById = new Map(members.map((member) => [member.id, member]));
      const expectedRoles = new Map<string, Role>([[input.receptionOwnerId, "RECEPTION"]]);
      if (input.groupOperatorOwnerId) expectedRoles.set(input.groupOperatorOwnerId, "GROUP_OPERATOR");
      if (input.expertOwnerId) expectedRoles.set(input.expertOwnerId, "EXPERT");
      if (ownerIds.some((id) => !memberById.get(id)?.roles.includes(expectedRoles.get(id)!)))
        return { status: 400 as const, error: "负责人必须是历史状态日期当天属于本组的对应岗位人员" };
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
