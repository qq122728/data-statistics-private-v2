import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { db } from "../../../lib/db";
import { isCalendarDate } from "../../../lib/dates";
import { statisticsDate } from "../../../lib/statistics-date";
import { entryDateError } from "../../../lib/entry-date-validation";
import { normalizeCustomerPhone } from "../../../lib/entry-ledger";
import { API_LIMITS } from "../../../lib/request-limits";
import { getAssignedRoles, hasAssignedRole } from "../../../lib/role-access";
import { authorizationDenied } from "../../../lib/security-events";
import { getSystemSettings } from "../../../lib/settings";
import { incrementHistoricalCustomerDailyStat } from "../../../lib/daily-stats";
import { allocateCustomerStageNumber } from "../../../lib/customer-stage-number";
import { isCustomerCollaborator } from "../../../lib/customer-collaboration-visibility";

const baselineStages = ["NOT_REPLIED", "REPLIED", "JOINED", "INTRODUCED", "REGISTERED", "ORDERED"] as const;
const currentEvents = ["NONE", "REPLIED", "JOINED", "INTRODUCED", "REGISTERED", "ORDERED", "RECHARGE", "WITHDRAWAL"] as const;
const rank = { NONE: -1, NOT_REPLIED: 0, REPLIED: 1, JOINED: 2, INTRODUCED: 3, REGISTERED: 4, ORDERED: 5 } as const;
const date = z.string().refine(isCalendarDate, "日期必须是实际存在的 YYYY-MM-DD");
const inputSchema = z.object({
  phone: z.string().trim().min(1, "请输入客户号码").max(80),
  customerName: z.string().trim().max(100, "客户姓名不能超过 100 个字").optional(),
  channelId: z.string().min(1, "请选择历史渠道").max(API_LIMITS.identifierCharacters),
  receptionOwnerId: z.string().min(1, "请选择接粉归属").max(API_LIMITS.identifierCharacters),
  groupOperatorOwnerId: z.string().max(API_LIMITS.identifierCharacters).optional(),
  expertOwnerId: z.string().max(API_LIMITS.identifierCharacters).optional(),
  deviceCode: z.string().trim().max(100, "设备号不能超过 100 个字").optional(),
  sourceDate: date,
  joinedOn: date.optional(),
  expertIntroducedOn: date.optional(),
  registeredOn: date.optional(),
  openedOn: date.optional(),
  baselineStage: z.enum(baselineStages), baselineOn: date.optional(),
  currentEvent: z.enum(currentEvents), occurredOn: date.optional(),
  initialDepositCents: z.number().int().positive("首充金额必须大于 0").max(2_147_483_647).optional(),
  amountCents: z.number().int().positive("金额必须大于 0").max(2_147_483_647).optional(),
  initialDepositMethod: z.enum(["CRYPTO", "BANK"]).optional(),
  notes: z.string().trim().max(1_000, "备注不能超过 1,000 个字").optional(),
}).superRefine((value, context) => {
  const baselineRank = rank[value.baselineStage];
  const finalRank = ["RECHARGE", "WITHDRAWAL"].includes(value.currentEvent)
    ? rank.ORDERED
    : value.currentEvent === "NONE"
      ? baselineRank
      : rank[value.currentEvent as keyof typeof rank];
  if (baselineRank >= rank.JOINED && !value.joinedOn)
    context.addIssue({ code: "custom", path: ["joinedOn"], message: "历史状态已进群，请填写真实进群日期" });
  if (baselineRank >= rank.INTRODUCED && !value.expertIntroducedOn)
    context.addIssue({ code: "custom", path: ["expertIntroducedOn"], message: "历史状态已推专家，请填写真实推专家日期" });
  if (baselineRank >= rank.REGISTERED && !value.registeredOn)
    context.addIssue({ code: "custom", path: ["registeredOn"], message: "历史状态已注册，请填写真实注册日期" });
  if (baselineRank >= rank.ORDERED && !value.openedOn)
    context.addIssue({ code: "custom", path: ["openedOn"], message: "历史状态已开单，请填写真实开单日期" });
  if (value.currentEvent !== "NONE" && !value.occurredOn) context.addIssue({ code: "custom", path: ["occurredOn"], message: "请填写本次进度的实际日期" });
  const historicalLastDate = value.openedOn ?? value.registeredOn ?? value.expertIntroducedOn ?? value.joinedOn ?? value.sourceDate;
  if (value.occurredOn && value.occurredOn < historicalLastDate) context.addIssue({ code: "custom", path: ["occurredOn"], message: "本次进度日期不能早于已有历史进度日期" });
  const orderedDates = [value.sourceDate, value.joinedOn, value.expertIntroducedOn, value.registeredOn, value.openedOn]
    .filter((item): item is string => Boolean(item));
  if (orderedDates.some((item, index) => index > 0 && item < orderedDates[index - 1]!))
    context.addIssue({ code: "custom", path: ["sourceDate"], message: "日期顺序必须是：接粉 ≤ 进群 ≤ 推专家 ≤ 注册 ≤ 开单" });
  const progressEvent = !["NONE", "RECHARGE", "WITHDRAWAL"].includes(value.currentEvent);
  if (progressEvent && rank[value.currentEvent as keyof typeof rank] <= rank[value.baselineStage]) context.addIssue({ code: "custom", path: ["currentEvent"], message: "本次新进度必须晚于启用前最后状态" });
  if (["RECHARGE", "WITHDRAWAL"].includes(value.currentEvent) && value.baselineStage !== "ORDERED") context.addIssue({ code: "custom", path: ["baselineStage"], message: "老客户必须已经开单，才能登记今天的续充或出金" });
  if (finalRank >= rank.JOINED && !value.groupOperatorOwnerId) context.addIssue({ code: "custom", path: ["groupOperatorOwnerId"], message: "已进群客户必须选择炒群归属" });
  if (finalRank >= rank.INTRODUCED && !value.expertOwnerId) context.addIssue({ code: "custom", path: ["expertOwnerId"], message: "已推专家客户必须选择专家归属" });
  const money = value.amountCents ?? value.initialDepositCents;
  if (["ORDERED", "RECHARGE", "WITHDRAWAL"].includes(value.currentEvent) && !money) context.addIssue({ code: "custom", path: ["amountCents"], message: "请填写本次实际金额" });
  if (["ORDERED", "RECHARGE"].includes(value.currentEvent) && !value.initialDepositMethod) context.addIssue({ code: "custom", path: ["initialDepositMethod"], message: "请选择本次入金方式" });
});

type RoleActor = Parameters<typeof getAssignedRoles>[0];
function mayCreate(user: RoleActor) { return getAssignedRoles(user).some((role) => ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"].includes(role)); }
function destinationFor(user: RoleActor, phone: string) {
  const roles = getAssignedRoles(user); const query = encodeURIComponent(phone);
  if (roles.includes("RECEPTION")) return `/entry?tab=progress&q=${query}`;
  if (roles.includes("GROUP_OPERATOR")) return `/group-customers?q=${query}`;
  return `/expert-customers?q=${query}`;
}
async function sessionActor() {
  try { return { actor: await requireUser(), error: null } as const; }
  catch (error) { if (error instanceof AuthenticationError) return { actor: null, error: NextResponse.json({ error: "请先登录" }, { status: 401 }) } as const; throw error; }
}

export async function GET(request: Request) {
  const session = await sessionActor(); if (session.error) return session.error;
  const actor = session.actor;
  if (!mayCreate(actor)) return authorizationDenied(actor, "当前岗位不能录入老客户");
  if (!actor.groupId) return authorizationDenied(actor, "当前账号未绑定小组");
  let phone: string;
  try { phone = normalizeCustomerPhone(new URL(request.url).searchParams.get("phone") ?? ""); }
  catch { return NextResponse.json({ error: "请输入正确的客户号码" }, { status: 400 }); }
  const existing = await db.leadCustomer.findUnique({ where: { phone }, select: { id: true, ownerId: true, attributionOwnerId: true, groupOperatorOwnerId: true, expertOwnerId: true, customerName: true, owner: { select: { name: true } }, groupOperatorOwner: { select: { name: true } }, expertOwner: { select: { name: true } }, batch: { select: { groupId: true } } } });
  if (!existing) return NextResponse.json({ exists: false, phone });
  if (existing.batch.groupId !== actor.groupId) return NextResponse.json({ exists: true, sameGroup: false, message: "该号码已存在" });
  if (!hasAssignedRole(actor, "LEAD") && !isCustomerCollaborator(actor.id, existing))
    return NextResponse.json({ exists: true, sameGroup: true, canAccess: false, message: "该号码已存在" });
  return NextResponse.json({ exists: true, sameGroup: true, customer: { id: existing.id, phone, customerName: existing.customerName, receptionOwnerName: existing.owner.name, groupOperatorOwnerName: existing.groupOperatorOwner?.name ?? null, expertOwnerName: existing.expertOwner?.name ?? null }, destination: destinationFor(actor, phone) });
}

export async function POST(request: Request) {
  const session = await sessionActor(); if (session.error) return session.error;
  const sessionUser = session.actor;
  if (!mayCreate(sessionUser)) return authorizationDenied(sessionUser, "当前岗位不能录入老客户");
  if (!sessionUser.groupId) return authorizationDenied(sessionUser, "当前账号未绑定小组");
  try {
    const rawInput = await request.json();
    const rawBaselineStage = rawInput && typeof rawInput === "object"
      ? (rawInput as { baselineStage?: unknown }).baselineStage
      : null;
    const rawCurrentEvent = rawInput && typeof rawInput === "object"
      ? (rawInput as { currentEvent?: unknown }).currentEvent
      : null;
    const rawExpertOnlyImport =
      rawBaselineStage === "REGISTERED" ||
      rawBaselineStage === "ORDERED" ||
      ["REGISTERED", "ORDERED", "RECHARGE", "WITHDRAWAL"].includes(String(rawCurrentEvent));
    if (rawExpertOnlyImport && !hasAssignedRole(sessionUser, "EXPERT"))
      return authorizationDenied(sessionUser, "录入老客户的注册、开单或资金进度需要专家权限");
    const input = inputSchema.parse(rawInput);
    const expertOnlyImport =
      rank[input.baselineStage] >= rank.REGISTERED ||
      ["REGISTERED", "ORDERED", "RECHARGE", "WITHDRAWAL"].includes(input.currentEvent);
    if (expertOnlyImport && !hasAssignedRole(sessionUser, "EXPERT")) {
      return authorizationDenied(sessionUser, "录入老客户的注册、开单或资金进度需要专家权限");
    }
    const phone = normalizeCustomerPhone(input.phone);
    const settings = await getSystemSettings();
    const today = statisticsDate();
    for (const [label, value] of [
      ["接粉日期", input.sourceDate],
      ["进群日期", input.joinedOn],
      ["推专家日期", input.expertIntroducedOn],
      ["注册日期", input.registeredOn],
      ["开单日期", input.openedOn],
      ["本次进度日期", input.occurredOn],
    ] as const) {
      if (!value) continue; const error = entryDateError(value, today, label); if (error) return NextResponse.json({ error }, { status: 400 });
    }
    const result = await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: sessionUser.id }, select: { id: true, role: true, roleAssignments: { select: { role: true } }, active: true, groupId: true } });
      if (!actor?.active || !actor.groupId || !mayCreate(actor)) return { status: 403 as const, error: "当前岗位不能录入老客户" };
      if (expertOnlyImport && !hasAssignedRole(actor, "EXPERT")) return { status: 403 as const, error: "录入老客户的注册、开单或资金进度需要专家权限" };
      const duplicate = await tx.leadCustomer.findUnique({ where: { phone }, select: { ownerId: true, attributionOwnerId: true, groupOperatorOwnerId: true, expertOwnerId: true, customerName: true, batch: { select: { groupId: true } }, owner: { select: { name: true } } } });
      if (duplicate) {
        if (duplicate.batch.groupId !== actor.groupId) return { status: 409 as const, error: "该号码已存在" };
        if (!hasAssignedRole(actor, "LEAD") && !isCustomerCollaborator(actor.id, duplicate))
          return { status: 409 as const, error: "该号码已存在，不能重复新增" };
        return { status: 409 as const, error: `该号码已由接粉归属“${duplicate.owner.name}”录入，请在客户进度管理中更新`, destination: destinationFor(actor, phone) };
      }
      const ownerIds = [input.receptionOwnerId, input.groupOperatorOwnerId, input.expertOwnerId].filter((value): value is string => Boolean(value));
      const [members, channel] = await Promise.all([
        tx.user.findMany({ where: { id: { in: ownerIds }, groupId: actor.groupId, active: true }, select: { id: true, role: true, active: true, roleAssignments: { select: { role: true } } } }),
        tx.channel.findFirst({ where: { id: input.channelId, groupId: actor.groupId }, select: { id: true, name: true, channelType: true } }),
      ]);
      if (members.length !== new Set(ownerIds).size) return { status: 400 as const, error: "归属只能选择本组成员" };
      const memberById = new Map(members.map((member) => [member.id, member]));
      const receptionOwner = memberById.get(input.receptionOwnerId);
      const groupOperator = input.groupOperatorOwnerId ? memberById.get(input.groupOperatorOwnerId) : null;
      const expertOwner = input.expertOwnerId ? memberById.get(input.expertOwnerId) : null;
      if (!receptionOwner || !hasAssignedRole(receptionOwner, "RECEPTION")) return { status: 400 as const, error: "接粉归属只能选择有接粉权限的本组在职成员" };
      if (input.groupOperatorOwnerId && (!groupOperator || (!hasAssignedRole(groupOperator, "GROUP_OPERATOR") && !hasAssignedRole(groupOperator, "LEAD")))) return { status: 400 as const, error: "炒群负责人只能选择本组组长或有炒群权限的在职成员" };
      if (input.expertOwnerId && (!expertOwner || (!hasAssignedRole(expertOwner, "EXPERT") && !hasAssignedRole(expertOwner, "LEAD")))) return { status: 400 as const, error: "专家负责人只能选择本组组长或有专家权限的在职成员" };
      if (!channel) return { status: 400 as const, error: "历史渠道只能选择本组渠道" };
      const sourceDate = input.sourceDate;
      const batch = await tx.sourceBatch.upsert({ where: { groupId_channelId_sourceDate: { groupId: actor.groupId, channelId: channel.id, sourceDate } }, update: {}, create: { groupId: actor.groupId, channelId: channel.id, sourceDate, channelTypeSnapshot: channel.channelType, isHistoricalRecord: true } });
      const baselineRank = rank[input.baselineStage];
      const finalRank = ["RECHARGE", "WITHDRAWAL"].includes(input.currentEvent) ? rank.ORDERED : input.currentEvent === "NONE" ? baselineRank : rank[input.currentEvent as keyof typeof rank];
      const historicalDateFor = (stage: "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED") => {
        if (stage === "JOINED") return input.joinedOn ?? sourceDate;
        if (stage === "INTRODUCED") return input.expertIntroducedOn ?? input.joinedOn ?? sourceDate;
        if (stage === "REGISTERED") return input.registeredOn ?? input.expertIntroducedOn ?? input.joinedOn ?? sourceDate;
        return sourceDate;
      };
      const historicalLastDate = input.openedOn ?? input.registeredOn ?? input.expertIntroducedOn ?? input.joinedOn ?? sourceDate;
      const currentOn = input.occurredOn ?? historicalLastDate;
      const counted = (stage: "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED") => input.currentEvent !== "NONE" && rank[stage] > baselineRank && rank[stage] <= finalRank;
      const dateFor = (stage: "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED") => finalRank >= rank[stage] ? (counted(stage) ? currentOn : historicalDateFor(stage)) : null;
      const device = input.deviceCode ? await tx.device.upsert({
        where: { groupId_code: { groupId: actor.groupId, code: input.deviceCode } },
        update: {},
        create: { groupId: actor.groupId, code: input.deviceCode, memberId: input.groupOperatorOwnerId || input.receptionOwnerId },
        select: { id: true },
      }) : null;
      const groupQueueNumber = finalRank >= rank.JOINED
        ? await allocateCustomerStageNumber(tx, actor.groupId, "GROUP", dateFor("JOINED")!)
        : null;
      const expertQueueNumber = finalRank >= rank.INTRODUCED
        ? await allocateCustomerStageNumber(tx, actor.groupId, "EXPERT", dateFor("INTRODUCED")!)
        : null;
      const registrationQueueNumber = finalRank >= rank.REGISTERED
        ? await allocateCustomerStageNumber(tx, actor.groupId, "REGISTRATION", dateFor("REGISTERED")!)
        : null;
      const lead = await tx.leadCustomer.create({ data: {
        phone, batchId: batch.id, ownerId: input.receptionOwnerId, attributionOwnerId: input.receptionOwnerId,
        groupQueueNumber, groupQueueGroupId: groupQueueNumber ? actor.groupId : null,
        expertQueueNumber, expertQueueGroupId: expertQueueNumber ? actor.groupId : null,
        registrationQueueNumber, registrationQueueGroupId: registrationQueueNumber ? actor.groupId : null,
        groupOperatorOwnerId: input.groupOperatorOwnerId || null, expertOwnerId: input.expertOwnerId || null,
        deviceId: device?.id ?? null,
        customerName: input.customerName || null, historicalSourceName: channel.name, isHistoricalRecord: true, historicalBaselineStage: input.baselineStage, notes: input.notes || null,
        replyStatus: finalRank >= rank.REPLIED ? "REPLIED" : "NOT_REPLIED", repliedOn: dateFor("REPLIED"), historicalReplyCounted: counted("REPLIED"),
        groupStatus: finalRank >= rank.JOINED ? "JOINED" : "NOT_JOINED", joinedOn: dateFor("JOINED"), historicalJoinCounted: counted("JOINED"),
        expertIntroducedOn: dateFor("INTRODUCED"), historicalExpertIntroCounted: counted("INTRODUCED"),
        expertContactedOn: finalRank >= rank.REGISTERED ? dateFor("REGISTERED") : null, registeredOn: dateFor("REGISTERED"), historicalRegistrationCounted: counted("REGISTERED"),
        expertWorkflowStage: finalRank >= rank.ORDERED ? "ORDERED" : finalRank >= rank.REGISTERED ? "PENDING_ORDER" : finalRank >= rank.INTRODUCED ? "QUEUED" : null,
        expertStageChangedAt: finalRank >= rank.INTRODUCED ? new Date(`${currentOn}T12:00:00.000Z`) : null,
      } });
      const activities = [
        counted("REPLIED") ? { kind: "REPLIED" as const, note: "老客户启用后新增回复" } : null,
        counted("JOINED") ? { kind: "JOINED_GROUP" as const, note: "老客户启用后新增进群" } : null,
        counted("INTRODUCED") ? { kind: "EXPERT_INTRODUCED" as const, note: "老客户启用后新增推专家" } : null,
        counted("REGISTERED") ? { kind: "REGISTERED" as const, note: "老客户启用后新增注册" } : null,
      ].filter((value): value is NonNullable<typeof value> => Boolean(value));
      if (activities.length) await tx.leadActivity.createMany({ data: activities.map((activity) => ({ leadId: lead.id, actorId: actor.id, occurredOn: currentOn, ...activity })) });
      const amountCents = input.amountCents ?? input.initialDepositCents ?? 0;
      let orderId: string | null = null;
      let order = null;
      if (input.baselineStage === "ORDERED") {
        const openedOn = input.openedOn!;
        const orderQueueNumber = await allocateCustomerStageNumber(tx, actor.groupId, "ORDER", openedOn);
        order = await tx.customerOrder.create({ data: { phone, batchId: batch.id, leadId: lead.id, enteredById: actor.id, openedOn, initialDepositCents: 0, initialDepositMethod: null, isHistoricalBaseline: true, orderQueueNumber, orderQueueGroupId: actor.groupId } });
        orderId = order.id;
      } else if (input.currentEvent === "ORDERED" && amountCents && input.initialDepositMethod) {
        const orderQueueNumber = await allocateCustomerStageNumber(tx, actor.groupId, "ORDER", currentOn);
        order = await tx.customerOrder.create({ data: { phone, batchId: batch.id, leadId: lead.id, enteredById: actor.id, openedOn: currentOn, initialDepositCents: amountCents, initialDepositMethod: input.initialDepositMethod, orderQueueNumber, orderQueueGroupId: actor.groupId } });
        await tx.customerFinanceEvent.create({ data: { batchId: batch.id, customerOrderId: order.id, enteredById: actor.id, occurredOn: currentOn, kind: "RECHARGE", amountCents, depositMethod: input.initialDepositMethod } });
        orderId = order.id;
      }
      if (order && ["RECHARGE", "WITHDRAWAL"].includes(input.currentEvent) && amountCents) {
        await tx.customerFinanceEvent.create({ data: { batchId: batch.id, customerOrderId: order.id, enteredById: actor.id, occurredOn: currentOn, kind: input.currentEvent === "RECHARGE" ? "RECHARGE" : "WITHDRAWAL", amountCents, depositMethod: input.currentEvent === "RECHARGE" ? input.initialDepositMethod : null, continuationNumber: input.currentEvent === "RECHARGE" ? 1 : null } });
      }

      if (input.currentEvent === "REPLIED") {
        await incrementHistoricalCustomerDailyStat(tx, { ownerId: input.receptionOwnerId, groupId: actor.groupId, channelId: channel.id, businessDate: currentOn, position: "RECEPTION", sourceReceptionId: input.receptionOwnerId, reason: `${phone} 老客户回复`, increment: { replyCount: 1 } });
      } else if (input.currentEvent === "JOINED") {
        await incrementHistoricalCustomerDailyStat(tx, { ownerId: input.groupOperatorOwnerId!, groupId: actor.groupId, channelId: channel.id, businessDate: currentOn, position: "GROUP_OPERATOR", sourceReceptionId: input.receptionOwnerId, reason: `${phone} 老客户进群`, increment: { operatorReceivedCount: 1, currentInGroupCount: 1 } });
      } else if (input.currentEvent === "INTRODUCED") {
        await incrementHistoricalCustomerDailyStat(tx, { ownerId: input.groupOperatorOwnerId!, groupId: actor.groupId, channelId: channel.id, businessDate: currentOn, position: "GROUP_OPERATOR", sourceReceptionId: input.receptionOwnerId, reason: `${phone} 老客户推专家`, increment: { expertIntroCount: 1 } });
      } else if (input.currentEvent === "REGISTERED") {
        await incrementHistoricalCustomerDailyStat(tx, { ownerId: input.expertOwnerId!, groupId: actor.groupId, channelId: channel.id, businessDate: currentOn, position: "EXPERT", sourceReceptionId: input.receptionOwnerId, sourceGroupOperatorId: input.groupOperatorOwnerId, reason: `${phone} 老客户注册`, increment: { registrationCount: 1 } });
      } else if (input.currentEvent === "ORDERED") {
        await incrementHistoricalCustomerDailyStat(tx, { ownerId: input.expertOwnerId!, groupId: actor.groupId, channelId: channel.id, businessDate: currentOn, position: "EXPERT", sourceReceptionId: input.receptionOwnerId, sourceGroupOperatorId: input.groupOperatorOwnerId, reason: `${phone} 老客户开单`, increment: { orderCount: 1 } });
      }
      await recordAudit(tx, { actorId: actor.id, action: "HISTORICAL_CUSTOMER_CREATED", entityType: "LeadCustomer", entityId: lead.id, summary: { channelId: channel.id, baselineStage: input.baselineStage, currentEvent: input.currentEvent, receptionOwnerId: input.receptionOwnerId, groupOperatorOwnerId: input.groupOperatorOwnerId || null, expertOwnerId: input.expertOwnerId || null, orderId } });
      return { status: 201 as const, leadId: lead.id, destination: destinationFor(actor, phone) };
    }, { isolationLevel: "Serializable" });
    if (result.status === 403) return authorizationDenied(sessionUser, result.error);
    if (result.status !== 201) return NextResponse.json(result, { status: result.status });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查填写内容" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "该号码刚刚被其他人录入，请打开客户进度继续处理" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 });
  }
}
