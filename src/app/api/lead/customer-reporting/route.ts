import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db, getOrCreateSourceBatch } from "../../../../lib/db";
import {
  hasAssignedRole,
  isFrontlineGroupMember,
} from "../../../../lib/role-access";
import {
  API_LIMITS,
  hasOversizedQueryValue,
} from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import {
  STATISTICS_TIMEZONE,
  statisticsDate,
} from "../../../../lib/statistics-date";
import { canViewOrgScope } from "../../../../lib/org-permissions";
import {
  resolveExpertWorkflowStage,
  type ExpertWorkflowStage,
} from "../../../../lib/expert-workflow-stage";
import { customerCurrentGroupWhere } from "../../../../lib/customer-current-group";
import { normalizeCustomerPhone } from "../../../../lib/entry-ledger";
import { entryDateError } from "../../../../lib/entry-date-validation";
import { recordAudit } from "../../../../lib/audit";
import {
  syncCustomerExpertEvent,
  syncCustomerGroupEvent,
} from "../../../../lib/customer-number-event-sync";
import {
  allocateCustomerStageNumber,
  parseCustomerStageNumberQuery,
} from "../../../../lib/customer-stage-number";
import { customerCollaborationWhere } from "../../../../lib/customer-collaboration-visibility";
import { activeCustomerTrackingWhere } from "../../../../lib/customer-tracking-archive";
import {
  CUSTOMER_NUMBER_TRACKING_FROM,
  usesCustomerNumberTracking,
} from "../../../../lib/customer-number-tracking";

const stages = new Set(["reception", "group", "pending-expert", "expert"]);
const expertStages = [
  "QUEUED",
  "MATERIALS",
  "TRACKING",
  "PENDING_REGISTRATION",
  "PENDING_ORDER",
  "DECLINED_DEPOSIT",
  "ORDERED",
  "STALLED",
] as const;
const PAGE_SIZE = 50;
const createSchema = z.object({
  groupId: z.string().trim().max(API_LIMITS.identifierCharacters).optional(),
  attributionOwnerId: z
    .string()
    .trim()
    .max(API_LIMITS.identifierCharacters)
    .optional(),
  phone: z
    .string()
    .trim()
    .min(1, "请输入客户号码")
    .max(80, "客户号码不能超过 80 个字"),
  customerName: z
    .string()
    .trim()
    .max(80, "客户姓名不能超过 80 个字")
    .optional(),
  customerPlatform: z
    .string()
    .trim()
    .max(100, "平台名称不能超过 100 个字")
    .optional(),
  lossAmountCents: z
    .number()
    .int()
    .min(0, "被骗金额不能小于 0")
    .max(999_999_999_999, "被骗金额过大")
    .nullable()
    .optional(),
  channelId: z
    .string()
    .trim()
    .min(1, "请选择来源渠道")
    .max(API_LIMITS.identifierCharacters),
  sourceDate: z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), "请选择接粉日期")
    .optional(),
  joinedOn: z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), "请选择进群日期"),
  groupOperatorOwnerId: z
    .string()
    .trim()
    .min(1, "请选择炒群负责人")
    .max(API_LIMITS.identifierCharacters),
  deviceCode: z
    .string()
    .trim()
    .min(1, "请输入设备账号")
    .max(100, "设备账号不能超过 100 个字"),
  expertOwnerId: z
    .string()
    .trim()
    .max(API_LIMITS.identifierCharacters)
    .optional(),
  expertIntroducedOn: z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), "请选择推专家日期")
    .optional(),
}).superRefine((value, context) => {
  if (Boolean(value.expertOwnerId) !== Boolean(value.expertIntroducedOn)) {
    context.addIssue({
      code: "custom",
      path: [value.expertOwnerId ? "expertIntroducedOn" : "expertOwnerId"],
      message: "新增专家客户时，专家负责人和推专家日期必须一起填写",
    });
  }
});
const batchCreateSchema = z.object({
  groupId: z.string().trim().max(API_LIMITS.identifierCharacters).optional(),
  attributionOwnerId: z
    .string()
    .trim()
    .max(API_LIMITS.identifierCharacters)
    .optional(),
  phones: z
    .array(z.string().trim().max(80, "单个客户号码不能超过 80 个字"))
    .min(1, "请至少输入一个客户号码")
    .max(200, "一次最多新增 200 个客户"),
  channelId: z
    .string()
    .trim()
    .min(1, "请选择来源渠道")
    .max(API_LIMITS.identifierCharacters),
  sourceDate: z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), "请选择接粉日期")
    .optional(),
  joinedOn: z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), "请选择进群日期"),
  groupOperatorOwnerId: z
    .string()
    .trim()
    .min(1, "请选择炒群负责人")
    .max(API_LIMITS.identifierCharacters),
  deviceCode: z
    .string()
    .trim()
    .min(1, "请输入设备账号")
    .max(100, "设备账号不能超过 100 个字"),
  dryRun: z.boolean().optional().default(false),
});

function stageWhere(stage: string): Prisma.LeadCustomerWhereInput {
  if (stage === "reception")
    return { groupStatus: "NOT_JOINED", receptionArchivedAt: null };
  if (stage === "pending-expert")
    return {
      groupStatus: { in: ["JOINED", "LEFT"] },
      expertIntroducedOn: null,
    };
  if (stage === "expert") return { expertIntroducedOn: { not: null } };
  return { groupStatus: { in: ["JOINED", "LEFT"] } };
}

function stageDateWhere(
  stage: string,
  progress: string,
  month: string,
  day: string,
): Prisma.LeadCustomerWhereInput | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const from =
    day && day !== "all" ? `${month}-${day.padStart(2, "0")}` : `${month}-01`;
  const to = day && day !== "all" ? from : `${month}-31`;
  const range = { gte: from, lte: to };
  if (progress === "已开单")
    return { customerOrder: { openedOn: range, voidedAt: null } };
  if (progress === "已注册") return { registeredOn: range };
  if (progress === "已退群") return { leftOn: range };
  if (stage === "expert") return { expertIntroducedOn: range };
  return { joinedOn: range };
}

function progressWhere(progress: string): Prisma.LeadCustomerWhereInput | null {
  if (progress === "群内维护")
    return { groupStatus: "JOINED", expertIntroducedOn: null };
  if (progress === "已推专家") return { expertIntroducedOn: { not: null } };
  if (progress === "已注册") return { registeredOn: { not: null } };
  if (progress === "已开单") return { customerOrder: { voidedAt: null } };
  if (progress === "已退群") return { groupStatus: "LEFT" };
  return null;
}

function stageNumberWhere(
  value: ReturnType<typeof parseCustomerStageNumberQuery>,
  year: string,
): Prisma.LeadCustomerWhereInput | null {
  if (!value) return null;
  if (value.month === null || value.day === null) {
    return value.prefix === "G"
      ? { groupQueueNumber: value.value }
      : { expertQueueNumber: value.value };
  }
  const occurredOn = `${year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
  if (value.prefix === "G")
    return { groupQueueNumber: value.value, joinedOn: occurredOn };
  if (value.prefix === "E")
    return { expertQueueNumber: value.value, expertIntroducedOn: occurredOn };
  if (value.prefix === "R")
    return { registrationQueueNumber: value.value, registeredOn: occurredOn };
  if (value.prefix === "L")
    return { leaveQueueNumber: value.value, leftOn: occurredOn };
  return {
    customerOrder: { orderQueueNumber: value.value, openedOn: occurredOn },
  };
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
  if (hasOversizedQueryValue(params))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  if (!actor.active) return authorizationDenied(actor, "当前账号已停用");
  const isLead = Boolean(actor.groupId) && hasAssignedRole(actor, "LEAD");
  const requestedGroupId = (params.get("groupId") ?? "").trim();
  const isOwnGroupMember =
    Boolean(actor.groupId) &&
    isFrontlineGroupMember(actor) &&
    (!requestedGroupId || requestedGroupId === actor.groupId);
  const targetGroupId =
    isLead || isOwnGroupMember ? actor.groupId! : requestedGroupId;
  if (!targetGroupId)
    return NextResponse.json(
      { error: "请先选择一个具体小组" },
      { status: 400 },
    );
  const group = await db.teamGroup.findFirst({
    where: { id: targetGroupId, active: true },
    select: {
      id: true,
      departmentId: true,
      countryCode: true,
      timezone: true,
      workStartMinutes: true,
      workEndMinutes: true,
      department: {
        select: {
          companyId: true,
          countryCode: true,
          timezone: true,
          workStartMinutes: true,
          workEndMinutes: true,
        },
      },
    },
  });
  if (
    !group ||
    (!isLead &&
      !isOwnGroupMember &&
      !canViewOrgScope(actor, {
        level: "group",
        groupId: group.id,
        departmentId: group.departmentId,
        companyId: group.department.companyId,
      }))
  )
    return authorizationDenied(actor, "没有权限查看这个小组的客户进度");

  const stage = stages.has(params.get("stage") ?? "")
    ? params.get("stage")!
    : "reception";
  const pageValue = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const query = (params.get("q") ?? "")
    .trim()
    .slice(0, API_LIMITS.searchCharacters);
  const stageNumberQuery = parseCustomerStageNumberQuery(query);
  const channel = (params.get("channel") ?? "")
    .trim()
    .slice(0, API_LIMITS.searchCharacters);
  const memberId = (params.get("memberId") ?? "")
    .trim()
    .slice(0, API_LIMITS.identifierCharacters);
  const timezone = STATISTICS_TIMEZONE;
  const today = statisticsDate();
  const month = (params.get("month") ?? "").trim();
  const day = (params.get("day") ?? "all").trim();
  const progress = (params.get("progress") ?? "全部进度").trim();
  const dateWhere = stageDateWhere(stage, progress, month, day);
  const stateWhere = progressWhere(progress);
  const numberWhere = stageNumberWhere(
    stageNumberQuery,
    /^\d{4}-\d{2}$/.test(month) ? month.slice(0, 4) : today.slice(0, 4),
  );
  // 普通组员只能读取自己实际参与的客户。人员分配下拉仍单独读取全组成员，
  // 所以“当前看不到某位同事的客户”不会妨碍组长把后续阶段自由分配给该同事。
  // attributionOwnerId 是新数据的权威归属；null + ownerId 只兼容尚未回填的旧客户。
  const collaborationWhere: Prisma.LeadCustomerWhereInput | null =
    isOwnGroupMember && !isLead && !actor.canViewAllGroupCustomers
      ? customerCollaborationWhere(actor.id)
      : null;
  const baseWhere: Prisma.LeadCustomerWhereInput = {
    AND: [
      customerCurrentGroupWhere(group.id),
      activeCustomerTrackingWhere(),
      ...(collaborationWhere ? [collaborationWhere] : []),
      ...(dateWhere ? [dateWhere] : []),
      ...(stateWhere ? [stateWhere] : []),
    ],
    invalid: false,
    ...(query
      ? {
          OR: [
            { phone: { contains: query } },
            { customerName: { contains: query } },
            ...(numberWhere ? [numberWhere] : []),
          ],
        }
      : {}),
  };
  const requestedFilters: Prisma.LeadCustomerWhereInput[] = [baseWhere];
  if (channel) requestedFilters.push({ batch: { channel: { name: channel } } });
  if (memberId) requestedFilters.push({
    OR: [
      { attributionOwnerId: memberId },
      { attributionOwnerId: null, ownerId: memberId },
    ],
  });
  // 人员和渠道必须在数据库查询前过滤。这样列表、总人数、分页和资金汇总
  // 使用完全相同的条件，不会出现“行已经变少，底部仍显示筛选前人数”。
  const filteredBaseWhere: Prisma.LeadCustomerWhereInput = { AND: requestedFilters };
  const expertStageParam = params.get("expertStage");
  const expertStage = expertStages.includes(
    expertStageParam as ExpertWorkflowStage,
  )
    ? (expertStageParam as ExpertWorkflowStage)
    : "all";
  const expertCandidates =
    stage === "expert"
      ? await db.leadCustomer.findMany({
          where: { AND: [filteredBaseWhere, stageWhere("expert")] },
          select: {
            id: true,
            expertWorkflowStage: true,
            expertIntroducedOn: true,
            expertContactedOn: true,
            expertTrackingStartedAt: true,
            registeredOn: true,
            noInitialDepositOn: true,
            expertStalledOn: true,
            updatedAt: true,
            customerOrder: { select: { voidedAt: true } },
          },
        })
      : [];
  const resolvedExpertCandidates = expertCandidates
    .map((customer) => ({
      id: customer.id,
      updatedAt: customer.updatedAt,
      stage: resolveExpertWorkflowStage({
        ...customer,
        hasActiveOrder: Boolean(
          customer.customerOrder && !customer.customerOrder.voidedAt,
        ),
      })!,
    }))
    .sort(
      (left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() ||
        left.id.localeCompare(right.id),
    );
  const expertCounts = Object.fromEntries(
    expertStages.map((value) => [
      value,
      resolvedExpertCandidates.filter((customer) => customer.stage === value)
        .length,
    ]),
  );
  const matchedExpertCandidates =
    expertStage === "all"
      ? resolvedExpertCandidates
      : resolvedExpertCandidates.filter(
          (customer) => customer.stage === expertStage,
        );
  const expertPageIds = matchedExpertCandidates
    .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    .map((customer) => customer.id);
  const expertStageById = new Map(
    resolvedExpertCandidates.map((customer) => [customer.id, customer.stage]),
  );
  const where: Prisma.LeadCustomerWhereInput =
    stage === "expert"
      ? { id: { in: expertPageIds } }
      : { AND: [filteredBaseWhere, stageWhere(stage)] };
  const summaryWhere: Prisma.LeadCustomerWhereInput =
    stage === "expert"
      ? { id: { in: matchedExpertCandidates.map((customer) => customer.id) } }
      : where;
  const unfilteredStageWhere: Prisma.LeadCustomerWhereInput = {
    AND: [baseWhere, stageWhere(stage)],
  };
  const activeOrderWhere: Prisma.CustomerOrderWhereInput = {
    voidedAt: null,
    lead: summaryWhere,
  };
  const countStages = ["reception", "group", "expert"] as const;
  const [
    total,
    customerRows,
    channelRows,
    orderCount,
    initialDeposit,
    recharge,
    withdrawal,
    ...counts
  ] = await Promise.all([
    stage === "expert"
      ? Promise.resolve(matchedExpertCandidates.length)
      : db.leadCustomer.count({ where }),
    db.leadCustomer.findMany({
      where,
      select: {
        id: true,
        phone: true,
        customerName: true,
        customerEmail: true,
        lossAmountCents: true,
        customerPlatform: true,
        notes: true,
        replyStatus: true,
        repliedOn: true,
        followUpCount: true,
        lastFollowedUpOn: true,
        groupQueueNumber: true,
        expertQueueNumber: true,
        registrationQueueNumber: true,
        leaveQueueNumber: true,
        groupStatus: true,
        joinedOn: true,
        leftOn: true,
        leftNote: true,
        leftWithOrder: true,
        expertIntroducedOn: true,
        expertContactedOn: true,
        expertContactNote: true,
        expertWorkflowStage: true,
        expertTrackingStartedAt: true,
        registeredOn: true,
        expertNotes: true,
        nextPlan: true,
        nextFollowUpOn: true,
        noInitialDepositOn: true,
        noInitialDepositReason: true,
        noInitialDepositNote: true,
        expertStalledOn: true,
        expertStalledReason: true,
        expertStalledNote: true,
        owner: { select: { id: true, name: true } },
        attributionOwner: { select: { id: true, name: true } },
        device: { select: { id: true, code: true } },
        groupOperatorOwner: { select: { id: true, name: true } },
        expertOwner: { select: { id: true, name: true } },
        batch: {
          select: {
            id: true,
            sourceDate: true,
            channel: { select: { id: true, name: true } },
            group: { select: { name: true } },
          },
        },
        customerOrder: {
          select: {
            id: true,
            openedOn: true,
            orderQueueNumber: true,
            initialDepositCents: true,
            initialDepositMethod: true,
            voidedAt: true,
            enteredBy: { select: { id: true, name: true } },
            events: {
              where: {
                voidedAt: null,
                kind: { in: ["RECHARGE", "WITHDRAWAL"] },
              },
              select: {
                id: true,
                kind: true,
                amountCents: true,
                occurredOn: true,
                continuationNumber: true,
                depositMethod: true,
                enteredBy: { select: { id: true, name: true } },
              },
              orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
            },
          },
        },
        activities: {
          where: {
            kind: {
              in: [
                "REPLIED",
                "JOINED_GROUP",
                "LEFT_GROUP",
                "GROUP_PROGRESS_UPDATED",
                "EXPERT_INTRODUCED",
                "EXPERT_CONTACTED",
                "REGISTERED",
                "PLAN_UPDATED",
              ],
            },
          },
          select: {
            id: true,
            kind: true,
            occurredOn: true,
            note: true,
            actor: { select: { name: true } },
          },
          orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
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
    db.customerOrder.aggregate({
      where: activeOrderWhere,
      _sum: { initialDepositCents: true },
    }),
    db.customerFinanceEvent.aggregate({
      where: {
        voidedAt: null,
        kind: "RECHARGE",
        continuationNumber: { not: null },
        customerOrder: activeOrderWhere,
      },
      _sum: { amountCents: true },
    }),
    db.customerFinanceEvent.aggregate({
      where: {
        voidedAt: null,
        kind: "WITHDRAWAL",
        customerOrder: activeOrderWhere,
      },
      _sum: { amountCents: true },
    }),
    ...countStages.map((value) =>
      db.leadCustomer.count({
        where: { AND: [filteredBaseWhere, stageWhere(value)] },
      }),
    ),
  ]);
  const customerById = new Map(
    customerRows.map((customer) => [customer.id, customer]),
  );
  const customers =
    stage === "expert"
      ? expertPageIds
          .map((id) => customerById.get(id))
          .filter((customer): customer is NonNullable<typeof customer> =>
            Boolean(customer),
          )
      : customerRows;

  const groupMembers = await db.user.findMany({
    where: { groupId: group.id, active: true },
    select: { id: true, name: true, role: true, active: true, roleAssignments: { select: { role: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const option = (person: (typeof groupMembers)[number]) => ({ id: person.id, name: person.name });
  const memberOptions = groupMembers.map(option);
  const receptionOptions = groupMembers.filter((person) => hasAssignedRole(person, "RECEPTION")).map(option);
  const operatorOptions = groupMembers.filter((person) => hasAssignedRole(person, "GROUP_OPERATOR") || hasAssignedRole(person, "LEAD")).map(option);
  const expertOptions = groupMembers.filter((person) => hasAssignedRole(person, "EXPERT") || hasAssignedRole(person, "LEAD")).map(option);
  return NextResponse.json(
    {
      actorId: actor.id,
      stage,
      expertStage,
      expertCounts,
      page,
      pageSize: PAGE_SIZE,
      total,
      today,
      timezone,
      channels: [
        ...new Set(channelRows.map((row) => row.batch.channel.name)),
      ].sort((left, right) => left.localeCompare(right, "zh-CN")),
      channelOptions: await db.channel.findMany({
        where: { groupId: group.id, active: true },
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
      memberOptions,
      receptionOptions,
      operatorOptions,
      expertOptions,
      summary: {
        customerCount: total,
        orderCount,
        initialDepositCents: initialDeposit._sum.initialDepositCents ?? 0,
        rechargeCents: recharge._sum.amountCents ?? 0,
        withdrawalCents: withdrawal._sum.amountCents ?? 0,
      },
      counts: Object.fromEntries(
        countStages.map((value, index) => [value, counts[index]]),
      ),
      customers: customers.map((customer) => {
        const activeOrder =
          customer.customerOrder && !customer.customerOrder.voidedAt
            ? customer.customerOrder
            : null;
        const continuations =
          activeOrder?.events.filter(
            (event) =>
              event.kind === "RECHARGE" && event.continuationNumber !== null,
          ) ?? [];
        return {
          ...customer,
          expertWorkflowStage:
            expertStageById.get(customer.id) ?? customer.expertWorkflowStage,
          order: activeOrder
            ? {
                id: activeOrder.id,
                openedOn: activeOrder.openedOn,
                orderQueueNumber: activeOrder.orderQueueNumber,
                initialDepositCents: activeOrder.initialDepositCents,
                initialDepositMethod: activeOrder.initialDepositMethod,
                enteredBy: activeOrder.enteredBy,
                rechargeCents: continuations.reduce(
                  (sum, event) => sum + (event.amountCents ?? 0),
                  0,
                ),
                withdrawalCents: activeOrder.events
                  .filter((event) => event.kind === "WITHDRAWAL")
                  .reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
                nextContinuationNumber:
                  Math.max(
                    0,
                    ...continuations.map(
                      (event) => event.continuationNumber ?? 0,
                    ),
                  ) + 1,
                financeEvents: activeOrder.events.filter(
                  (event) =>
                    event.kind === "WITHDRAWAL" ||
                    event.continuationNumber !== null,
                ),
              }
            : null,
          customerOrder: undefined,
        };
      }),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** 共享表只录入已经进群的客户；组员和组长都可以新增，业绩永久归属所选接粉组员。 */
export async function POST(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active) return authorizationDenied(actor, "当前账号已停用");
  try {
    const payload: unknown = await request.json();
    const isBatch =
      typeof payload === "object" &&
      payload !== null &&
      Array.isArray((payload as { phones?: unknown }).phones);
    if (isBatch) {
      const input = batchCreateSchema.parse(payload);
      const group = await db.teamGroup.findFirst({
        where: { id: input.groupId || actor.groupId || "", active: true },
        select: {
          id: true,
          departmentId: true,
          department: { select: { companyId: true } },
        },
      });
      if (!group) return authorizationDenied(actor, "当前小组不存在或已停用");
      const ownFrontline =
        actor.groupId === group.id && isFrontlineGroupMember(actor);
      if (!ownFrontline)
        return authorizationDenied(actor, "管理账号只读，不能代录客户");
      if (!hasAssignedRole(actor, "RECEPTION") && !hasAssignedRole(actor, "LEAD"))
        return authorizationDenied(actor, "只有接粉组员或组长可以新增进群客户");
      const attributionOwnerId =
        input.attributionOwnerId || (ownFrontline ? actor.id : "");
      const attributionOwner = await db.user.findFirst({
        where: { id: attributionOwnerId, groupId: group.id, active: true, OR: [{ role: "RECEPTION" }, { roleAssignments: { some: { role: "RECEPTION" } } }] },
        select: { id: true, name: true },
      });
      if (!attributionOwner)
        return NextResponse.json(
          { error: "接粉归属必须选择本组有接粉权限的在职成员" },
          { status: 400 },
        );
      const today = statisticsDate();
      const sourceDate = input.sourceDate ?? input.joinedOn;
      const dateError = entryDateError(input.joinedOn, today, "进群日期");
      if (dateError)
        return NextResponse.json({ error: dateError }, { status: 400 });
      const sourceDateError = entryDateError(sourceDate, today, "接粉日期");
      if (sourceDateError)
        return NextResponse.json({ error: sourceDateError }, { status: 400 });
      if (sourceDate > input.joinedOn)
        return NextResponse.json(
          { error: "接粉日期不能晚于进群日期" },
          { status: 400 },
        );
      const resumesHistoricalCustomer = !usesCustomerNumberTracking(sourceDate);
      const countsCurrentJoin =
        resumesHistoricalCustomer && usesCustomerNumberTracking(input.joinedOn);

      const uniquePhones: string[] = [];
      const seen = new Set<string>();
      const invalid: string[] = [];
      const repeated: string[] = [];
      for (const raw of input.phones) {
        const digits = raw.replace(/\D/g, "");
        if (digits.length < 6) {
          invalid.push(raw || "空号码");
          continue;
        }
        const phone = digits.slice(-6);
        if (seen.has(phone)) repeated.push(phone);
        else {
          seen.add(phone);
          uniquePhones.push(phone);
        }
      }

      const [channel, operator, existing] = await Promise.all([
        db.channel.findUnique({
          where: { id_groupId: { id: input.channelId, groupId: group.id } },
          select: { id: true, name: true, active: true },
        }),
        db.user.findFirst({
          where: {
            id: input.groupOperatorOwnerId,
            groupId: group.id,
            active: true,
            OR: [{ role: { in: ["LEAD", "GROUP_OPERATOR"] } }, { roleAssignments: { some: { role: "GROUP_OPERATOR" } } }],
          },
          select: { id: true, name: true },
        }),
        uniquePhones.length
          ? db.leadCustomer.findMany({
              where: { phone: { in: uniquePhones } },
              select: { phone: true },
            })
          : Promise.resolve([]),
      ]);
      if (!channel?.active)
        return NextResponse.json(
          { error: "来源渠道不存在或已停用" },
          { status: 400 },
        );
      if (!operator)
        return NextResponse.json(
          { error: "炒群负责人只能选择本组组长或有炒群权限的在职成员" },
          { status: 400 },
        );
      const existingPhones = new Set(existing.map((customer) => customer.phone));
      const validPhones = uniquePhones.filter(
        (phone) => !existingPhones.has(phone),
      );
      const duplicates = [
        ...new Set([
          ...repeated,
          ...existing.map((customer) => customer.phone),
        ]),
      ];

      if (input.dryRun) {
        return NextResponse.json({
          validPhones,
          duplicates,
          invalid,
          totalInput: input.phones.length,
        });
      }

      const created = await db.$transaction(async (transaction) => {
        const batch = await getOrCreateSourceBatch(
          { groupId: group.id, channelId: channel.id, sourceDate },
          transaction,
        );
        const device = await transaction.device.upsert({
          where: {
            groupId_code: { groupId: group.id, code: input.deviceCode },
          },
          update: {},
          create: {
            groupId: group.id,
            code: input.deviceCode,
            memberId: operator.id,
          },
          select: { id: true },
        });
        const rows: Array<{ id: string; phone: string }> = [];
        for (const phone of validPhones) {
          const groupQueueNumber = await allocateCustomerStageNumber(
            transaction,
            group.id,
            "GROUP",
            input.joinedOn,
          );
          const customer = await transaction.leadCustomer.create({
            data: {
              phone,
              customerName: null,
              batchId: batch.id,
              ownerId: attributionOwner.id,
              attributionOwnerId: attributionOwner.id,
              groupQueueNumber,
              groupQueueGroupId: group.id,
              groupOperatorOwnerId: operator.id,
              deviceId: device.id,
              receptionCategory: "VALID",
              invalid: false,
              replyStatus: "REPLIED",
              repliedOn: sourceDate,
              groupStatus: "JOINED",
              joinedOn: input.joinedOn,
              isHistoricalRecord: resumesHistoricalCustomer,
              historicalSourceName: resumesHistoricalCustomer ? channel.name : null,
              historicalBaselineStage: resumesHistoricalCustomer
                ? usesCustomerNumberTracking(input.joinedOn)
                  ? "REPLIED"
                  : "JOINED"
                : null,
              historicalJoinCounted: countsCurrentJoin,
              activities: {
                create: [
                  {
                    actorId: actor.id,
                    kind: "JOINED_GROUP",
                    occurredOn: input.joinedOn,
                    note: "从 AI 助手批量新增到组内共享客户进度表",
                  },
                  {
                    actorId: actor.id,
                    kind: "PLAN_UPDATED",
                    occurredOn: input.joinedOn,
                    note: `炒群负责人设置为 ${operator.name}`,
                  },
                  {
                    actorId: actor.id,
                    kind: "DEVICE_ASSIGNED",
                    occurredOn: input.joinedOn,
                    note: `设备号设置为 ${input.deviceCode}`,
                  },
                ],
              },
            },
            select: { id: true, phone: true },
          });
          await recordAudit(transaction, {
            actorId: actor.id,
            action: "SHARED_CUSTOMER_CREATE",
            entityType: "LeadCustomer",
            entityId: customer.id,
            summary: {
              phone: customer.phone,
              groupId: group.id,
              channelId: channel.id,
              sourceDate,
              joinedOn: input.joinedOn,
              attributionOwnerId: attributionOwner.id,
              groupOperatorOwnerId: operator.id,
              deviceCode: input.deviceCode,
              batchCreate: true,
            },
          });
          rows.push(customer);
        }
        if (rows.length) {
          await syncCustomerGroupEvent(
            transaction,
            {
              phone: `${rows.length} 位客户`,
              ownerId: attributionOwner.id,
              attributionOwnerId: attributionOwner.id,
              groupOperatorOwnerId: operator.id,
              expertOwnerId: null,
              batch: { groupId: group.id, channelId: channel.id },
            },
            { businessDate: input.joinedOn, kind: "JOIN", delta: rows.length },
          );
        }
        return rows;
      });
      return NextResponse.json(
        {
          created,
          duplicates,
          invalid,
          totalInput: input.phones.length,
          resumed: resumesHistoricalCustomer,
          counted: { join: countsCurrentJoin },
        },
        { status: 201 },
      );
    }

    const input = createSchema.parse(payload);
    const group = await db.teamGroup.findFirst({
      where: { id: input.groupId || actor.groupId || "", active: true },
      select: {
        id: true,
        departmentId: true,
        timezone: true,
        countryCode: true,
        workStartMinutes: true,
        workEndMinutes: true,
        department: {
          select: {
            companyId: true,
            timezone: true,
            countryCode: true,
            workStartMinutes: true,
            workEndMinutes: true,
          },
        },
      },
    });
    if (!group) return authorizationDenied(actor, "当前小组不存在或已停用");
    const ownFrontline =
      actor.groupId === group.id && isFrontlineGroupMember(actor);
    if (!ownFrontline)
      return authorizationDenied(actor, "管理账号只读，不能代录客户");
    const createsExpertRow = Boolean(input.expertOwnerId && input.expertIntroducedOn);
    if (
      createsExpertRow &&
      !hasAssignedRole(actor, "LEAD") &&
      !hasAssignedRole(actor, "EXPERT")
    )
      return authorizationDenied(actor, "只有组长或专家可以直接新增专家进度行");
    if (!createsExpertRow && !hasAssignedRole(actor, "RECEPTION") && !hasAssignedRole(actor, "LEAD"))
      return authorizationDenied(actor, "只有接粉组员或组长可以新增进群客户");
    const attributionOwnerId =
      input.attributionOwnerId || (ownFrontline ? actor.id : "");
    const attributionOwner = await db.user.findFirst({
      where: { id: attributionOwnerId, groupId: group.id, active: true, OR: [{ role: "RECEPTION" }, { roleAssignments: { some: { role: "RECEPTION" } } }] },
      select: { id: true, name: true },
    });
    if (!attributionOwner)
      return NextResponse.json(
        { error: "接粉归属必须选择本组有接粉权限的在职成员" },
        { status: 400 },
      );
    const today = statisticsDate();
    const sourceDate = input.sourceDate ?? input.joinedOn;
    const dateError = entryDateError(input.joinedOn, today, "进群日期");
    if (dateError)
      return NextResponse.json({ error: dateError }, { status: 400 });
    const sourceDateError = entryDateError(sourceDate, today, "接粉日期");
    if (sourceDateError)
      return NextResponse.json({ error: sourceDateError }, { status: 400 });
    if (sourceDate > input.joinedOn)
      return NextResponse.json(
        { error: "接粉日期不能晚于进群日期" },
        { status: 400 },
      );
    if (input.expertIntroducedOn) {
      const expertDateError = entryDateError(
        input.expertIntroducedOn,
        today,
        "推专家日期",
      );
      if (expertDateError)
        return NextResponse.json({ error: expertDateError }, { status: 400 });
      if (input.expertIntroducedOn < input.joinedOn)
        return NextResponse.json(
          { error: "推专家日期不能早于进群日期" },
          { status: 400 },
        );
    }
    // 历史接粉、进群日期只用于恢复当前跟踪档案，不能倒灌旧月份。
    // 如果新增时同时填写推专家，则推专家必须是号码跟踪启用后的真实新动作。
    if (
      input.expertIntroducedOn &&
      usesCustomerNumberTracking(today) &&
      !usesCustomerNumberTracking(input.expertIntroducedOn)
    ) {
      return NextResponse.json(
        {
          error: `号码跟踪已从 ${CUSTOMER_NUMBER_TRACKING_FROM} 开始；历史接粉和进群日期可以保留，但推专家日期必须填写本次真实发生日期。`,
        },
        { status: 400 },
      );
    }
    const resumesHistoricalCustomer = !usesCustomerNumberTracking(sourceDate);
    const countsCurrentJoin =
      resumesHistoricalCustomer && usesCustomerNumberTracking(input.joinedOn);
    const countsCurrentExpert = Boolean(
      resumesHistoricalCustomer &&
        input.expertIntroducedOn &&
        usesCustomerNumberTracking(input.expertIntroducedOn),
    );
    let phone: string;
    try {
      phone = normalizeCustomerPhone(input.phone);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "客户号码至少需要 6 位数字" },
        { status: 400 },
      );
    }
    const result = await db.$transaction(async (transaction) => {
      const [channel, operator, expert, existing] = await Promise.all([
        transaction.channel.findUnique({
          where: { id_groupId: { id: input.channelId, groupId: group.id } },
          select: { id: true, name: true, active: true },
        }),
        transaction.user.findFirst({
          where: {
            id: input.groupOperatorOwnerId,
            groupId: group.id,
            active: true,
            OR: [{ role: { in: ["LEAD", "GROUP_OPERATOR"] } }, { roleAssignments: { some: { role: "GROUP_OPERATOR" } } }],
          },
          select: { id: true },
        }),
        input.expertOwnerId
          ? transaction.user.findFirst({
              where: {
                id: input.expertOwnerId,
                groupId: group.id,
                active: true,
                OR: [
                  { role: { in: ["LEAD", "EXPERT"] } },
                  { roleAssignments: { some: { role: "EXPERT" } } },
                ],
              },
              select: { id: true, name: true },
            })
          : Promise.resolve(null),
        transaction.leadCustomer.findUnique({
          where: { phone },
          select: { id: true },
        }),
      ]);
      if (!channel?.active)
        return { status: 400 as const, error: "来源渠道不存在或已停用" };
      if (!operator)
        return {
          status: 400 as const,
          error: "炒群负责人只能选择本组组长或有炒群权限的在职成员",
        };
      if (createsExpertRow && !expert)
        return {
          status: 400 as const,
          error: "专家负责人只能选择本组组长或在职专家",
        };
      if (
        createsExpertRow &&
        !hasAssignedRole(actor, "LEAD") &&
        expert?.id !== actor.id
      )
        return {
          status: 403 as const,
          error: "专家只能新增归自己负责的专家客户",
        };
      if (existing)
        return {
          status: 409 as const,
          error: "该客户号码已经存在，不能重复新增",
        };
      const batch = await getOrCreateSourceBatch(
        { groupId: group.id, channelId: channel.id, sourceDate },
        transaction,
      );
      const device = await transaction.device.upsert({
        where: { groupId_code: { groupId: group.id, code: input.deviceCode } },
        update: {},
        create: {
          groupId: group.id,
          code: input.deviceCode,
          memberId: operator.id,
        },
        select: { id: true },
      });
      const groupQueueNumber = await allocateCustomerStageNumber(
        transaction,
        group.id,
        "GROUP",
        input.joinedOn,
      );
      const expertQueueNumber = input.expertIntroducedOn
        ? await allocateCustomerStageNumber(
            transaction,
            group.id,
            "EXPERT",
            input.expertIntroducedOn,
          )
        : null;
      const customer = await transaction.leadCustomer.create({
        data: {
          phone,
          customerName: input.customerName || null,
          customerPlatform: input.customerPlatform || null,
          lossAmountCents: input.lossAmountCents ?? null,
          batchId: batch.id,
          ownerId: attributionOwner.id,
          attributionOwnerId: attributionOwner.id,
          groupQueueNumber,
          groupQueueGroupId: group.id,
          groupOperatorOwnerId: operator.id,
          expertOwnerId: expert?.id ?? null,
          expertIntroducedOn: input.expertIntroducedOn ?? null,
          expertQueueNumber,
          expertQueueGroupId: expertQueueNumber ? group.id : null,
          expertWorkflowStage: expertQueueNumber ? "QUEUED" : null,
          expertStageChangedAt: expertQueueNumber ? new Date() : null,
          deviceId: device.id,
          receptionCategory: "VALID",
          invalid: false,
          replyStatus: "REPLIED",
          repliedOn: sourceDate,
          groupStatus: "JOINED",
          joinedOn: input.joinedOn,
          isHistoricalRecord: resumesHistoricalCustomer,
          historicalSourceName: resumesHistoricalCustomer ? channel.name : null,
          historicalBaselineStage: resumesHistoricalCustomer
            ? usesCustomerNumberTracking(input.joinedOn)
              ? "REPLIED"
              : "JOINED"
            : null,
          historicalJoinCounted: countsCurrentJoin,
          historicalExpertIntroCounted: countsCurrentExpert,
          activities: {
            create: [
              {
                actorId: actor.id,
                kind: "JOINED_GROUP",
                occurredOn: input.joinedOn,
                note: "从组内共享客户进度表新增",
              },
              ...(input.expertIntroducedOn && expert
                ? [{
                    actorId: actor.id,
                    kind: "EXPERT_INTRODUCED" as const,
                    occurredOn: input.expertIntroducedOn,
                    note: `新增时直接分配专家 ${expert.name}`,
                  }]
                : []),
            ],
          },
        },
        select: { id: true, phone: true },
      });
      await recordAudit(transaction, {
        actorId: actor.id,
        action: "SHARED_CUSTOMER_CREATE",
        entityType: "LeadCustomer",
        entityId: customer.id,
        summary: {
          phone: customer.phone,
          customerName: input.customerName || null,
          customerPlatform: input.customerPlatform || null,
          lossAmountCents: input.lossAmountCents ?? null,
          groupId: group.id,
          channelId: channel.id,
          sourceDate,
          joinedOn: input.joinedOn,
          attributionOwnerId: attributionOwner.id,
          groupOperatorOwnerId: operator.id,
          deviceCode: input.deviceCode,
          expertOwnerId: expert?.id ?? null,
          expertIntroducedOn: input.expertIntroducedOn ?? null,
        },
      });
      await syncCustomerGroupEvent(
        transaction,
        {
          phone: customer.phone,
          ownerId: attributionOwner.id,
          attributionOwnerId: attributionOwner.id,
          groupOperatorOwnerId: operator.id,
          expertOwnerId: null,
          batch: { groupId: group.id, channelId: channel.id },
        },
        { businessDate: input.joinedOn, kind: "JOIN" },
      );
      if (input.expertIntroducedOn && expert) {
        const trackedCustomer = {
          phone: customer.phone,
          ownerId: attributionOwner.id,
          attributionOwnerId: attributionOwner.id,
          groupOperatorOwnerId: operator.id,
          expertOwnerId: expert.id,
          batch: { groupId: group.id, channelId: channel.id },
        };
        await syncCustomerGroupEvent(transaction, trackedCustomer, {
          businessDate: input.expertIntroducedOn,
          kind: "EXPERT_INTRO",
        });
        await syncCustomerExpertEvent(transaction, trackedCustomer, {
          businessDate: input.expertIntroducedOn,
          kind: "RECEIVED",
        });
      }
      return { status: 201 as const, customer };
    });
    if ("error" in result)
      return result.status === 403
        ? authorizationDenied(actor, result.error)
        : NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(
      {
        ...result.customer,
        resumed: resumesHistoricalCustomer,
        counted: {
          join: countsCurrentJoin,
          expert: countsCurrentExpert,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "请检查客户资料" },
        { status: 400 },
      );
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: "请求内容不是有效 JSON" },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "新增客户失败，请检查号码是否重复" },
      { status: 409 },
    );
  }
}
