import { Prisma } from "@prisma/client";
import { db } from "../db";
import { isPostgresDatabase } from "../database-provider";
import { assessGroupLeave } from "../group-leave";
import { resolveAccessibleReceptionistIds } from "../group-operator-collaboration";
import type { GroupCustomerRecord } from "./types";
import { customerCurrentGroupsWhere } from "../customer-current-group";
import { activeCustomerTrackingWhere } from "../customer-tracking-archive";

type GroupCustomerQuery = {
  groupIds: string[];
  userId: string;
  isLead: boolean;
  isGroupOperator: boolean;
  isReceptionist: boolean;
  sourceDate?: { gte: string; lte: string };
  query: string;
  skip: number;
  take: number;
  view: GroupCustomerView;
  member?: string;
  channel?: string;
  expertStage?: GroupCustomerExpertStageFilter;
  leaveRisk?: GroupCustomerLeaveRisk;
  leaveOrder?: GroupCustomerLeaveOrder;
};

export type GroupCustomerView = "inGroup" | "introduced" | "expertProgress" | "ordered" | "left";

export type GroupCustomerViewCounts = Record<GroupCustomerView, number>;
export type GroupCustomerExpertStageFilter = "" | "QUEUED" | "MATERIALS" | "TRACKING" | "PENDING_REGISTRATION" | "PENDING_ORDER" | "DECLINED_DEPOSIT" | "ORDERED" | "STALLED";
export type GroupCustomerLeaveRisk = "" | "EARLY" | "WATCH" | "NORMAL" | "UNKNOWN";
export type GroupCustomerLeaveOrder = "" | "ordered" | "not-ordered";

function noActiveOrderWhere(): Prisma.LeadCustomerWhereInput {
  return { OR: [{ customerOrder: { is: null } }, { customerOrder: { is: { voidedAt: { not: null } } } }] };
}

/**
 * 与前端 resolveExpertWorkflowStage 保持同一优先级，并在数据库分页前筛选。
 * 已退群是独立维度，所以退群且已开单的客户会同时计入 left 和 ordered。
 */
export function groupCustomerViewWhere(view: GroupCustomerView): Prisma.LeadCustomerWhereInput {
  const noActiveOrder = noActiveOrderWhere();
  if (view === "left") return { groupStatus: "LEFT" };
  if (view === "inGroup") return { groupStatus: "JOINED", expertIntroducedOn: null };
  if (view === "ordered") {
    return {
      OR: [
        { expertWorkflowStage: "ORDERED" },
        { expertWorkflowStage: null, customerOrder: { is: { voidedAt: null } } },
      ],
    };
  }
  if (view === "introduced") {
    return {
      OR: [
        { expertWorkflowStage: "QUEUED" },
        { AND: [{
            expertWorkflowStage: null,
            expertIntroducedOn: { not: null },
            expertStalledOn: null,
            noInitialDepositOn: null,
            registeredOn: null,
            expertContactedOn: null,
          }, noActiveOrder] },
      ],
    };
  }
  return {
    OR: [
      { expertWorkflowStage: { in: ["MATERIALS", "TRACKING", "PENDING_REGISTRATION", "PENDING_ORDER", "DECLINED_DEPOSIT", "STALLED"] } },
      { expertWorkflowStage: null, expertStalledOn: { not: null } },
      { AND: [{ expertWorkflowStage: null, expertStalledOn: null, noInitialDepositOn: { not: null } }, noActiveOrder] },
      { AND: [{ expertWorkflowStage: null, expertStalledOn: null, noInitialDepositOn: null, registeredOn: { not: null } }, noActiveOrder] },
      { AND: [{ expertWorkflowStage: null, expertStalledOn: null, noInitialDepositOn: null, registeredOn: null, expertContactedOn: { not: null } }, noActiveOrder] },
    ],
  };
}

export function groupCustomerExpertStageWhere(stage: Exclude<GroupCustomerExpertStageFilter, "">): Prisma.LeadCustomerWhereInput {
  const noActiveOrder = noActiveOrderWhere();
  if (stage === "QUEUED") return groupCustomerViewWhere("introduced");
  if (stage === "ORDERED") return groupCustomerViewWhere("ordered");
  if (stage === "MATERIALS" || stage === "PENDING_REGISTRATION") return { expertWorkflowStage: stage };
  if (stage === "STALLED") return { OR: [{ expertWorkflowStage: "STALLED" }, { expertWorkflowStage: null, expertStalledOn: { not: null } }] };
  if (stage === "DECLINED_DEPOSIT") return { OR: [{ expertWorkflowStage: stage }, { AND: [{ expertWorkflowStage: null, expertStalledOn: null, noInitialDepositOn: { not: null } }, noActiveOrder] }] };
  if (stage === "PENDING_ORDER") return { OR: [{ expertWorkflowStage: stage }, { AND: [{ expertWorkflowStage: null, expertStalledOn: null, noInitialDepositOn: null, registeredOn: { not: null } }, noActiveOrder] }] };
  return { OR: [{ expertWorkflowStage: "TRACKING" }, { AND: [{ expertWorkflowStage: null, expertStalledOn: null, noInitialDepositOn: null, registeredOn: null, expertContactedOn: { not: null } }, noActiveOrder] }] };
}

export type GroupPerformanceSummary = {
  operatorId: string | null;
  handled: number;
  inGroup: number;
  introduced: number;
  left: number;
  earlyLeft: number;
  watchLeft: number;
  normalLeft: number;
  unknownLeft: number;
  leftWithOrder: number;
  leftWithoutOrder: number;
  pendingIntroduction: number;
  // 协作业绩展示：同一首充不会在小组总账重复相加。
  firstDepositCents: number;
  receptionNames: string[];
};

type RawGroupPerformance = Omit<GroupPerformanceSummary, "handled" | "inGroup" | "introduced" | "left" | "earlyLeft" | "watchLeft" | "normalLeft" | "unknownLeft" | "leftWithOrder" | "leftWithoutOrder" | "pendingIntroduction" | "firstDepositCents" | "receptionNames"> & {
  handled: bigint | number;
  inGroup: bigint | number;
  introduced: bigint | number;
  left: bigint | number;
  earlyLeft: bigint | number;
  watchLeft: bigint | number;
  normalLeft: bigint | number;
  unknownLeft: bigint | number;
  leftWithOrder: bigint | number;
  leftWithoutOrder: bigint | number;
  pendingIntroduction: bigint | number;
  firstDepositCents: bigint | number;
  receptionNames: string | null;
};

/**
 * 需求文档6.1.1：当前在群是快照，只看截止日期，不能被报表选中的 sourceDate 范围卡人群——
 * 跟 loadGroupPerformanceSummary 里其他字段（handled/introduced/left…）不一样，那些字段
 * 本来就该是"这个范围内经手的这批人现在怎么样了"的同批口径，唯独在群人数不能这样算。
 * 所以这里单独查一遍不带 sourceDateFilter 的版本，只覆盖 inGroup 这一个字段。
 */
async function loadCurrentInGroupByOperator(groupId: string, query: string) {
  const queryFilter = query
    ? Prisma.sql`AND (lc."phone" LIKE ${`%${query}%`} OR COALESCE(lc."customerName", '') LIKE ${`%${query}%`})`
    : Prisma.sql``;
  const regularCustomer = Prisma.sql`batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false}`;
  const joinedAfterCutover = Prisma.sql`lc."isHistoricalRecord" = ${true} AND lc."historicalJoinCounted" = ${true}`;
  const rows = await db.$queryRaw<Array<{ operatorId: string | null; inGroup: bigint | number }>>(Prisma.sql`
    SELECT
      COALESCE(lc."groupOperatorOwnerId", gor."groupOperatorId") AS "operatorId",
      SUM(CASE WHEN ((${regularCustomer}) OR (${joinedAfterCutover})) AND lc."groupStatus" = 'JOINED' THEN 1 ELSE 0 END) AS "inGroup"
    FROM "LeadCustomer" lc
    INNER JOIN "SourceBatch" batch ON batch."id" = lc."batchId"
    LEFT JOIN "GroupOperatorReception" gor ON gor."receptionistId" = lc."ownerId"
    WHERE batch."groupId" = ${groupId}
      AND lc."invalid" = ${false}
      AND lc."groupStatus" IN ('JOINED', 'LEFT')
      ${queryFilter}
    GROUP BY COALESCE(lc."groupOperatorOwnerId", gor."groupOperatorId")
  `);
  return new Map(rows.map((row) => [row.operatorId, Number(row.inGroup)]));
}

async function loadGroupPerformanceSummary(input: GroupCustomerQuery, groupId: string) {
  if (!input.isLead) return [] as GroupPerformanceSummary[];
  const queryFilter = input.query
    ? Prisma.sql`AND (lc."phone" LIKE ${`%${input.query}%`} OR COALESCE(lc."customerName", '') LIKE ${`%${input.query}%`})`
    : Prisma.sql``;
  const sourceDateFilter = input.sourceDate
    ? Prisma.sql`AND batch."sourceDate" >= ${input.sourceDate.gte} AND batch."sourceDate" <= ${input.sourceDate.lte}`
    : Prisma.sql``;
  const receptionNamesAggregate = isPostgresDatabase()
    ? Prisma.sql`STRING_AGG(DISTINCT owner."name", ',')`
    : Prisma.sql`GROUP_CONCAT(DISTINCT owner."name")`;
  const validDatePattern = "^\\d{4}-\\d{2}-\\d{2}$";
  const leaveDay = isPostgresDatabase()
    ? Prisma.sql`CASE WHEN lc."joinedOn" ~ ${validDatePattern} AND lc."leftOn" ~ ${validDatePattern} THEN (lc."leftOn"::date - lc."joinedOn"::date) + 1 ELSE NULL END`
    : Prisma.sql`CAST(julianday(lc."leftOn") - julianday(lc."joinedOn") AS INTEGER) + 1`;
  const regularCustomer = Prisma.sql`batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false}`;
  const joinedAfterCutover = Prisma.sql`lc."isHistoricalRecord" = ${true} AND lc."historicalJoinCounted" = ${true}`;
  const introducedAfterCutover = Prisma.sql`lc."isHistoricalRecord" = ${true} AND lc."historicalExpertIntroCounted" = ${true}`;
  const leftAfterCutover = Prisma.sql`lc."isHistoricalRecord" = ${true} AND lc."historicalLeaveCounted" = ${true}`;
  const rows = await db.$queryRaw<RawGroupPerformance[]>(Prisma.sql`
    SELECT
      COALESCE(lc."groupOperatorOwnerId", gor."groupOperatorId") AS "operatorId",
      SUM(CASE WHEN (${regularCustomer}) OR (${joinedAfterCutover}) THEN 1 ELSE 0 END) AS "handled",
      SUM(CASE WHEN ((${regularCustomer}) OR (${joinedAfterCutover})) AND lc."groupStatus" = 'JOINED' THEN 1 ELSE 0 END) AS "inGroup",
      SUM(CASE WHEN (${regularCustomer}) AND lc."expertIntroducedOn" IS NOT NULL OR (${introducedAfterCutover}) THEN 1 ELSE 0 END) AS "introduced",
      SUM(CASE WHEN ((${regularCustomer}) OR (${leftAfterCutover})) AND lc."groupStatus" = 'LEFT' THEN 1 ELSE 0 END) AS "left",
      SUM(CASE WHEN ((${regularCustomer}) OR (${leftAfterCutover})) AND lc."groupStatus" = 'LEFT' AND (${leaveDay}) BETWEEN 1 AND 8 THEN 1 ELSE 0 END) AS "earlyLeft",
      SUM(CASE WHEN ((${regularCustomer}) OR (${leftAfterCutover})) AND lc."groupStatus" = 'LEFT' AND (${leaveDay}) BETWEEN 9 AND 13 THEN 1 ELSE 0 END) AS "watchLeft",
      SUM(CASE WHEN ((${regularCustomer}) OR (${leftAfterCutover})) AND lc."groupStatus" = 'LEFT' AND (${leaveDay}) >= 14 THEN 1 ELSE 0 END) AS "normalLeft",
      SUM(CASE WHEN ((${regularCustomer}) OR (${leftAfterCutover})) AND lc."groupStatus" = 'LEFT' AND (${leaveDay}) IS NULL THEN 1 ELSE 0 END) AS "unknownLeft",
      SUM(CASE WHEN ((${regularCustomer}) OR (${leftAfterCutover})) AND lc."groupStatus" = 'LEFT' AND (lc."leftWithOrder" = ${true} OR (lc."leftWithOrder" IS NULL AND orders."id" IS NOT NULL)) THEN 1 ELSE 0 END) AS "leftWithOrder",
      SUM(CASE WHEN ((${regularCustomer}) OR (${leftAfterCutover})) AND lc."groupStatus" = 'LEFT' AND (lc."leftWithOrder" = ${false} OR (lc."leftWithOrder" IS NULL AND orders."id" IS NULL)) THEN 1 ELSE 0 END) AS "leftWithoutOrder",
      SUM(CASE WHEN ((${regularCustomer}) OR (${joinedAfterCutover})) AND lc."groupStatus" = 'JOINED' AND lc."expertIntroducedOn" IS NULL THEN 1 ELSE 0 END) AS "pendingIntroduction",
      SUM(CASE WHEN orders."id" IS NOT NULL AND orders."voidedAt" IS NULL THEN orders."initialDepositCents" ELSE 0 END) AS "firstDepositCents",
      ${receptionNamesAggregate} AS "receptionNames"
    FROM "LeadCustomer" lc
    INNER JOIN "SourceBatch" batch ON batch."id" = lc."batchId"
    INNER JOIN "User" owner ON owner."id" = lc."ownerId"
    LEFT JOIN "CustomerOrder" orders ON orders."leadId" = lc."id" AND orders."voidedAt" IS NULL
    LEFT JOIN "GroupOperatorReception" gor ON gor."receptionistId" = lc."ownerId"
    WHERE batch."groupId" = ${groupId}
      ${sourceDateFilter}
      AND lc."invalid" = ${false}
      AND lc."groupStatus" IN ('JOINED', 'LEFT')
      ${queryFilter}
    GROUP BY COALESCE(lc."groupOperatorOwnerId", gor."groupOperatorId")
  `);
  const summaries = rows.map((row) => ({
    operatorId: row.operatorId,
    handled: Number(row.handled),
    inGroup: Number(row.inGroup),
    introduced: Number(row.introduced),
    left: Number(row.left),
    earlyLeft: Number(row.earlyLeft),
    watchLeft: Number(row.watchLeft),
    normalLeft: Number(row.normalLeft),
    unknownLeft: Number(row.unknownLeft),
    leftWithOrder: Number(row.leftWithOrder),
    leftWithoutOrder: Number(row.leftWithoutOrder),
    pendingIntroduction: Number(row.pendingIntroduction),
    firstDepositCents: Number(row.firstDepositCents),
    receptionNames: row.receptionNames?.split(",").filter(Boolean) ?? [],
  }));
  // 没选日期范围时上面的查询本来就没被 sourceDateFilter 卡过，直接用；
  // 只有选了范围才需要另外查一遍不限范围的在群人数覆盖回去。
  if (!input.sourceDate) return summaries;
  const unboundedInGroup = await loadCurrentInGroupByOperator(groupId, input.query);
  const overridden = summaries.map((summary) => ({
    ...summary,
    inGroup: unboundedInGroup.get(summary.operatorId) ?? 0,
  }));
  // 选中范围内这个操作员一条经手记录都没有，但手里还有更早进群、至今没退的客户——
  // 这个操作员在窄范围的查询里根本不会出现一行，上面的 map 就轮不到他，只能单独补一行。
  const knownOperatorIds = new Set(summaries.map((summary) => summary.operatorId));
  const onlyInGroupRows: GroupPerformanceSummary[] = [...unboundedInGroup.entries()]
    .filter(([operatorId]) => !knownOperatorIds.has(operatorId))
    .map(([operatorId, inGroupCount]) => ({
      operatorId,
      handled: 0, inGroup: inGroupCount, introduced: 0, left: 0, earlyLeft: 0, watchLeft: 0,
      normalLeft: 0, unknownLeft: 0, leftWithOrder: 0, leftWithoutOrder: 0, pendingIntroduction: 0,
      firstDepositCents: 0, receptionNames: [],
    }));
  return [...overridden, ...onlyInGroupRows];
}

export async function loadGroupCustomerWorkspace(input: GroupCustomerQuery) {
  const groupIds = input.groupIds.length ? input.groupIds : ["__none__"];
  const groupId = groupIds[0];
  const pairedReceptionistIds = input.isGroupOperator
    ? (await db.groupOperatorReception.findMany({
        where: { groupOperatorId: input.userId },
        select: { receptionistId: true },
      })).map((item) => item.receptionistId)
    : [];
  const receptionistIds = input.isGroupOperator
    ? resolveAccessibleReceptionistIds({
        operatorId: input.userId,
        pairedReceptionistIds,
        isReceptionist: input.isReceptionist,
      })
    : [];

  // 没有固定配合接粉员时，炒群员仍应能查看自己已接手的客户；
  // 不能因协作配置缺失把整个工作台挡住。
  const missingReceptionAssignment = input.isGroupOperator && !receptionistIds.length;

  const baseWhere: Prisma.LeadCustomerWhereInput = {
    // “全部”不附加日期条件；其他范围按接粉/来源日期读取，历史补录同样可回查。
    batch: { ...(input.sourceDate ? { sourceDate: input.sourceDate } : {}) },
    groupStatus: { in: ["JOINED", "LEFT"] },
    invalid: false,
    AND: [
      customerCurrentGroupsWhere(groupIds),
      activeCustomerTrackingWhere(),
      ...(input.isGroupOperator ? [{
        OR: [
          { groupOperatorOwnerId: input.userId },
          { groupOperatorOwnerId: null, ownerId: { in: receptionistIds } },
        ],
      }] : []),
      ...(input.query ? [{ OR: [{ phone: { contains: input.query } }, { customerName: { contains: input.query } }] }] : []),
    ],
  };
  const leaveRiskIds = input.view === "left" && input.leaveRisk ? (await db.leadCustomer.findMany({
    where: { AND: [baseWhere, groupCustomerViewWhere("left")] },
    select: { id: true, joinedOn: true, leftOn: true },
  })).filter((customer) => assessGroupLeave(customer.joinedOn, customer.leftOn).level === input.leaveRisk).map((customer) => customer.id) : [];
  const advancedWhere: Prisma.LeadCustomerWhereInput = {
    AND: [
      ...(input.member ? [{ owner: { name: input.member } }] : []),
      ...(input.channel ? [{ OR: [
        { historicalSourceName: input.channel },
        { historicalSourceName: null, batch: { channel: { name: input.channel } } },
      ] }] : []),
      ...(input.expertStage ? [groupCustomerExpertStageWhere(input.expertStage)] : []),
      ...(input.view === "left" && input.leaveRisk ? [{ id: { in: leaveRiskIds.length ? leaveRiskIds : ["__none__"] } }] : []),
      ...(input.view === "left" && input.leaveOrder === "ordered" ? [groupCustomerViewWhere("ordered")] : []),
      ...(input.view === "left" && input.leaveOrder === "not-ordered" ? [noActiveOrderWhere()] : []),
    ],
  };
  const where: Prisma.LeadCustomerWhereInput = {
    AND: [baseWhere, groupCustomerViewWhere(input.view), advancedWhere],
  };

  const viewCountEntries = (["inGroup", "introduced", "expertProgress", "ordered", "left"] as const).map(async (view) => [
    view,
    await db.leadCustomer.count({ where: { AND: [baseWhere, groupCustomerViewWhere(view)] } }),
  ] as const);

  const [leads, groupOperators, expertAssignees, totalCustomers, filteredTotal, performanceSummary, resolvedViewCounts, leftDates, filterRows] = await Promise.all([
    db.leadCustomer.findMany({
      where,
      select: {
        id: true, phone: true, customerName: true, isHistoricalRecord: true, historicalSourceName: true, invalid: true, groupStatus: true, repliedOn: true,
        followUpCount: true, lastFollowedUpOn: true, joinedOn: true, leftOn: true, leftWithOrder: true, leftNote: true, leftAutomatically: true,
        expertIntroducedOn: true, expertContactedOn: true, expertContactNote: true, expertNotes: true, expertWorkflowStage: true, expertStageChangedAt: true, expertTrackingStartedAt: true,
        groupDeviceAccountId: true, groupDeviceAccountNumber: true, expertDeviceAccountId: true, expertDeviceAccountNumber: true,
        expertStalledOn: true, expertStalledReason: true, expertStalledNote: true,
        noInitialDepositOn: true, noInitialDepositReason: true, noInitialDepositNote: true,
        registeredOn: true, notes: true, nextPlan: true, ownerId: true,
        lossAmountCents: true, customerPlatform: true,
        activities: {
          where: { kind: "GROUP_PROGRESS_UPDATED" },
          select: { id: true, occurredOn: true, note: true, actor: { select: { name: true } } },
          orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: 30,
        },
        owner: { select: { name: true } },
        attributionOwner: { select: { name: true } },
        expertOwner: { select: { name: true } },
        device: { select: { code: true } },
        batch: { select: { sourceDate: true, isHistoricalRecord: true, group: { select: { name: true } }, channel: { select: { name: true } } } },
        customerOrder: {
          select: {
            openedOn: true, initialDepositCents: true, initialDepositMethod: true, voidedAt: true,
            events: { select: { kind: true, amountCents: true, depositMethod: true, continuationNumber: true, voidedAt: true } },
          },
        },
      },
      orderBy: [{ joinedOn: "desc" }, { updatedAt: "desc" }],
      skip: input.skip,
      take: input.take,
    }),
    input.isLead ? db.user.findMany({
      where: {
        groupId,
        OR: [
          { role: "GROUP_OPERATOR" },
          { roleAssignments: { some: { role: "GROUP_OPERATOR" } } },
        ],
      },
      select: {
        id: true, name: true, active: true,
        groupOperatorAssignments: { select: { receptionistId: true, receptionist: { select: { name: true } } } },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }) : Promise.resolve([]),
    db.user.findMany({
      where: { groupId: { in: groupIds }, active: true, role: { in: ["LEAD", "EXPERT"] } },
      select: {
        id: true, name: true, role: true,
        expertLeads: {
          // 这里是实时待办容量；启用后新推给专家的老客户同样需要处理。
          where: { invalid: false, expertIntroducedOn: { not: null } },
          select: { registeredOn: true, customerOrder: { select: { voidedAt: true } } },
        },
      },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    db.leadCustomer.count({ where: baseWhere }),
    db.leadCustomer.count({ where }),
    loadGroupPerformanceSummary(input, groupId),
    Promise.all(viewCountEntries),
    db.leadCustomer.findMany({
      where: { AND: [baseWhere, groupCustomerViewWhere("left")] },
      select: { joinedOn: true, leftOn: true },
    }),
    db.leadCustomer.findMany({
      where: baseWhere,
      select: { historicalSourceName: true, owner: { select: { name: true } }, batch: { select: { channel: { select: { name: true } } } } },
    }),
  ]);
  const viewCounts = Object.fromEntries(resolvedViewCounts) as GroupCustomerViewCounts;
  const earlyLeftCount = leftDates.filter((customer) => assessGroupLeave(customer.joinedOn, customer.leftOn).level === "EARLY").length;
  const filterOptions = {
    members: [...new Set(filterRows.map((customer) => customer.owner.name))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    channels: [...new Set(filterRows.map((customer) => customer.historicalSourceName ?? customer.batch.channel.name))].sort((a, b) => a.localeCompare(b, "zh-CN")),
  };

  const customers: GroupCustomerRecord[] = leads.map((lead) => {
    const order = lead.customerOrder;
    const activeEvents = order?.events.filter((event) => !event.voidedAt) ?? [];
    return {
      id: lead.id,
      phone: lead.phone,
      customerName: lead.customerName,
      isHistoricalRecord: lead.isHistoricalRecord || lead.batch.isHistoricalRecord,
      historicalSourceName: lead.historicalSourceName,
      invalid: lead.invalid,
      groupStatus: lead.groupStatus as "JOINED" | "LEFT",
      attributionOwnerName: lead.attributionOwner?.name ?? lead.owner.name,
      ownerName: lead.owner.name,
      expertOwnerName: lead.expertOwner?.name ?? null,
      sourceDate: lead.batch.sourceDate,
      groupName: lead.batch.group.name,
      channelName: lead.historicalSourceName ?? lead.batch.channel.name,
      deviceCode: lead.device?.code ?? null,
      lossAmountCents: lead.lossAmountCents,
      customerPlatform: lead.customerPlatform,
      groupDeviceAccountId: lead.groupDeviceAccountId,
      groupDeviceAccountNumber: lead.groupDeviceAccountNumber,
      expertDeviceAccountId: lead.expertDeviceAccountId,
      expertDeviceAccountNumber: lead.expertDeviceAccountNumber,
      repliedOn: lead.repliedOn,
      followUpCount: lead.followUpCount,
      lastFollowedUpOn: lead.lastFollowedUpOn,
      joinedOn: lead.joinedOn,
      leftOn: lead.leftOn,
      leftWithOrder: lead.leftWithOrder ?? Boolean(order && !order.voidedAt),
      leftNote: lead.leftNote,
      leftAutomatically: lead.leftAutomatically,
      expertIntroducedOn: lead.expertIntroducedOn,
      expertContactedOn: lead.expertContactedOn,
      expertContactNote: lead.expertContactNote,
      expertWorkflowStage: lead.expertWorkflowStage,
      expertStageChangedAt: lead.expertStageChangedAt,
      expertTrackingStartedAt: lead.expertTrackingStartedAt,
      expertNotes: lead.expertNotes,
      expertStalledOn: lead.expertStalledOn,
      expertStalledReason: lead.expertStalledReason,
      expertStalledNote: lead.expertStalledNote,
      noInitialDepositOn: lead.noInitialDepositOn,
      noInitialDepositReason: lead.noInitialDepositReason,
      noInitialDepositNote: lead.noInitialDepositNote,
      registeredOn: lead.registeredOn,
      notes: lead.notes,
      nextPlan: lead.nextPlan,
      groupProgress: lead.activities.flatMap((activity) => activity.note ? [{ id: activity.id, occurredOn: activity.occurredOn, note: activity.note, actorName: activity.actor.name }] : []),
      order: order ? {
        openedOn: order.openedOn,
        initialDepositCents: order.initialDepositCents,
        initialDepositMethod: order.initialDepositMethod,
        voided: Boolean(order.voidedAt),
        rechargeCents: activeEvents.filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null).reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
        withdrawalCents: activeEvents.filter((event) => event.kind === "WITHDRAWAL").reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
      } : null,
    };
  });

  return {
    missingReceptionAssignment,
    customers,
    groupOperators,
    expertAssignees,
    totalCustomers,
    filteredTotal,
    viewCounts,
    earlyLeftCount,
    filterOptions,
    performanceSummary,
  };
}

export async function loadGroupOperatorCustomerPage(input: {
  groupId: string;
  operatorId: string;
  kind: "pending" | "introduced" | "left";
  from?: string;
  to?: string;
  query: string;
  page: number;
  pageSize: number;
}) {
  const assignments = await db.groupOperatorReception.findMany({
    where: { groupOperator: { groupId: input.groupId } },
    select: { groupOperatorId: true, receptionistId: true },
  });
  let operatorWhere: Prisma.LeadCustomerWhereInput;
  if (input.operatorId === "__unassigned__") {
    operatorWhere = {
      groupOperatorOwnerId: null,
      ownerId: { notIn: assignments.map((item) => item.receptionistId) },
    };
  } else {
    const assignedIds = assignments.filter((item) => item.groupOperatorId === input.operatorId).map((item) => item.receptionistId);
    const operatorExists = await db.user.count({
      where: {
        id: input.operatorId,
        groupId: input.groupId,
        OR: [
          { role: "GROUP_OPERATOR" },
          { roleAssignments: { some: { role: "GROUP_OPERATOR" } } },
        ],
      },
    });
    if (!operatorExists) return null;
    operatorWhere = {
      OR: [
        { groupOperatorOwnerId: input.operatorId },
        { groupOperatorOwnerId: null, ownerId: { in: assignedIds.length ? assignedIds : ["__none__"] } },
      ],
    };
  }
  const where: Prisma.LeadCustomerWhereInput = {
    // 明细入口用于正常流程处理；历史补录只在客户档案中回查。
    isHistoricalRecord: false,
    trackingArchivedAt: null,
    batch: {
      groupId: input.groupId,
      isHistoricalRecord: false,
      ...(input.from || input.to
        ? { sourceDate: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
        : {}),
    },
    AND: [
      operatorWhere,
      ...(input.query ? [{ OR: [{ phone: { contains: input.query } }, { customerName: { contains: input.query } }] }] : []),
    ],
    ...(input.kind === "pending"
      ? { groupStatus: "JOINED", expertIntroducedOn: null }
      : input.kind === "introduced"
        ? { expertIntroducedOn: { not: null } }
        : { groupStatus: "LEFT" }),
  };
  const [rows, total] = await Promise.all([
    db.leadCustomer.findMany({
      where,
      select: {
        id: true, phone: true, customerName: true, joinedOn: true, leftOn: true, leftWithOrder: true,
        followUpCount: true, lastFollowedUpOn: true,
        owner: { select: { name: true } },
        expertOwner: { select: { name: true } },
        customerOrder: { select: { voidedAt: true } },
        batch: { select: { sourceDate: true, group: { select: { name: true } }, channel: { select: { name: true } } } },
      },
      orderBy: input.kind === "pending"
        ? [{ joinedOn: "asc" }, { updatedAt: "asc" }]
        : input.kind === "introduced"
          ? [{ expertIntroducedOn: "desc" }, { updatedAt: "desc" }]
          : [{ leftOn: "desc" }, { updatedAt: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    db.leadCustomer.count({ where }),
  ]);
  return {
    customers: rows.map((lead) => ({
      id: lead.id,
      phone: lead.phone,
      customerName: lead.customerName,
      receptionName: lead.owner.name,
      sourceDate: lead.batch.sourceDate,
      channelName: lead.batch.channel.name,
      groupName: lead.batch.group.name,
      joinedOn: lead.joinedOn,
      leftOn: lead.leftOn,
      leaveAssessment: input.kind === "left" ? assessGroupLeave(lead.joinedOn, lead.leftOn) : null,
      leftWithOrder: lead.leftWithOrder ?? Boolean(lead.customerOrder && !lead.customerOrder.voidedAt),
      followUpCount: lead.followUpCount,
      lastFollowedUpOn: lead.lastFollowedUpOn,
      expertName: lead.expertOwner?.name ?? null,
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}
