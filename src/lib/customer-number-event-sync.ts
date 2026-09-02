import type { Prisma } from "@prisma/client";
import { customerCurrentGroupWhere } from "./customer-current-group";
import { incrementCustomerEventDailyStat } from "./daily-stats";

export type NumberTrackedLead = {
  phone: string;
  ownerId: string;
  attributionOwnerId: string | null;
  groupOperatorOwnerId: string | null;
  expertOwnerId: string | null;
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

async function currentInGroupSnapshot(tx: Prisma.TransactionClient, lead: NumberTrackedLead) {
  return tx.leadCustomer.count({
    where: {
      AND: [customerCurrentGroupWhere(lead.batch.groupId)],
      attributionOwnerId: receptionOwnerId(lead),
      groupOperatorOwnerId: lead.groupOperatorOwnerId,
      groupStatus: "JOINED",
      batch: { channelId: lead.batch.channelId },
      invalid: false,
    },
  });
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
  const delta = input.delta ?? 1;
  const ownerId = lead.groupOperatorOwnerId ?? receptionOwnerId(lead);
  const increment = input.kind === "JOIN"
    ? { operatorReceivedCount: delta }
    : input.kind === "NORMAL_LEAVE"
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
  const ownerId = lead.expertOwnerId ?? lead.groupOperatorOwnerId ?? receptionOwnerId(lead);
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
  const ownerId = lead.expertOwnerId ?? lead.groupOperatorOwnerId ?? receptionOwnerId(lead);
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
  const ownerId = lead.expertOwnerId ?? lead.groupOperatorOwnerId ?? receptionOwnerId(lead);
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
