import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db, getOrCreateSourceBatch } from "../../../../lib/db";
import { hasAssignedRole, isFrontlineGroupMember } from "../../../../lib/role-access";
import { API_LIMITS, hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { resolveGroupBusinessTime } from "../../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { canViewOrgScope } from "../../../../lib/org-permissions";
import { resolveExpertWorkflowStage, type ExpertWorkflowStage } from "../../../../lib/expert-workflow-stage";
import { customerCurrentGroupWhere } from "../../../../lib/customer-current-group";
import { normalizeCustomerPhone } from "../../../../lib/entry-ledger";
import { entryDateError } from "../../../../lib/entry-date-validation";

const stages = new Set(["reception", "group", "expert"]);
const expertStages = ["QUEUED", "MATERIALS", "TRACKING", "PENDING_REGISTRATION", "PENDING_ORDER", "DECLINED_DEPOSIT", "ORDERED", "STALLED"] as const;
const PAGE_SIZE = 50;
const createSchema = z.object({
  phone: z.string().trim().min(1, "请输入客户号码").max(80, "客户号码不能超过 80 个字"),
  customerName: z.string().trim().max(80, "客户姓名不能超过 80 个字").optional(),
  channelId: z.string().trim().min(1, "请选择来源渠道").max(API_LIMITS.identifierCharacters),
  joinedOn: z.string().refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), "请选择进群日期"),
  deviceCode: z.string().trim().max(50, "设备号不能超过 50 个字").optional(),
  attributionOwnerId: z.string().trim().max(API_LIMITS.identifierCharacters).optional(),
});

function stageWhere(stage: string): Prisma.LeadCustomerWhereInput {
  if (stage === "reception") return { groupStatus: "NOT_JOINED", receptionArchivedAt: null };
  if (stage === "expert") return { expertIntroducedOn: { not: null } };
  return { groupStatus: { in: ["JOINED", "LEFT"] } };
}

/** 新版组长客户进度的只读入口。写操作继续走各岗位已有的专用 workflow API。 */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  if (!actor.active) return authorizationDenied(actor, "当前账号已停用");
  const isLead = Boolean(actor.groupId) && hasAssignedRole(actor, "LEAD");
  const requestedGroupId = (params.get("groupId") ?? "").trim();
  const isOwnGroupMember = Boolean(actor.groupId)
    && isFrontlineGroupMember(actor)
    && (!requestedGroupId || requestedGroupId === actor.groupId);
  const targetGroupId = isLead || isOwnGroupMember ? actor.groupId! : requestedGroupId;
  if (!targetGroupId) return NextResponse.json({ error: "请先选择一个具体小组" }, { status: 400 });
  const group = await db.teamGroup.findFirst({
    where: { id: targetGroupId, active: true },
    select: {
      id: true, departmentId: true, countryCode: true, timezone: true,
      workStartMinutes: true, workEndMinutes: true,
      department: { select: { companyId: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
    },
  });
  if (!group || (!isLead && !isOwnGroupMember && !canViewOrgScope(actor, { level: "group", groupId: group.id, departmentId: group.departmentId, companyId: group.department.companyId })))
    return authorizationDenied(actor, "没有权限查看这个小组的客户进度");

  const stage = stages.has(params.get("stage") ?? "") ? params.get("stage")! : "reception";
  const pageValue = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const query = (params.get("q") ?? "").trim().slice(0, API_LIMITS.searchCharacters);
  const channel = (params.get("channel") ?? "").trim().slice(0, API_LIMITS.searchCharacters);
  const timezone = resolveGroupBusinessTime(group).timezone;
  const today = localDateYYYYMMDD(new Date(), timezone);
  const baseWhere: Prisma.LeadCustomerWhereInput = {
    AND: [customerCurrentGroupWhere(group.id)],
    invalid: false,
    ...(query ? { OR: [{ phone: { contains: query } }, { customerName: { contains: query } }] } : {}),
  };
  const filteredBaseWhere: Prisma.LeadCustomerWhereInput = channel
    ? { AND: [baseWhere, { batch: { channel: { name: channel } } }] }
    : baseWhere;
  const expertStageParam = params.get("expertStage");
  const expertStage = expertStages.includes(expertStageParam as ExpertWorkflowStage) ? expertStageParam as ExpertWorkflowStage : "all";
  const expertCandidates = stage === "expert" ? await db.leadCustomer.findMany({
    where: { AND: [filteredBaseWhere, stageWhere("expert")] },
    select: {
      id: true, expertWorkflowStage: true, expertIntroducedOn: true, expertContactedOn: true,
      expertTrackingStartedAt: true, registeredOn: true, noInitialDepositOn: true, expertStalledOn: true,
      updatedAt: true, customerOrder: { select: { voidedAt: true } },
    },
  }) : [];
  const resolvedExpertCandidates = expertCandidates.map((customer) => ({
    id: customer.id,
    updatedAt: customer.updatedAt,
    stage: resolveExpertWorkflowStage({
      ...customer,
      hasActiveOrder: Boolean(customer.customerOrder && !customer.customerOrder.voidedAt),
    })!,
  })).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || left.id.localeCompare(right.id));
  const expertCounts = Object.fromEntries(expertStages.map((value) => [value, resolvedExpertCandidates.filter((customer) => customer.stage === value).length]));
  const matchedExpertCandidates = expertStage === "all"
    ? resolvedExpertCandidates
    : resolvedExpertCandidates.filter((customer) => customer.stage === expertStage);
  const expertPageIds = matchedExpertCandidates.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((customer) => customer.id);
  const expertStageById = new Map(resolvedExpertCandidates.map((customer) => [customer.id, customer.stage]));
  const where: Prisma.LeadCustomerWhereInput = stage === "expert"
    ? { id: { in: expertPageIds } }
    : { AND: [filteredBaseWhere, stageWhere(stage)] };
  const summaryWhere: Prisma.LeadCustomerWhereInput = stage === "expert"
    ? { id: { in: matchedExpertCandidates.map((customer) => customer.id) } }
    : where;
  const unfilteredStageWhere: Prisma.LeadCustomerWhereInput = { AND: [baseWhere, stageWhere(stage)] };
  const activeOrderWhere: Prisma.CustomerOrderWhereInput = { voidedAt: null, lead: summaryWhere };
  const countStages = ["reception", "group", "expert"] as const;
  const [total, customerRows, channelRows, orderCount, initialDeposit, recharge, withdrawal, ...counts] = await Promise.all([
    stage === "expert" ? Promise.resolve(matchedExpertCandidates.length) : db.leadCustomer.count({ where }),
    db.leadCustomer.findMany({
      where,
      select: {
        id: true, phone: true, customerName: true, customerEmail: true,
        lossAmountCents: true, customerPlatform: true, notes: true,
        replyStatus: true, repliedOn: true, followUpCount: true, lastFollowedUpOn: true,
        groupStatus: true, joinedOn: true, leftOn: true, leftNote: true, leftWithOrder: true,
        expertIntroducedOn: true, expertContactedOn: true, expertContactNote: true,
        expertWorkflowStage: true, expertTrackingStartedAt: true, registeredOn: true, expertNotes: true, nextPlan: true, nextFollowUpOn: true,
        noInitialDepositOn: true, noInitialDepositReason: true, noInitialDepositNote: true,
        expertStalledOn: true, expertStalledReason: true, expertStalledNote: true,
        owner: { select: { id: true, name: true } },
        device: { select: { id: true, code: true } },
        groupOperatorOwner: { select: { id: true, name: true } },
        expertOwner: { select: { id: true, name: true } },
        batch: { select: { id: true, sourceDate: true, channel: { select: { name: true } }, group: { select: { name: true } } } },
        customerOrder: {
          select: {
            id: true, openedOn: true, initialDepositCents: true, voidedAt: true,
            events: {
              where: { voidedAt: null, kind: { in: ["RECHARGE", "WITHDRAWAL"] } },
              select: { id: true, kind: true, amountCents: true, occurredOn: true, continuationNumber: true },
              orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
            },
          },
        },
        activities: {
          where: { kind: { in: ["REPLIED", "JOINED_GROUP", "LEFT_GROUP", "GROUP_PROGRESS_UPDATED", "EXPERT_INTRODUCED", "EXPERT_CONTACTED", "REGISTERED", "PLAN_UPDATED"] } },
          select: { id: true, kind: true, occurredOn: true, note: true, actor: { select: { name: true } } },
          orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
          take: 3,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: stage === "expert" ? undefined : (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.leadCustomer.findMany({
      where: unfilteredStageWhere,
      select: { batch: { select: { channel: { select: { name: true } } } } },
      distinct: ["batchId"],
    }),
    db.customerOrder.count({ where: activeOrderWhere }),
    db.customerOrder.aggregate({ where: activeOrderWhere, _sum: { initialDepositCents: true } }),
    db.customerFinanceEvent.aggregate({
      where: { voidedAt: null, kind: "RECHARGE", continuationNumber: { not: null }, customerOrder: activeOrderWhere },
      _sum: { amountCents: true },
    }),
    db.customerFinanceEvent.aggregate({
      where: { voidedAt: null, kind: "WITHDRAWAL", customerOrder: activeOrderWhere },
      _sum: { amountCents: true },
    }),
    ...countStages.map((value) => db.leadCustomer.count({ where: { AND: [filteredBaseWhere, stageWhere(value)] } })),
  ]);
  const customerById = new Map(customerRows.map((customer) => [customer.id, customer]));
  const customers = stage === "expert"
    ? expertPageIds.map((id) => customerById.get(id)).filter((customer): customer is NonNullable<typeof customer> => Boolean(customer))
    : customerRows;

  const memberOptions = isLead || isOwnGroupMember ? await db.user.findMany({
    where: { groupId: group.id, active: true }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
  }) : [];
  return NextResponse.json({
    stage, expertStage, expertCounts, page, pageSize: PAGE_SIZE, total, today, timezone,
    channels: [...new Set(channelRows.map((row) => row.batch.channel.name))].sort((left, right) => left.localeCompare(right, "zh-CN")),
    channelOptions: await db.channel.findMany({ where: { groupId: group.id, active: true }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    memberOptions,
    summary: {
      customerCount: total,
      orderCount,
      initialDepositCents: initialDeposit._sum.initialDepositCents ?? 0,
      rechargeCents: recharge._sum.amountCents ?? 0,
      withdrawalCents: withdrawal._sum.amountCents ?? 0,
    },
    counts: Object.fromEntries(countStages.map((value, index) => [value, counts[index]])),
    customers: customers.map((customer) => {
      const activeOrder = customer.customerOrder && !customer.customerOrder.voidedAt ? customer.customerOrder : null;
      const continuations = activeOrder?.events.filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null) ?? [];
      return {
        ...customer,
        expertWorkflowStage: expertStageById.get(customer.id) ?? customer.expertWorkflowStage,
        order: activeOrder ? {
          id: activeOrder.id,
          openedOn: activeOrder.openedOn,
          initialDepositCents: activeOrder.initialDepositCents,
          rechargeCents: continuations.reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
          withdrawalCents: activeOrder.events.filter((event) => event.kind === "WITHDRAWAL").reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
          nextContinuationNumber: Math.max(0, ...continuations.map((event) => event.continuationNumber ?? 0)) + 1,
          financeEvents: activeOrder.events.filter((event) => event.kind === "WITHDRAWAL" || event.continuationNumber !== null),
        } : null,
        customerOrder: undefined,
      };
    }),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

/** 共享表只录入已经进群的客户；组员和组长都可以新增，业绩永久归属所选接粉组员。 */
export async function POST(request: Request) {
  let actor;
  try { actor = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !actor.groupId || !isFrontlineGroupMember(actor))
    return authorizationDenied(actor, "只有在职组员和组长可以新增已进群客户");
  try {
    const input = createSchema.parse(await request.json());
    const group = await db.teamGroup.findFirst({
      where: { id: actor.groupId, active: true },
      select: { id: true, timezone: true, countryCode: true, workStartMinutes: true, workEndMinutes: true, department: { select: { timezone: true, countryCode: true, workStartMinutes: true, workEndMinutes: true } } },
    });
    if (!group) return authorizationDenied(actor, "当前小组不存在或已停用");
    const today = localDateYYYYMMDD(new Date(), resolveGroupBusinessTime(group).timezone);
    const dateError = entryDateError(input.joinedOn, today, "进群日期");
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });
    let phone: string;
    try { phone = normalizeCustomerPhone(input.phone); }
    catch { return NextResponse.json({ error: "客户号码必须包含数字" }, { status: 400 }); }
    const result = await db.$transaction(async (transaction) => {
      const [channel, owner, existing] = await Promise.all([
        transaction.channel.findUnique({ where: { id_groupId: { id: input.channelId, groupId: group.id } }, select: { id: true, active: true } }),
        transaction.user.findFirst({ where: { id: input.attributionOwnerId || actor.id, groupId: group.id, active: true }, select: { id: true } }),
        transaction.leadCustomer.findUnique({ where: { phone }, select: { id: true } }),
      ]);
      if (!channel?.active) return { status: 400 as const, error: "来源渠道不存在或已停用" };
      if (!owner) return { status: 400 as const, error: "接粉归属只能选择本组在职组员" };
      if (existing) return { status: 409 as const, error: "该客户号码已经存在，不能重复新增" };
      const assignment = await transaction.groupOperatorReception.findUnique({ where: { receptionistId: owner.id }, select: { groupOperatorId: true } });
      let deviceId: string | null = null;
      if (input.deviceCode) {
        const device = await transaction.device.upsert({
          where: { groupId_code: { groupId: group.id, code: input.deviceCode } },
          update: {}, create: { groupId: group.id, code: input.deviceCode, memberId: owner.id }, select: { id: true, active: true, memberId: true },
        });
        if (!device.active || (device.memberId && device.memberId !== owner.id && !hasAssignedRole(actor, "LEAD")))
          return { status: 400 as const, error: "设备号已归属其他组员" };
        deviceId = device.id;
      }
      const batch = await getOrCreateSourceBatch({ groupId: group.id, channelId: channel.id, sourceDate: input.joinedOn }, transaction);
      const customer = await transaction.leadCustomer.create({
        data: {
          phone, customerName: input.customerName || null, batchId: batch.id, ownerId: owner.id, attributionOwnerId: owner.id,
          groupOperatorOwnerId: assignment?.groupOperatorId ?? (hasAssignedRole(actor, "GROUP_OPERATOR") || hasAssignedRole(actor, "LEAD") ? actor.id : null),
          deviceId, receptionCategory: "VALID", invalid: false, replyStatus: "REPLIED", repliedOn: input.joinedOn,
          groupStatus: "JOINED", joinedOn: input.joinedOn,
          activities: { create: { actorId: actor.id, kind: "JOINED_GROUP", occurredOn: input.joinedOn, note: "从组内共享客户进度表新增" } },
        }, select: { id: true, phone: true },
      });
      return { status: 201 as const, customer };
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.customer, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查客户资料" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    return NextResponse.json({ error: "新增客户失败，请检查号码是否重复" }, { status: 409 });
  }
}
