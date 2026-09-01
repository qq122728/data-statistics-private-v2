import type { DepositMethod, Prisma } from "@prisma/client";
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
  input: { businessDate: string; amountCents: number; method: DepositMethod | null; delta?: number },
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
    reason: `${lead.phone} 开单首充`,
    increment: {
      orderCount: delta,
      ...(input.method === "BANK"
        ? { bankInitialDepositCents: input.amountCents * delta }
        : { cryptoInitialDepositCents: input.amountCents * delta }),
    },
  });
}

export async function syncCustomerFinanceEvent(
  tx: Prisma.TransactionClient,
  lead: NumberTrackedLead,
  input: { businessDate: string; kind: "RECHARGE" | "WITHDRAWAL"; amountCents: number; method: DepositMethod | null; delta?: number },
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
    reason: `${lead.phone} ${input.kind}`,
    increment: input.kind === "WITHDRAWAL"
      ? { withdrawalCents: input.amountCents * delta }
      : input.method === "BANK"
        ? { bankRechargeCents: input.amountCents * delta }
        : { cryptoRechargeCents: input.amountCents * delta },
  });
}
