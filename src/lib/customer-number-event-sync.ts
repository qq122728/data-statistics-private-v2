import { Prisma } from "@prisma/client";
import { customerCurrentGroupWhere } from "./customer-current-group";
import { usesCustomerNumberTracking } from "./customer-number-tracking";
import { isPostgresDatabase } from "./database-provider";
import { incrementCustomerEventDailyStat } from "./daily-stats";

export type NumberTrackedLead = {
  phone: string;
  ownerId: string;
  attributionOwnerId: string | null;
  groupOperatorOwnerId: string | null;
  expertOwnerId: string | null;
  currentGroupId?: string | null;
  batch: { groupId: string; channelId: string };
};

export type NumberTrackedCustomerProgress = NumberTrackedLead & {
  joinedOn: string | null;
  leftOn: string | null;
  leftWithOrder: boolean | null;
  expertIntroducedOn: string | null;
  expertContactedOn: string | null;
  registeredOn: string | null;
  customerOrder?: { openedOn: string; voidedAt: Date | null } | null;
};

function receptionOwnerId(lead: NumberTrackedLead) {
  return lead.attributionOwnerId ?? lead.ownerId;
}

/**
 * 日报按“这是谁接来的粉”留在原来源组。客户或执行专家跨组后，不能再拿新组
 * 的执行人去写原组日报；优先改由仍在原组的接粉人承载，必要时由原组在职组长承载。
 */
async function dailyStatCarrierId(tx: Prisma.TransactionClient, lead: NumberTrackedLead, preferredOwnerId: string) {
  const sourceGroupId = lead.batch.groupId;
  const preferredIds = [...new Set([preferredOwnerId, receptionOwnerId(lead)])];
  const preferred = await tx.user.findMany({
    where: { id: { in: preferredIds }, groupId: sourceGroupId, active: true },
    select: { id: true },
  });
  const available = new Set(preferred.map((item) => item.id));
  const matched = preferredIds.find((id) => available.has(id));
  if (matched) return matched;
  const fallback = await tx.user.findFirst({
    where: {
      groupId: sourceGroupId,
      active: true,
      OR: [
        { role: { in: ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] } },
        { roleAssignments: { some: { role: { in: ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] } } } },
      ],
    },
    select: { id: true },
    orderBy: [{ role: "asc" }, { id: "asc" }],
  });
  return fallback?.id ?? receptionOwnerId(lead);
}

async function currentInGroupSnapshot(tx: Prisma.TransactionClient, lead: NumberTrackedLead) {
  return tx.leadCustomer.count({
    where: {
      AND: [customerCurrentGroupWhere(lead.batch.groupId)],
      attributionOwnerId: receptionOwnerId(lead),
      groupOperatorOwnerId: lead.groupOperatorOwnerId,
      groupStatus: "JOINED",
      batch: { channelId: lead.batch.channelId },
      invalid: false,
      trackingArchivedAt: null,
    },
  });
}

/**
 * 进群数以客户进度表为唯一事实来源，不再相信调用方传来的 +1/-1。
 *
 * 同一来源线可能由不同炒群人员承载过日报，因此先汇总该来源线已有的全部
 * GROUP_OPERATOR 行，再把差额补上或逐行扣除。重复调用时差额为 0，不会重复记账。
 */
async function loadCustomerJoinBucket(
  tx: Prisma.TransactionClient,
  lead: NumberTrackedLead,
  businessDate: string,
) {
  const sourceReceptionId = receptionOwnerId(lead);
  const desiredCount = await tx.leadCustomer.count({
    where: {
      joinedOn: businessDate,
      invalid: false,
      trackingArchivedAt: null,
      batch: {
        groupId: lead.batch.groupId,
        channelId: lead.batch.channelId,
      },
      AND: [
        {
          OR: [
            { attributionOwnerId: sourceReceptionId },
            { attributionOwnerId: null, ownerId: sourceReceptionId },
          ],
        },
        {
          OR: [
            // 正常新增客户直接按真实进群日期计数。
            { isHistoricalRecord: false, batch: { isHistoricalRecord: false } },
            // 历史粉只有在切换日后真实发生进群时才计数。
            { historicalJoinCounted: true },
            // 兼容旧版本已留下真实“进群”操作记录、但漏写 counted 标记的数据。
            { activities: { some: { kind: "JOINED_GROUP", occurredOn: businessDate } } },
          ],
        },
      ],
    },
  });

  const candidates = await tx.dailyStatEntry.findMany({
    where: {
      groupId: lead.batch.groupId,
      channelId: lead.batch.channelId,
      businessDate,
      position: "GROUP_OPERATOR",
      sourceReceptionId,
      currentRevisionId: { not: null },
    },
    include: { currentRevision: true },
    orderBy: { createdAt: "asc" },
  });
  const existingCount = candidates.reduce(
    (sum, entry) => sum + (entry.currentRevision?.operatorReceivedCount ?? 0),
    0,
  );
  return { sourceReceptionId, desiredCount, existingCount, candidates };
}

export async function inspectCustomerJoinEvent(
  tx: Prisma.TransactionClient,
  lead: NumberTrackedLead,
  businessDate: string,
) {
  if (!usesCustomerNumberTracking(businessDate)) {
    return { desiredCount: 0, existingCount: 0, difference: 0 };
  }
  const { desiredCount, existingCount } = await loadCustomerJoinBucket(tx, lead, businessDate);
  return { desiredCount, existingCount, difference: desiredCount - existingCount };
}

export async function reconcileCustomerJoinEvent(
  tx: Prisma.TransactionClient,
  lead: NumberTrackedLead,
  businessDate: string,
) {
  if (!usesCustomerNumberTracking(businessDate)) return null;

  const sourceReceptionId = receptionOwnerId(lead);
  const bucketKey = [lead.batch.groupId, lead.batch.channelId, businessDate, sourceReceptionId].join(":");
  // 线上 PostgreSQL 可能同时收到两个保存请求。同一统计桶串行核对，避免两个请求
  // 都读到旧数后各自补一次；SQLite 单元测试本身就是串行写入，无需数据库锁。
  if (isPostgresDatabase()) {
    await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${bucketKey}))`);
  }

  const bucket = await loadCustomerJoinBucket(tx, lead, businessDate);
  const { desiredCount, existingCount, candidates } = bucket;
  const difference = desiredCount - existingCount;
  if (difference === 0) return null;

  const snapshot = await currentInGroupSnapshot(tx, lead);
  if (difference > 0) {
    const ownerId = await dailyStatCarrierId(
      tx,
      lead,
      lead.groupOperatorOwnerId ?? sourceReceptionId,
    );
    return incrementCustomerEventDailyStat(tx, {
      ownerId,
      groupId: lead.batch.groupId,
      channelId: lead.batch.channelId,
      businessDate,
      position: "GROUP_OPERATOR",
      sourceReceptionId,
      reason: `${lead.phone} 进群自动对账`,
      increment: { operatorReceivedCount: difference },
      currentInGroupSnapshot: snapshot,
    });
  }

  let remaining = -difference;
  let result = null;
  const preferredOwnerId = lead.groupOperatorOwnerId ?? sourceReceptionId;
  const positiveCandidates = candidates
    .filter((entry) => (entry.currentRevision?.operatorReceivedCount ?? 0) > 0)
    .sort((left, right) => Number(right.ownerId === preferredOwnerId) - Number(left.ownerId === preferredOwnerId));
  for (const candidate of positiveCandidates) {
    if (remaining === 0) break;
    const recorded = candidate.currentRevision?.operatorReceivedCount ?? 0;
    const decrement = Math.min(recorded, remaining);
    result = await incrementCustomerEventDailyStat(tx, {
      ownerId: candidate.ownerId,
      groupId: candidate.groupId,
      channelId: candidate.channelId,
      businessDate: candidate.businessDate,
      position: "GROUP_OPERATOR",
      sourceReceptionId,
      sourceGroupOperatorId: candidate.sourceGroupOperatorId,
      reason: `${lead.phone} 进群自动对账`,
      increment: { operatorReceivedCount: -decrement },
      currentInGroupSnapshot: snapshot,
    });
    remaining -= decrement;
  }
  return result;
}

export async function syncCustomerGroupEvent(
  tx: Prisma.TransactionClient,
  lead: NumberTrackedLead,
  input: {
    businessDate: string;
    kind: "JOIN" | "NORMAL_LEAVE" | "ABNORMAL_LEAVE" | "EXPERT_INTRO";
    delta?: number;
  },
) {
  if (input.kind === "JOIN") {
    return reconcileCustomerJoinEvent(tx, lead, input.businessDate);
  }
  const delta = input.delta ?? 1;
  const ownerId = await dailyStatCarrierId(tx, lead, lead.groupOperatorOwnerId ?? receptionOwnerId(lead));
  const increment = input.kind === "NORMAL_LEAVE"
      ? { normalLeaveCount: delta }
      : input.kind === "ABNORMAL_LEAVE"
        ? { abnormalLeaveCount: delta }
        : { expertIntroCount: delta };
  const snapshot = input.kind === "EXPERT_INTRO" ? undefined : await currentInGroupSnapshot(tx, lead);
  return incrementCustomerEventDailyStat(tx, {
    ownerId,
    groupId: lead.batch.groupId,
    channelId: lead.batch.channelId,
    businessDate: input.businessDate,
    position: "GROUP_OPERATOR",
    sourceReceptionId: receptionOwnerId(lead),
    reason: `${lead.phone} ${input.kind}`,
    increment,
    ...(snapshot === undefined ? {} : { currentInGroupSnapshot: snapshot }),
  });
}

export async function syncCustomerRegistrationEvent(
  tx: Prisma.TransactionClient,
  lead: NumberTrackedLead,
  businessDate: string,
  delta = 1,
) {
  const ownerId = await dailyStatCarrierId(tx, lead, lead.expertOwnerId ?? lead.groupOperatorOwnerId ?? receptionOwnerId(lead));
  return incrementCustomerEventDailyStat(tx, {
    ownerId,
    groupId: lead.batch.groupId,
    channelId: lead.batch.channelId,
    businessDate,
    position: "EXPERT",
    sourceReceptionId: receptionOwnerId(lead),
    sourceGroupOperatorId: lead.groupOperatorOwnerId ?? ownerId,
    reason: `${lead.phone} 注册`,
    increment: { registrationCount: delta },
  });
}

export async function syncCustomerExpertEvent(
  tx: Prisma.TransactionClient,
  lead: NumberTrackedLead,
  input: { businessDate: string; kind: "RECEIVED" | "CONTACTED"; delta?: number },
) {
  const delta = input.delta ?? 1;
  const ownerId = await dailyStatCarrierId(tx, lead, lead.expertOwnerId ?? lead.groupOperatorOwnerId ?? receptionOwnerId(lead));
  return incrementCustomerEventDailyStat(tx, {
    ownerId,
    groupId: lead.batch.groupId,
    channelId: lead.batch.channelId,
    businessDate: input.businessDate,
    position: "EXPERT",
    sourceReceptionId: receptionOwnerId(lead),
    sourceGroupOperatorId: lead.groupOperatorOwnerId ?? ownerId,
    reason: `${lead.phone} 专家${input.kind}`,
    increment: input.kind === "RECEIVED" ? { expertReceivedCount: delta } : { expertContactedCount: delta },
  });
}

/**
 * 纠正“推专家发生日期”时，把炒群端的推专家数和专家端的接收数一起搬到新日期。
 * 删除旧数时按来源接粉人寻找真实承载行，兼容负责人曾经被调整过的客户。
 */
export async function moveCustomerExpertIntroductionDate(
  tx: Prisma.TransactionClient,
  before: NumberTrackedLead,
  after: NumberTrackedLead,
  input: { from: string; to: string },
) {
  await removeRecordedEventFromBusinessAttribution(tx, before, {
    businessDate: input.from,
    position: "GROUP_OPERATOR",
    metric: "expertIntroCount",
  });
  await removeRecordedEventFromBusinessAttribution(tx, before, {
    businessDate: input.from,
    position: "EXPERT",
    metric: "expertReceivedCount",
  });
  await syncCustomerGroupEvent(tx, after, {
    businessDate: input.to,
    kind: "EXPERT_INTRO",
  });
  await syncCustomerExpertEvent(tx, after, {
    businessDate: input.to,
    kind: "RECEIVED",
  });
}

export async function syncCustomerOrderEvent(
  tx: Prisma.TransactionClient,
  lead: NumberTrackedLead,
  input: { businessDate: string; delta?: number },
) {
  const delta = input.delta ?? 1;
  const ownerId = await dailyStatCarrierId(tx, lead, lead.expertOwnerId ?? lead.groupOperatorOwnerId ?? receptionOwnerId(lead));
  return incrementCustomerEventDailyStat(tx, {
    ownerId,
    groupId: lead.batch.groupId,
    channelId: lead.batch.channelId,
    businessDate: input.businessDate,
    position: "EXPERT",
    sourceReceptionId: receptionOwnerId(lead),
    sourceGroupOperatorId: lead.groupOperatorOwnerId ?? ownerId,
    reason: `${lead.phone} 开单`,
    // 客户进度只确认“发生了开单”。首充、续充和出金属于客户跟踪账，
    // 公司最终认账金额仍由组员在每日财务数据中填写，避免同一笔钱重复统计。
    increment: { orderCount: delta },
  });
}

type RecordedMetric =
  | "operatorReceivedCount"
  | "normalLeaveCount"
  | "abnormalLeaveCount"
  | "expertIntroCount"
  | "expertReceivedCount"
  | "expertContactedCount"
  | "registrationCount"
  | "orderCount";

async function removeRecordedEventFromBusinessAttribution(
  tx: Prisma.TransactionClient,
  lead: NumberTrackedLead,
  input: { businessDate: string; position: "GROUP_OPERATOR" | "EXPERT"; metric: RecordedMetric },
) {
  const sourceReceptionId = receptionOwnerId(lead);
  const candidates = await tx.dailyStatEntry.findMany({
    where: {
      groupId: lead.batch.groupId,
      channelId: lead.batch.channelId,
      businessDate: input.businessDate,
      position: input.position,
      sourceReceptionId,
      currentRevisionId: { not: null },
    },
    include: { currentRevision: true },
    orderBy: { createdAt: "asc" },
  });
  const preferredOwnerId = input.position === "GROUP_OPERATOR"
    ? lead.groupOperatorOwnerId ?? sourceReceptionId
    : lead.expertOwnerId ?? lead.groupOperatorOwnerId ?? sourceReceptionId;
  const candidate = candidates
    .filter((entry) => (entry.currentRevision?.[input.metric] ?? 0) > 0)
    .sort((left, right) => Number(right.ownerId === preferredOwnerId) - Number(left.ownerId === preferredOwnerId))[0];
  if (!candidate) return;
  await incrementCustomerEventDailyStat(tx, {
    ownerId: candidate.ownerId,
    groupId: candidate.groupId,
    channelId: candidate.channelId,
    businessDate: candidate.businessDate,
    position: input.position,
    sourceReceptionId,
    sourceGroupOperatorId: candidate.sourceGroupOperatorId,
    reason: `${lead.phone} 纠正业务归属`,
    increment: { [input.metric]: -1 },
    ...(input.position === "GROUP_OPERATOR"
      ? { currentInGroupSnapshot: await currentInGroupSnapshot(tx, lead) }
      : {}),
  });
}

async function removeAllRecordedCustomerEvents(
  tx: Prisma.TransactionClient,
  lead: NumberTrackedCustomerProgress,
) {
  if (lead.joinedOn) await removeRecordedEventFromBusinessAttribution(tx, lead, {
    businessDate: lead.joinedOn, position: "GROUP_OPERATOR", metric: "operatorReceivedCount",
  });
  if (lead.leftOn) await removeRecordedEventFromBusinessAttribution(tx, lead, {
    businessDate: lead.leftOn,
    position: "GROUP_OPERATOR",
    metric: lead.leftWithOrder ? "normalLeaveCount" : "abnormalLeaveCount",
  });
  if (lead.expertIntroducedOn) {
    await removeRecordedEventFromBusinessAttribution(tx, lead, {
      businessDate: lead.expertIntroducedOn, position: "GROUP_OPERATOR", metric: "expertIntroCount",
    });
    await removeRecordedEventFromBusinessAttribution(tx, lead, {
      businessDate: lead.expertIntroducedOn, position: "EXPERT", metric: "expertReceivedCount",
    });
  }
  if (lead.expertContactedOn) await removeRecordedEventFromBusinessAttribution(tx, lead, {
    businessDate: lead.expertContactedOn, position: "EXPERT", metric: "expertContactedCount",
  });
  if (lead.registeredOn) await removeRecordedEventFromBusinessAttribution(tx, lead, {
    businessDate: lead.registeredOn, position: "EXPERT", metric: "registrationCount",
  });
  if (lead.customerOrder && !lead.customerOrder.voidedAt) {
    await removeRecordedEventFromBusinessAttribution(tx, lead, {
      businessDate: lead.customerOrder.openedOn, position: "EXPERT", metric: "orderCount",
    });
  }
}

async function addAllRecordedCustomerEvents(tx: Prisma.TransactionClient, lead: NumberTrackedCustomerProgress) {
  if (lead.joinedOn) await syncCustomerGroupEvent(tx, lead, { businessDate: lead.joinedOn, kind: "JOIN" });
  if (lead.leftOn) await syncCustomerGroupEvent(tx, lead, {
    businessDate: lead.leftOn,
    kind: lead.leftWithOrder ? "NORMAL_LEAVE" : "ABNORMAL_LEAVE",
  });
  if (lead.expertIntroducedOn) {
    await syncCustomerGroupEvent(tx, lead, { businessDate: lead.expertIntroducedOn, kind: "EXPERT_INTRO" });
    await syncCustomerExpertEvent(tx, lead, { businessDate: lead.expertIntroducedOn, kind: "RECEIVED" });
  }
  if (lead.expertContactedOn) await syncCustomerExpertEvent(tx, lead, { businessDate: lead.expertContactedOn, kind: "CONTACTED" });
  if (lead.registeredOn) await syncCustomerRegistrationEvent(tx, lead, lead.registeredOn);
  if (lead.customerOrder && !lead.customerOrder.voidedAt) {
    await syncCustomerOrderEvent(tx, lead, { businessDate: lead.customerOrder.openedOn });
  }
}

/**
 * 只有“来源渠道”或“接粉归属”纠错时才搬业务数据。
 * 炒群负责人和专家负责人只是执行进度的人，调整他们绝不能搬走接粉人的漏斗数据。
 */
export async function reattributeCustomerNumberEvents(
  tx: Prisma.TransactionClient,
  before: NumberTrackedCustomerProgress,
  after: NumberTrackedCustomerProgress,
) {
  await removeAllRecordedCustomerEvents(tx, before);
  await addAllRecordedCustomerEvents(tx, after);
}
