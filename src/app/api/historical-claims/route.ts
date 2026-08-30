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

const claimStages = ["NOT_REPLIED", "REPLIED", "JOINED", "INTRODUCED", "CONTACTED", "TRACKING", "REGISTERED"] as const;
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

const resubmitSchema = z.intersection(z.object({
  claimId: z.string().min(1).max(API_LIMITS.identifierCharacters),
}), inputSchema);

type FrontlineRole = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";

function claimRolesFor(stage: ClaimStage): readonly FrontlineRole[] {
  if (stage === "NOT_REPLIED" || stage === "REPLIED") return ["RECEPTION"];
  if (stage === "JOINED") return ["GROUP_OPERATOR"];
  // “推专家”既是炒群完成的动作，也是专家接手历史客户时的起点；两边都可如实补录。
  if (stage === "INTRODUCED") return ["GROUP_OPERATOR", "EXPERT"];
  return ["EXPERT"];
}

function claimedOwnerId(input: z.infer<typeof inputSchema>, role: FrontlineRole) {
  if (role === "RECEPTION") return input.receptionOwnerId;
  if (role === "GROUP_OPERATOR") return input.groupOperatorOwnerId;
  return input.expertOwnerId;
}

const frontlineRoles = ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const satisfies readonly Role[];

function directProgressState(stage: ClaimStage, sourceDate: string) {
  const rank = claimStages.indexOf(stage);
  return {
    invalid: false,
    invalidReason: null,
    historicalReviewStatus: "APPROVED" as const,
    historicalReviewedById: null,
    historicalReviewedAt: null,
    replyStatus: rank >= 1 ? "REPLIED" as const : "NOT_REPLIED" as const,
    repliedOn: rank >= 1 ? sourceDate : null,
    groupStatus: rank >= 2 ? "JOINED" as const : "NOT_JOINED" as const,
    joinedOn: rank >= 2 ? sourceDate : null,
    expertIntroducedOn: rank >= 3 ? sourceDate : null,
    expertContactedOn: rank >= 4 ? sourceDate : null,
    registeredOn: stage === "REGISTERED" ? sourceDate : null,
    expertWorkflowStage: stage === "REGISTERED" ? "PENDING_ORDER" as const
      : stage === "TRACKING" ? "TRACKING" as const
      : stage === "CONTACTED" ? "MATERIALS" as const
      : rank >= 3 ? "QUEUED" as const : null,
    expertStageChangedAt: rank >= 3 ? new Date(`${sourceDate}T12:00:00.000Z`) : null,
    historicalReplyCounted: false,
    historicalJoinCounted: false,
    historicalExpertIntroCounted: false,
    historicalRegistrationCounted: false,
  };
}

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
 * v2 客户进度“添加一行”所需的真实选项和本人最近保存记录。
 * 人员候选按历史状态日期读取岗位历史，转岗后仍可还原当时的真实负责人。
 */
export async function GET(request: Request) {
  const session = await sessionActor();
  if (session.error) return session.error;
  const actor = session.actor;
  const roles = getAssignedRoles(actor);
  if (!roles.some((role) => ["LEAD", ...frontlineRoles].includes(role as "LEAD" | (typeof frontlineRoles)[number])))
    return authorizationDenied(actor, "当前岗位不能记录这个阶段的客户");
  if (!actor.groupId) return authorizationDenied(actor, "当前账号未绑定小组");

  const settings = await getSystemSettings();
  const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(actor, settings.timezone));
  const requestedOn = new URL(request.url).searchParams.get("baselineOn") || today;
  const baselineOn = isCalendarDate(requestedOn) && requestedOn <= today ? requestedOn : today;
  const allowedStages = claimStages.filter((stage) => hasAssignedRole(actor, "LEAD") || claimRolesFor(stage).some((role) => hasAssignedRole(actor, role)));

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
      historicalSourceName: true, invalidReason: true, notes: true, createdAt: true,
      ownerId: true, groupOperatorOwnerId: true, expertOwnerId: true,
      _count: { select: { activities: true } },
      customerOrder: { select: { id: true } },
      batch: { select: { channelId: true, sourceDate: true } },
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
    claims: claimIds.map((id) => claimById.get(id)).filter(Boolean).map((claim) => ({
      ...claim,
      canEdit: claim!.historicalReviewStatus !== "APPROVED" || (claim!._count.activities === 0 && !claim!.customerOrder),
      _count: undefined,
      customerOrder: undefined,
    })),
  });
}

/**
 * 退回的客户进度行由原提交人修改后重新提交。
 * 编辑员工自己建立的客户进度行，不生成任何统计事件。
 */
export async function PATCH(request: Request) {
  const session = await sessionActor();
  if (session.error) return session.error;
  const sessionUser = session.actor;
  if (!sessionUser.groupId) return authorizationDenied(sessionUser, "当前账号未绑定小组");

  try {
    const input = resubmitSchema.parse(await request.json());
    const phone = normalizeCustomerPhone(input.phone);
    const settings = await getSystemSettings();
    const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(sessionUser, settings.timezone));
    const dateError = entryDateError(input.baselineOn, today, "客户状态日期");
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });

    const result = await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, active: true, groupId: true, role: true, roleAssignments: { select: { role: true } } },
      });
      if (!actor?.active || !actor.groupId)
        return { status: 403 as const, error: "当前账号不能编辑客户进度" };

      const [lead, originalClaim] = await Promise.all([
        tx.leadCustomer.findUnique({
          where: { id: input.claimId },
          select: {
            id: true, phone: true, historicalReviewStatus: true, historicalBaselineStage: true,
            activities: { select: { id: true }, take: 1 },
            customerOrder: { select: { id: true } },
            batch: { select: { groupId: true, channelId: true, sourceDate: true } },
          },
        }),
        tx.auditLog.findFirst({
          where: { actorId: actor.id, action: "HISTORICAL_CUSTOMER_CLAIMED", entityType: "LeadCustomer", entityId: input.claimId },
          select: { id: true },
        }),
      ]);
      if (!lead || lead.batch.groupId !== actor.groupId || !originalClaim)
        return { status: 404 as const, error: "未找到本人可编辑的客户进度行" };
      if (!lead.historicalReviewStatus || !["PENDING", "RETURNED", "APPROVED"].includes(lead.historicalReviewStatus))
        return { status: 409 as const, error: "当前客户进度行不能编辑" };
      if (lead.historicalReviewStatus === "APPROVED" && (lead.activities.length > 0 || lead.customerOrder))
        return { status: 409 as const, error: "该客户保存后已经产生后续进度，不能覆盖起始状态；请在客户档案中继续跟进或使用纠错功能" };

      const permittedRoles = claimRolesFor(input.baselineStage);
      if (!hasAssignedRole(actor, "LEAD")) {
        const ownedRole = permittedRoles.find((role) => hasAssignedRole(actor, role) && claimedOwnerId(input, role) === actor.id);
        if (!permittedRoles.some((role) => hasAssignedRole(actor, role)))
          return { status: 403 as const, error: "当前岗位不能把客户改到这个状态" };
        if (!ownedRole)
          return { status: 403 as const, error: "一线岗位只能把客户进度归属给自己" };
      }

      const duplicate = await tx.leadCustomer.findFirst({
        where: { phone, id: { not: lead.id } },
        select: { id: true },
      });
      if (duplicate) return { status: 409 as const, error: "该号码已存在，请打开原客户档案继续跟进" };

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
        return { status: 400 as const, error: "负责人必须是状态日期当天属于本组的对应岗位人员" };
      if (!channel) return { status: 400 as const, error: "渠道只能选择本组渠道" };

      const batch = await tx.sourceBatch.upsert({
        where: { groupId_channelId_sourceDate: { groupId: actor.groupId, channelId: channel.id, sourceDate: input.baselineOn } },
        update: {},
        create: { groupId: actor.groupId, channelId: channel.id, sourceDate: input.baselineOn, channelTypeSnapshot: channel.channelType, isHistoricalRecord: true },
      });
      await tx.leadCustomer.update({
        where: { id: lead.id },
        data: {
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
          ...directProgressState(input.baselineStage, input.baselineOn),
        },
      });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "CUSTOMER_PROGRESS_ROW_UPDATED",
        entityType: "LeadCustomer",
        entityId: lead.id,
        summary: {
          before: { stage: lead.historicalBaselineStage, channelId: lead.batch.channelId, stateOn: lead.batch.sourceDate },
          after: { stage: input.baselineStage, channelId: channel.id, stateOn: input.baselineOn },
        },
      });
      return { status: 200 as const, leadId: lead.id, reviewStatus: "APPROVED" as const };
    }, { isolationLevel: "Serializable" });

    if (result.status === 403) return authorizationDenied(sessionUser, result.error);
    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "该号码刚刚被其他人使用，请刷新后重试" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "重新提交失败" }, { status: 400 });
  }
}

/**
 * 各岗位直接添加仍需继续处理的客户进度行。
 * 保存后立即进入本人的客户通讯录；它与每日统计账完全无关。
 */
export async function POST(request: Request) {
  const session = await sessionActor();
  if (session.error) return session.error;
  const sessionUser = session.actor;
  const roles = getAssignedRoles(sessionUser);
  if (!roles.some((role) => ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"].includes(role)))
    return authorizationDenied(sessionUser, "当前岗位不能记录这个阶段的客户");
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
      const permittedRoles = claimRolesFor(input.baselineStage);
      if (!hasAssignedRole(actor, "LEAD")) {
        const ownedRole = permittedRoles.find((role) => hasAssignedRole(actor, role) && claimedOwnerId(input, role) === actor.id);
        if (!permittedRoles.some((role) => hasAssignedRole(actor, role)))
          return { status: 403 as const, error: "当前岗位不能填写这个客户状态" };
        if (!ownedRole)
          return { status: 403 as const, error: "一线岗位只能把客户进度记录到自己名下" };
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
        ...directProgressState(input.baselineStage, input.baselineOn),
      } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "HISTORICAL_CUSTOMER_CLAIMED",
        entityType: "LeadCustomer",
        entityId: lead.id,
        summary: { baselineStage: input.baselineStage, channelId: channel.id, reviewStatus: "APPROVED", affectsDailyStats: false },
      });
      return { status: 201 as const, leadId: lead.id, reviewStatus: "APPROVED" as const };
    }, { isolationLevel: "Serializable" });

    if (result.status === 403) return authorizationDenied(sessionUser, result.error);
    if (result.status !== 201) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      return NextResponse.json({ error: "该号码刚刚被其他人保存，请打开原客户档案" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存客户进度失败" }, { status: 400 });
  }
}
