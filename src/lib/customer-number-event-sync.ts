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
