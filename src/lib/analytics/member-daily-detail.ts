import type { Role } from "@prisma/client";
import { db } from "../db";
import { assessGroupLeave } from "../group-leave";
import { getApprovedInvalidFanTotals } from "../invalid-fan-reports";

export type DailyMemberRole = Extract<Role, "RECEPTION" | "GROUP_OPERATOR" | "EXPERT">;

export type MemberDailyRow = {
  date: string;
  added: number;
  duplicate?: number;
  lowAmount: number;
  noWs: number;
  invalid: number;
  valid: number;
  replied: number;
  joined: number;
  left: number;
  abnormalLeft: number;
  inGroup: number;
  eligibleForExpert: number;
  introduced: number;
  contacted: number;
  registered: number;
  ordered: number;
  depositCents: number;
  withdrawalCents: number;
  netCents: number;
};

export type MemberDailyDetail = {
  member: { id: string; name: string; role: DailyMemberRole; groupName: string };
  from: string;
  to: string;
  rows: MemberDailyRow[];
};

const emptyRow = (date: string): MemberDailyRow => ({
  date,
  added: 0,
  duplicate: 0,
  lowAmount: 0,
  noWs: 0,
  invalid: 0,
  valid: 0,
  replied: 0,
  joined: 0,
  left: 0,
  abnormalLeft: 0,
  inGroup: 0,
  eligibleForExpert: 0,
  introduced: 0,
  contacted: 0,
  registered: 0,
  ordered: 0,
  depositCents: 0,
  withdrawalCents: 0,
  netCents: 0,
});

function allDates(from: string, to: string) {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function isResourceEligible(lead: { invalid: boolean; receptionCategory: string }) {
  return !lead.invalid && !["INVALID", "LOW_AMOUNT", "NO_WS"].includes(lead.receptionCategory);
}

function isWithin(date: string | null | undefined, from: string, to: string) {
  return Boolean(date && date >= from && date <= to);
}

export async function loadMemberDailyDetail(input: {
  groupIds: string[];
  memberId?: string;
  role: DailyMemberRole;
  from: string;
  to: string;
  channelIds?: string[];
  normalizedName?: string;
}): Promise<MemberDailyDetail | null> {
  if (!input.memberId || !input.groupIds.length) return null;

  const member = await db.user.findFirst({
    where: {
      id: input.memberId,
      groupId: { in: input.groupIds },
      // 兼任人员按当前查看的岗位加载每日数据，不能只按主岗位过滤。
      // 组长在专家流程中可以作为默认接待负责人，因此也列入专家明细。
      OR: [
        { role: input.role },
        { roleAssignments: { some: { role: input.role } } },
        ...(input.role === "EXPERT" ? [{ role: "LEAD" as const }] : []),
      ],
    },
    select: { id: true, name: true, group: { select: { name: true } } },
  });
  if (!member?.group) return null;

  const ownerWhere = input.role === "RECEPTION"
    ? { ownerId: member.id }
    : input.role === "GROUP_OPERATOR"
      ? { groupOperatorOwnerId: member.id }
      : { expertOwnerId: member.id };
  const dateRange = { gte: input.from, lte: input.to };
  const leads = await db.leadCustomer.findMany({
    where: {
      ...ownerWhere,
      batch: {
        groupId: member.group ? { in: input.groupIds } : undefined,
        ...(input.channelIds ? { channelId: { in: input.channelIds } } : {}),
        ...(input.normalizedName ? { channel: { normalizedName: input.normalizedName } } : {}),
      },
      OR: [
        { batch: { sourceDate: dateRange } },
        { repliedOn: dateRange },
        { joinedOn: dateRange },
        { leftOn: dateRange },
        { expertIntroducedOn: dateRange },
        { expertContactedOn: dateRange },
        { registeredOn: dateRange },
        { customerOrder: { is: { openedOn: dateRange, voidedAt: null } } },
        { customerOrder: { is: { events: { some: { occurredOn: dateRange, voidedAt: null } } } } },
      ],
    },
    select: {
      isHistoricalRecord: true,
      invalid: true,
      receptionCategory: true,
      repliedOn: true,
      joinedOn: true,
      leftOn: true,
      expertIntroducedOn: true,
      expertContactedOn: true,
      registeredOn: true,
      batch: { select: { sourceDate: true, isHistoricalRecord: true } },
      customerOrder: {
        select: {
          openedOn: true,
          initialDepositCents: true,
          voidedAt: true,
          events: { where: { voidedAt: null }, select: { kind: true, amountCents: true, occurredOn: true, continuationNumber: true } },
        },
      },
    },
  });

  const duplicateEvents = input.role === "RECEPTION" ? await db.metricEvent.findMany({
    where: {
      enteredById: member.id,
      kind: "DUPLICATE_FANS",
      voidedAt: null,
      batch: {
        groupId: { in: input.groupIds },
        sourceDate: dateRange,
        ...(input.channelIds ? { channelId: { in: input.channelIds } } : {}),
        ...(input.normalizedName ? { channel: { normalizedName: input.normalizedName } } : {}),
      },
    },
    select: { quantity: true, batch: { select: { sourceDate: true } } },
  }) : [];
  const approvedInvalidReports = input.role === "RECEPTION"
    ? await getApprovedInvalidFanTotals({
      groupIds: input.groupIds,
      reporterIds: [member.id],
      sourceDateFrom: input.from,
      sourceDateTo: input.to,
      channelIds: input.channelIds,
      normalizedChannelName: input.normalizedName,
    })
    : [];

  const rows = new Map(allDates(input.from, input.to).map((date) => [date, emptyRow(date)]));
  const rowFor = (date: string | null | undefined) => date && rows.get(date);
  for (const lead of leads) {
    const historical = lead.isHistoricalRecord || lead.batch.isHistoricalRecord;
    const reportEligible = isResourceEligible(lead);
    if (!historical && input.role === "RECEPTION") {
      const row = rowFor(lead.batch.sourceDate);
      if (row) {
        row.added += 1;
        if (lead.invalid || lead.receptionCategory === "INVALID") row.invalid += 1;
        if (lead.receptionCategory === "LOW_AMOUNT") row.lowAmount += 1;
        if (lead.receptionCategory === "NO_WS") row.noWs += 1;
        if (isResourceEligible(lead)) row.valid += 1;
      }
    }
    if (!reportEligible) continue;
    if (!historical) {
      const replyRow = rowFor(lead.repliedOn);
      if (replyRow && input.role === "RECEPTION") replyRow.replied += 1;
      const joinRow = rowFor(lead.joinedOn);
      if (joinRow && (input.role === "RECEPTION" || input.role === "GROUP_OPERATOR")) joinRow.joined += 1;
      const leftRow = rowFor(lead.leftOn);
      if (leftRow && input.role === "GROUP_OPERATOR") {
        leftRow.left += 1;
        if (assessGroupLeave(lead.joinedOn, lead.leftOn).level === "EARLY") leftRow.abnormalLeft += 1;
      }
      const introducedRow = rowFor(lead.expertIntroducedOn);
      if (introducedRow && input.role === "GROUP_OPERATOR") introducedRow.introduced += 1;
      const contactedRow = rowFor(lead.expertContactedOn);
      if (contactedRow && input.role === "EXPERT") contactedRow.contacted += 1;
      const registeredRow = rowFor(lead.registeredOn);
      if (registeredRow && input.role === "EXPERT") registeredRow.registered += 1;
    }

    const order = lead.customerOrder;
    if (!order || order.voidedAt) continue;
    const openedRow = rowFor(order.openedOn);
    if (openedRow && input.role === "EXPERT") {
      openedRow.ordered += 1;
      openedRow.depositCents += order.initialDepositCents;
    }
    for (const event of order.events) {
      const eventRow = rowFor(event.occurredOn);
      if (!eventRow || input.role !== "EXPERT") continue;
      if (event.kind === "RECHARGE" && event.continuationNumber !== null) eventRow.depositCents += event.amountCents ?? 0;
      if (event.kind === "WITHDRAWAL") eventRow.withdrawalCents += event.amountCents ?? 0;
    }
  }

  for (const event of duplicateEvents) {
    const row = rowFor(event.batch.sourceDate);
    if (row) row.duplicate = (row.duplicate ?? 0) + (event.quantity ?? 0);
  }

  for (const report of approvedInvalidReports) {
    const row = rowFor(report.sourceDate);
    if (!row) continue;
    row.added += report.total;
    row.lowAmount += report.lowAmountCount;
    row.noWs += report.noWsCount;
    row.duplicate = (row.duplicate ?? 0) + report.collisionCount;
  }

  if (input.role === "GROUP_OPERATOR") {
    for (const row of rows.values()) {
      row.inGroup = leads.filter((lead) => !lead.isHistoricalRecord && !lead.batch.isHistoricalRecord && isResourceEligible(lead) && lead.joinedOn && lead.joinedOn <= row.date && (!lead.leftOn || lead.leftOn > row.date)).length;
      row.eligibleForExpert = leads.filter((lead) => !lead.isHistoricalRecord && !lead.batch.isHistoricalRecord && isResourceEligible(lead) && lead.joinedOn && lead.joinedOn <= addDays(row.date, -2) && (!lead.leftOn || lead.leftOn > row.date) && (!lead.expertIntroducedOn || lead.expertIntroducedOn > row.date)).length;
    }
  }
  for (const row of rows.values()) row.netCents = row.depositCents - row.withdrawalCents;

  return {
    member: { id: member.id, name: member.name, role: input.role, groupName: member.group.name },
    from: input.from,
    to: input.to,
    rows: [...rows.values()].sort((left, right) => right.date.localeCompare(left.date)),
  };
}
