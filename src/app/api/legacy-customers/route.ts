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
import { getAssignedRoles } from "../../../lib/role-access";
import { authorizationDenied } from "../../../lib/security-events";
import { getSystemSettings } from "../../../lib/settings";

const baselineStages = ["NOT_REPLIED", "REPLIED", "JOINED", "INTRODUCED", "REGISTERED"] as const;
const currentEvents = ["NONE", "REPLIED", "JOINED", "INTRODUCED", "REGISTERED", "ORDERED"] as const;
const rank = { NONE: -1, NOT_REPLIED: 0, REPLIED: 1, JOINED: 2, INTRODUCED: 3, REGISTERED: 4, ORDERED: 5 } as const;
const date = z.string().refine(isCalendarDate, "日期必须是实际存在的 YYYY-MM-DD");
const inputSchema = z.object({
  phone: z.string().trim().min(1, "请输入客户号码").max(80),
  customerName: z.string().trim().max(100, "客户姓名不能超过 100 个字").optional(),
  channelId: z.string().min(1, "请选择历史渠道").max(API_LIMITS.identifierCharacters),
  receptionOwnerId: z.string().min(1, "请选择接粉归属").max(API_LIMITS.identifierCharacters),
  groupOperatorOwnerId: z.string().max(API_LIMITS.identifierCharacters).optional(),
  expertOwnerId: z.string().max(API_LIMITS.identifierCharacters).optional(),
  baselineStage: z.enum(baselineStages), baselineOn: date,
  currentEvent: z.enum(currentEvents), occurredOn: date.optional(),
  initialDepositCents: z.number().int().positive("首充金额必须大于 0").max(2_147_483_647).optional(),
  initialDepositMethod: z.enum(["CRYPTO", "BANK"]).optional(),
  notes: z.string().trim().max(1_000, "备注不能超过 1,000 个字").optional(),
}).superRefine((value, context) => {
  if (value.currentEvent !== "NONE" && !value.occurredOn) context.addIssue({ code: "custom", path: ["occurredOn"], message: "请填写本次进度的实际日期" });
  if (value.occurredOn && value.occurredOn < value.baselineOn) context.addIssue({ code: "custom", path: ["occurredOn"], message: "本次进度日期不能早于启用前状态日期" });
  if (value.currentEvent !== "NONE" && rank[value.currentEvent] <= rank[value.baselineStage]) context.addIssue({ code: "custom", path: ["currentEvent"], message: "本次新进度必须晚于启用前最后状态" });
  const finalRank = value.currentEvent === "NONE" ? rank[value.baselineStage] : rank[value.currentEvent];
  if (finalRank >= rank.JOINED && !value.groupOperatorOwnerId) context.addIssue({ code: "custom", path: ["groupOperatorOwnerId"], message: "已进群客户必须选择炒群归属" });
  if (finalRank >= rank.INTRODUCED && !value.expertOwnerId) context.addIssue({ code: "custom", path: ["expertOwnerId"], message: "已推专家客户必须选择专家归属" });
  if (value.currentEvent === "ORDERED" && !value.initialDepositCents) context.addIssue({ code: "custom", path: ["initialDepositCents"], message: "今天开单必须填写首充金额" });
  if (value.currentEvent === "ORDERED" && !value.initialDepositMethod) context.addIssue({ code: "custom", path: ["initialDepositMethod"], message: "今天开单必须选择首充入金方式" });
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
  const existing = await db.leadCustomer.findUnique({ where: { phone }, select: { id: true, customerName: true, owner: { select: { name: true } }, groupOperatorOwner: { select: { name: true } }, expertOwner: { select: { name: true } }, batch: { select: { groupId: true } } } });
  if (!existing) return NextResponse.json({ exists: false, phone });
  if (existing.batch.groupId !== actor.groupId) return NextResponse.json({ exists: true, sameGroup: false, message: "该号码已存在" });
  return NextResponse.json({ exists: true, sameGroup: true, customer: { id: existing.id, phone, customerName: existing.customerName, receptionOwnerName: existing.owner.name, groupOperatorOwnerName: existing.groupOperatorOwner?.name ?? null, expertOwnerName: existing.expertOwner?.name ?? null }, destination: destinationFor(actor, phone) });
}

export async function POST(request: Request) {
  const session = await sessionActor(); if (session.error) return session.error;
  const sessionUser = session.actor;
  if (!mayCreate(sessionUser)) return authorizationDenied(sessionUser, "当前岗位不能录入老客户");
  if (!sessionUser.groupId) return authorizationDenied(sessionUser, "当前账号未绑定小组");
  try {
    const input = inputSchema.parse(await request.json());
    const phone = normalizeCustomerPhone(input.phone);
    const settings = await getSystemSettings();
    const today = localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(sessionUser, settings.timezone));
    for (const [label, value] of [["启用前状态日期", input.baselineOn], ["本次进度日期", input.occurredOn]] as const) {
      if (!value) continue; const error = entryDateError(value, today, label); if (error) return NextResponse.json({ error }, { status: 400 });
    }
    const result = await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({ where: { id: sessionUser.id }, select: { id: true, role: true, roleAssignments: { select: { role: true } }, active: true, groupId: true } });
      if (!actor?.active || !actor.groupId || !mayCreate(actor)) return { status: 403 as const, error: "当前岗位不能录入老客户" };
      const duplicate = await tx.leadCustomer.findUnique({ where: { phone }, select: { customerName: true, batch: { select: { groupId: true } }, owner: { select: { name: true } } } });
      if (duplicate) {
        if (duplicate.batch.groupId !== actor.groupId) return { status: 409 as const, error: "该号码已存在" };
        return { status: 409 as const, error: `该号码已由接粉归属“${duplicate.owner.name}”录入，请在客户进度管理中更新`, destination: destinationFor(actor, phone) };
      }
      const ownerIds = [input.receptionOwnerId, input.groupOperatorOwnerId, input.expertOwnerId].filter((value): value is string => Boolean(value));
      const [members, channel] = await Promise.all([
        tx.user.findMany({ where: { id: { in: ownerIds }, groupId: actor.groupId }, select: { id: true } }),
        tx.channel.findFirst({ where: { id: input.channelId, groupId: actor.groupId }, select: { id: true, name: true, fanCostMode: true, effectiveFanPriceCents: true, channelType: true, rebateRateBps: true } }),
      ]);
      if (members.length !== new Set(ownerIds).size) return { status: 400 as const, error: "归属只能选择本组成员" };
      if (!channel) return { status: 400 as const, error: "历史渠道只能选择本组渠道" };
      const batch = await tx.sourceBatch.upsert({ where: { groupId_channelId_sourceDate: { groupId: actor.groupId, channelId: channel.id, sourceDate: input.baselineOn } }, update: {}, create: { groupId: actor.groupId, channelId: channel.id, sourceDate: input.baselineOn, fanCostModeSnapshot: channel.fanCostMode, effectiveFanPriceCentsSnapshot: channel.effectiveFanPriceCents, channelTypeSnapshot: channel.channelType, rebateRateBpsSnapshot: channel.rebateRateBps } });
      const baselineRank = rank[input.baselineStage];
      const finalRank = input.currentEvent === "NONE" ? baselineRank : rank[input.currentEvent];
      const currentOn = input.occurredOn ?? input.baselineOn;
      const counted = (stage: "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED") => input.currentEvent !== "NONE" && rank[stage] > baselineRank && rank[stage] <= finalRank;
      const dateFor = (stage: "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED") => finalRank >= rank[stage] ? (counted(stage) ? currentOn : input.baselineOn) : null;
      const lead = await tx.leadCustomer.create({ data: {
        phone, batchId: batch.id, ownerId: input.receptionOwnerId, attributionOwnerId: input.receptionOwnerId,
        groupOperatorOwnerId: input.groupOperatorOwnerId || null, expertOwnerId: input.expertOwnerId || null,
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
      let orderId: string | null = null;
      if (input.currentEvent === "ORDERED" && input.initialDepositCents && input.initialDepositMethod) {
        const order = await tx.customerOrder.create({ data: { phone, batchId: batch.id, leadId: lead.id, enteredById: actor.id, openedOn: currentOn, initialDepositCents: input.initialDepositCents, initialDepositMethod: input.initialDepositMethod } }); orderId = order.id;
        await tx.metricEvent.createMany({ data: [
          { batchId: batch.id, enteredById: actor.id, occurredOn: currentOn, kind: "ORDER", quantity: 1, customerOrderId: order.id, derivedFromLedger: true },
          { batchId: batch.id, enteredById: actor.id, occurredOn: currentOn, kind: "RECHARGE", amountCents: input.initialDepositCents, depositMethod: input.initialDepositMethod, customerOrderId: order.id, derivedFromLedger: true },
        ] });
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
