import { Prisma } from "@prisma/client";
import { db } from "../db";
import type { ExpertCustomerRecord } from "./types";
import { customerCurrentGroupsWhere } from "../customer-current-group";
import { activeCustomerTrackingWhere } from "../customer-tracking-archive";

type ExpertCustomerQuery = {
  groupIds: string[];
  userId: string;
  isLead: boolean;
  isExpert: boolean;
  sourceDate?: { gte: string; lte: string };
  query: string;
  skip: number;
  take: number;
};

export type ExpertPerformanceSummary = {
  expertOwnerId: string | null;
  handled: number;
  registered: number;
  ordered: number;
  depositCents: number;
  cryptoDepositCents: number;
  bankDepositCents: number;
  unclassifiedDepositCents: number;
  pendingRegistration: number;
  pendingOrder: number;
};

type RawExpertPerformance = Omit<ExpertPerformanceSummary, "handled" | "registered" | "ordered" | "depositCents" | "cryptoDepositCents" | "bankDepositCents" | "unclassifiedDepositCents" | "pendingRegistration" | "pendingOrder"> & {
  handled: bigint | number;
  registered: bigint | number;
  ordered: bigint | number;
  depositCents: bigint | number;
  cryptoDepositCents: bigint | number;
  bankDepositCents: bigint | number;
  unclassifiedDepositCents: bigint | number;
  pendingRegistration: bigint | number;
  pendingOrder: bigint | number;
};

async function loadExpertPerformanceSummary(input: ExpertCustomerQuery, groupId: string) {
  if (!input.isLead) return [] as ExpertPerformanceSummary[];
  const queryFilter = input.query
    ? Prisma.sql`AND (lc."phone" LIKE ${`%${input.query}%`} OR COALESCE(lc."customerName", '') LIKE ${`%${input.query}%`})`
    : Prisma.sql``;
  const sourceDateFilter = input.sourceDate
    ? Prisma.sql`AND batch."sourceDate" >= ${input.sourceDate.gte} AND batch."sourceDate" <= ${input.sourceDate.lte}`
    : Prisma.sql``;
  const regularCustomer = Prisma.sql`batch."isHistoricalRecord" = ${false} AND lc."isHistoricalRecord" = ${false}`;
  const introducedAfterCutover = Prisma.sql`lc."isHistoricalRecord" = ${true} AND lc."historicalExpertIntroCounted" = ${true}`;
  const registeredAfterCutover = Prisma.sql`lc."isHistoricalRecord" = ${true} AND lc."historicalRegistrationCounted" = ${true}`;
  const rows = await db.$queryRaw<RawExpertPerformance[]>(Prisma.sql`
    SELECT
      lc."expertOwnerId" AS "expertOwnerId",
      SUM(CASE WHEN (${regularCustomer}) OR (${introducedAfterCutover}) THEN 1 ELSE 0 END) AS "handled",
      SUM(CASE WHEN ((${regularCustomer}) AND lc."registeredOn" IS NOT NULL) OR (${registeredAfterCutover}) THEN 1 ELSE 0 END) AS "registered",
      SUM(CASE WHEN orders."id" IS NOT NULL AND orders."voidedAt" IS NULL THEN 1 ELSE 0 END) AS "ordered",
      SUM(CASE WHEN lc."registeredOn" IS NULL THEN 1 ELSE 0 END) AS "pendingRegistration",
      SUM(CASE WHEN lc."registeredOn" IS NOT NULL AND (orders."id" IS NULL OR orders."voidedAt" IS NOT NULL) THEN 1 ELSE 0 END) AS "pendingOrder",
      SUM(CASE WHEN orders."id" IS NOT NULL AND orders."voidedAt" IS NULL THEN
        orders."initialDepositCents" + COALESCE((
          SELECT SUM(events."amountCents")
          FROM "CustomerFinanceEvent" events
          WHERE events."customerOrderId" = orders."id"
            AND events."voidedAt" IS NULL
            AND events."kind" = 'RECHARGE'
            AND events."continuationNumber" IS NOT NULL
        ), 0)
      ELSE 0 END) AS "depositCents",
      SUM(CASE WHEN orders."id" IS NOT NULL AND orders."voidedAt" IS NULL THEN
        CASE WHEN orders."initialDepositMethod" = 'CRYPTO' THEN orders."initialDepositCents" ELSE 0 END + COALESCE((
          SELECT SUM(events."amountCents") FROM "CustomerFinanceEvent" events
          WHERE events."customerOrderId" = orders."id" AND events."voidedAt" IS NULL AND events."kind" = 'RECHARGE'
            AND events."continuationNumber" IS NOT NULL AND events."depositMethod" = 'CRYPTO'
        ), 0) ELSE 0 END) AS "cryptoDepositCents",
      SUM(CASE WHEN orders."id" IS NOT NULL AND orders."voidedAt" IS NULL THEN
        CASE WHEN orders."initialDepositMethod" = 'BANK' THEN orders."initialDepositCents" ELSE 0 END + COALESCE((
          SELECT SUM(events."amountCents") FROM "CustomerFinanceEvent" events
          WHERE events."customerOrderId" = orders."id" AND events."voidedAt" IS NULL AND events."kind" = 'RECHARGE'
            AND events."continuationNumber" IS NOT NULL AND events."depositMethod" = 'BANK'
        ), 0) ELSE 0 END) AS "bankDepositCents",
      SUM(CASE WHEN orders."id" IS NOT NULL AND orders."voidedAt" IS NULL THEN
        CASE WHEN orders."initialDepositMethod" IS NULL THEN orders."initialDepositCents" ELSE 0 END + COALESCE((
          SELECT SUM(events."amountCents") FROM "CustomerFinanceEvent" events
          WHERE events."customerOrderId" = orders."id" AND events."voidedAt" IS NULL AND events."kind" = 'RECHARGE'
            AND events."continuationNumber" IS NOT NULL AND events."depositMethod" IS NULL
        ), 0) ELSE 0 END) AS "unclassifiedDepositCents"
    FROM "LeadCustomer" lc
    INNER JOIN "SourceBatch" batch ON batch."id" = lc."batchId"
    LEFT JOIN "CustomerOrder" orders ON orders."leadId" = lc."id"
    WHERE batch."groupId" = ${groupId}
      ${sourceDateFilter}
      AND lc."invalid" = ${false}
      AND lc."expertIntroducedOn" IS NOT NULL
      AND lc."expertContactedOn" IS NOT NULL
      ${queryFilter}
    GROUP BY lc."expertOwnerId"
  `);
  return rows.map((row) => ({
    expertOwnerId: row.expertOwnerId,
    handled: Number(row.handled),
    registered: Number(row.registered),
    ordered: Number(row.ordered),
    depositCents: Number(row.depositCents),
    cryptoDepositCents: Number(row.cryptoDepositCents),
    bankDepositCents: Number(row.bankDepositCents),
    unclassifiedDepositCents: Number(row.unclassifiedDepositCents),
    pendingRegistration: Number(row.pendingRegistration),
    pendingOrder: Number(row.pendingOrder),
  }));
}

export async function loadExpertCustomerWorkspace(input: ExpertCustomerQuery) {
  const groupIds = input.groupIds.length ? input.groupIds : ["__none__"];
  const groupId = groupIds[0];
  const where: Prisma.LeadCustomerWhereInput = {
    // 专家工作台是实时待办：日期范围只筛选上方业绩汇总，不能把尚未进入下一步的老客户藏掉。
    AND: [customerCurrentGroupsWhere(groupIds), activeCustomerTrackingWhere()],
    expertIntroducedOn: { not: null },
    ...(input.isExpert ? { expertOwnerId: input.userId } : {}),
    ...(input.query ? { OR: [{ phone: { contains: input.query } }, { customerName: { contains: input.query } }] } : {}),
  };

  const [assignees, expertMembers, leads, totalCustomers, performanceSummary] = await Promise.all([
    input.isLead ? db.user.findMany({
      where: { groupId, active: true, OR: [{ role: { in: ["LEAD", "EXPERT"] } }, { roleAssignments: { some: { role: "EXPERT" } } }] },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }) : Promise.resolve([]),
    input.isLead ? db.user.findMany({
      where: { groupId, OR: [{ role: { in: ["LEAD", "EXPERT"] } }, { roleAssignments: { some: { role: "EXPERT" } } }] },
      select: { id: true, name: true, active: true, role: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }) : Promise.resolve([]),
    db.leadCustomer.findMany({
      where,
      select: {
        id: true, phone: true, customerName: true, isHistoricalRecord: true, historicalSourceName: true, expertOwnerId: true, groupStatus: true, leftOn: true, leftNote: true, leftAutomatically: true, joinedOn: true,
        repliedOn: true, followUpCount: true, lastFollowedUpOn: true,
        device: { select: { code: true } },
        expertOwner: { select: { id: true, name: true, active: true, role: true } },
        owner: { select: { name: true } },
        attributionOwner: { select: { name: true } },
        batch: { select: { id: true, sourceDate: true, isHistoricalRecord: true, group: { select: { name: true } }, channel: { select: { name: true } } } },
        expertIntroducedOn: true, expertContactedOn: true, expertContactNote: true, expertNotes: true, expertWorkflowStage: true, expertStageChangedAt: true, expertTrackingStartedAt: true,
        groupDeviceAccountId: true, groupDeviceAccountNumber: true, expertDeviceAccountId: true, expertDeviceAccountNumber: true,
        expertStalledOn: true, expertStalledReason: true, expertStalledNote: true,
        noInitialDepositOn: true, noInitialDepositReason: true, noInitialDepositNote: true,
        registeredOn: true, notes: true, nextPlan: true, nextFollowUpOn: true,
        lossAmountCents: true, customerPlatform: true,
        activities: {
          // 专家页面同时需要两种互不混写的情况：炒群每日进度和专家跟进记录。
          where: { kind: { in: ["GROUP_PROGRESS_UPDATED", "EXPERT_INTRODUCED", "EXPERT_CONTACTED", "REGISTERED", "PLAN_UPDATED", "ORDER_VOIDED", "FINANCE_VOIDED"] } },
          select: { id: true, occurredOn: true, note: true, kind: true, actor: { select: { name: true, role: true } } },
          orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "desc" }],
          take: 60,
        },
        customerOrder: {
          select: {
            id: true, openedOn: true, initialDepositCents: true, initialDepositMethod: true, voidedAt: true,
            events: {
              where: { voidedAt: null, OR: [{ kind: "WITHDRAWAL" }, { kind: "RECHARGE", continuationNumber: { not: null } }] },
              select: { id: true, kind: true, amountCents: true, depositMethod: true, occurredOn: true, continuationNumber: true },
              orderBy: { occurredOn: "desc" },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }],
      skip: input.skip,
      take: input.take,
    }),
    db.leadCustomer.count({ where }),
    loadExpertPerformanceSummary(input, groupId),
  ]);

  const customers: ExpertCustomerRecord[] = leads.map((lead) => {
    const order = lead.customerOrder;
    const events = order?.events ?? [];
    const groupProgress = lead.activities
      .filter((activity) => activity.kind === "GROUP_PROGRESS_UPDATED" && activity.note)
      .map((activity) => ({ id: activity.id, occurredOn: activity.occurredOn, note: activity.note!, actorName: activity.actor.name }));
    const latestExpertActivity = lead.activities.find((activity) =>
      activity.kind !== "GROUP_PROGRESS_UPDATED" && (activity.actor.role === "EXPERT" || activity.actor.role === "LEAD"),
    );
    return {
      id: lead.id,
      batchId: lead.batch.id,
      phone: lead.phone,
      customerName: lead.customerName,
      isHistoricalRecord: lead.isHistoricalRecord || lead.batch.isHistoricalRecord,
      historicalSourceName: lead.historicalSourceName,
      attributionOwnerName: lead.attributionOwner?.name ?? lead.owner.name,
      ownerName: lead.owner.name,
      groupName: lead.batch.group.name,
      expertOwnerId: lead.expertOwnerId,
      expertOwnerName: lead.expertOwner?.name ?? null,
      // 历史补录会创建系统批次，真正选择／手填的来源单独保存在客户上。
      // 专家端必须优先展示这份真实来源，不能把“系统历史补录”误当成渠道。
      source: `${lead.batch.sourceDate} · ${lead.historicalSourceName?.trim() || lead.batch.channel.name}`,
      groupStatus: lead.groupStatus,
      leftOn: lead.leftOn,
      leftNote: lead.leftNote,
      leftAutomatically: lead.leftAutomatically,
      joinedOn: lead.joinedOn,
      repliedOn: lead.repliedOn,
      followUpCount: lead.followUpCount,
      lastFollowedUpOn: lead.lastFollowedUpOn,
      deviceCode: lead.device?.code ?? null,
      lossAmountCents: lead.lossAmountCents,
      customerPlatform: lead.customerPlatform,
      expertIntroducedOn: lead.expertIntroducedOn,
      expertContactedOn: lead.expertContactedOn,
      expertContactNote: lead.expertContactNote,
      expertWorkflowStage: lead.expertWorkflowStage,
      expertStageChangedAt: lead.expertStageChangedAt,
      expertTrackingStartedAt: lead.expertTrackingStartedAt,
      groupDeviceAccountId: lead.groupDeviceAccountId,
      groupDeviceAccountNumber: lead.groupDeviceAccountNumber,
      expertDeviceAccountId: lead.expertDeviceAccountId,
      expertDeviceAccountNumber: lead.expertDeviceAccountNumber,
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
      nextFollowUpOn: lead.nextFollowUpOn,
      groupProgress,
      lastActivity: latestExpertActivity ? {
        occurredOn: latestExpertActivity.occurredOn,
        note: latestExpertActivity.note,
        actorName: latestExpertActivity.actor.name,
      } : null,
      order: order ? {
        id: order.id,
        openedOn: order.openedOn,
        initialDepositCents: order.initialDepositCents,
        initialDepositMethod: order.initialDepositMethod,
        voided: Boolean(order.voidedAt),
        rechargeCents: events.filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null).reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
        withdrawalCents: events.filter((event) => event.kind === "WITHDRAWAL").reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
        latestFinancialOn: events[0]?.occurredOn ?? null,
        events: events.map((event) => ({
          id: event.id,
          kind: event.kind as "RECHARGE" | "WITHDRAWAL",
          amountCents: event.amountCents ?? 0,
          occurredOn: event.occurredOn,
          continuationNumber: event.continuationNumber,
          depositMethod: event.depositMethod,
        })),
      } : null,
    };
  });

  const normalizedAssignees = assignees.map((member) => ({ ...member, role: member.role === "LEAD" ? "LEAD" as const : "EXPERT" as const }));
  const normalizedExpertMembers = expertMembers.map((member) => ({ ...member, role: member.role === "LEAD" ? "LEAD" as const : "EXPERT" as const }));
  return { customers, assignees: normalizedAssignees, expertMembers: normalizedExpertMembers, totalCustomers, performanceSummary };
}

export async function loadExpertPendingCustomerPage(input: {
  groupId: string;
  expertId: string;
  kind: "registration" | "order";
  from?: string;
  to?: string;
  query: string;
  page: number;
  pageSize: number;
}) {
  if (input.expertId !== "__unassigned__") {
    const expertExists = await db.user.count({
      where: { id: input.expertId, groupId: input.groupId, role: { in: ["LEAD", "EXPERT"] } },
    });
    if (!expertExists) return null;
  }
  const where: Prisma.LeadCustomerWhereInput = {
    // 待注册/待开单属于正常流程卡点；历史客户只保留已发生的订单和资金。
    isHistoricalRecord: false,
    trackingArchivedAt: null,
    batch: {
      groupId: input.groupId,
      isHistoricalRecord: false,
      ...(input.from || input.to
        ? { sourceDate: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
        : {}),
    },
    expertIntroducedOn: { not: null },
    expertContactedOn: { not: null },
    expertOwnerId: input.expertId === "__unassigned__" ? null : input.expertId,
    ...(input.kind === "registration"
      ? { registeredOn: null }
      : {
          registeredOn: { not: null },
          OR: [{ customerOrder: null }, { customerOrder: { voidedAt: { not: null } } }],
        }),
    ...(input.query ? { AND: [{ OR: [{ phone: { contains: input.query } }, { customerName: { contains: input.query } }] }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.leadCustomer.findMany({
      where,
      select: {
        id: true, phone: true, customerName: true, expertIntroducedOn: true,
        registeredOn: true, nextPlan: true, nextFollowUpOn: true,
        owner: { select: { name: true } },
        batch: { select: { sourceDate: true, channel: { select: { name: true } } } },
      },
      orderBy: [{ nextFollowUpOn: "asc" }, { expertIntroducedOn: "asc" }, { updatedAt: "asc" }],
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
      status: input.kind === "registration" ? "待注册" as const : "待开单" as const,
      receptionName: lead.owner.name,
      source: `${lead.batch.sourceDate} · ${lead.batch.channel.name}`,
      expertIntroducedOn: lead.expertIntroducedOn,
      registeredOn: lead.registeredOn,
      nextPlan: lead.nextPlan,
      nextFollowUpOn: lead.nextFollowUpOn,
    })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}
