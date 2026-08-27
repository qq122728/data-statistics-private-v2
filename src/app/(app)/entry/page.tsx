import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { EntryTabs } from "../../../components/entry/EntryTabs";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { getApprovedInvalidFanTotals } from "../../../lib/invalid-fan-reports";
import { getAssignedRoles, hasAssignedRole } from "../../../lib/role-access";

const leadSelect = {
  id: true,
  phone: true,
  isHistoricalRecord: true,
  historicalSourceName: true,
  invalid: true,
  invalidReason: true,
  receptionCategory: true,
  replyStatus: true,
  repliedOn: true,
  followUpCount: true,
  lastFollowedUpOn: true,
  customerName: true,
  customerEmail: true,
  lossAmountCents: true,
  customerPlatform: true,
  groupStatus: true,
  joinedOn: true,
  leftOn: true,
  expertIntroducedOn: true,
  expertContactedOn: true,
  expertContactNote: true,
  expertWorkflowStage: true,
  expertStageChangedAt: true,
  expertTrackingStartedAt: true,
  registeredOn: true,
  expertNotes: true,
  nextPlan: true,
  nextFollowUpOn: true,
  notes: true,
  receptionChatStatus: true,
  receptionStatusChangedAt: true,
  receptionArchivedAt: true,
  receptionArchiveReason: true,
  receptionArchiveVisitCount: true,
  groupOperatorOwner: { select: { name: true } },
  expertOwner: { select: { name: true } },
  attributionOwner: { select: { name: true } },
  owner: {
    select: {
      name: true,
      receptionistAssignments: {
        select: { groupOperator: { select: { name: true } } },
        take: 1,
      },
    },
  },
  activities: {
    where: { kind: { in: ["GROUP_PROGRESS_UPDATED", "REPLIED", "REPLY_UNDONE"] } },
    select: { id: true, kind: true, occurredOn: true, note: true, actor: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  },
  device: { select: { id: true, code: true } },
  batch: { select: { id: true, sourceDate: true, isHistoricalRecord: true, fanCostModeSnapshot: true, effectiveFanPriceCentsSnapshot: true, channelTypeSnapshot: true, rebateRateBpsSnapshot: true, group: { select: { name: true } }, channel: { select: { id: true, name: true } } } },
  customerOrder: {
    select: {
      id: true, openedOn: true, initialDepositCents: true, voidedAt: true, voidReason: true,
      events: { where: { kind: { in: ["RECHARGE", "WITHDRAWAL"] } }, select: { id: true, kind: true, amountCents: true, occurredOn: true, continuationNumber: true, voidedAt: true, voidReason: true } },
    },
  },
} satisfies Prisma.LeadCustomerSelect;

type SummaryRow = {
  isHistoricalRecord: boolean;
  invalid: boolean;
  repliedOn: string | null;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
  expertIntroducedOn: string | null;
  registeredOn: string | null;
  customerOrder: null | { initialDepositCents: number; voidedAt: Date | null; events: Array<{ kind: string; amountCents: number | null; continuationNumber: number | null; voidedAt: Date | null }> };
};

function summarize(rows: SummaryRow[]) {
  const flowRows = rows.filter((row) => !row.isHistoricalRecord);
  const valid = flowRows.filter((row) => !row.invalid);
  const orders = rows.filter((row) => row.customerOrder && !row.customerOrder.voidedAt);
  const initialCents = orders.reduce((sum, row) => sum + (row.customerOrder?.initialDepositCents ?? 0), 0);
  const rechargeCents = orders.reduce((sum, row) => sum + (row.customerOrder?.events ?? [])
    .filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null && !event.voidedAt)
    .reduce((subtotal, event) => subtotal + (event.amountCents ?? 0), 0), 0);
  const withdrawalCents = orders.reduce((sum, row) => sum + (row.customerOrder?.events ?? [])
    .filter((event) => event.kind === "WITHDRAWAL" && !event.voidedAt)
    .reduce((subtotal, event) => subtotal + (event.amountCents ?? 0), 0), 0);
  return {
    valid: valid.length,
    invalid: flowRows.length - valid.length,
    replied: valid.filter((row) => row.repliedOn).length,
    inGroup: valid.filter((row) => row.groupStatus === "JOINED").length,
    introduced: valid.filter((row) => row.expertIntroducedOn).length,
    registered: valid.filter((row) => row.registeredOn).length,
    orders: orders.length,
    initialCents,
    rechargeCents,
    withdrawalCents,
    netCents: initialCents + rechargeCents - withdrawalCents,
  };
}

export default async function EntryPage() {
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/entry");
    throw error;
  }
  const canUseReceptionWorkspace = hasAssignedRole(user, "RECEPTION");
  const isLead = hasAssignedRole(user, "LEAD");
  if (!canUseReceptionWorkspace && !isLead) redirect("/dashboard");
  const groupId = user.groupId ?? "__none__";
  const memberOnly = canUseReceptionWorkspace && !isLead;
  const [channels, batches, settings, leads, groupLeads, exceptions, devices, approvedInvalidReports, attributionOwners, historicalMembers, historicalChannels] = await Promise.all([
    // 当前登录人已绑定到这个小组；这里无需再套 relation filter。
    // SQLite/PostgreSQL 两端对一对多 relation filter 的写法不同，直接按 groupId 可避免页面加载报错。
    db.channel.findMany({ where: { groupId, active: true }, select: { id: true, name: true, groupId: true, channelType: true }, orderBy: [{ channelType: "asc" }, { name: "asc" }] }),
    db.sourceBatch.findMany({ where: { groupId }, select: { id: true, sourceDate: true, fanCostModeSnapshot: true, effectiveFanPriceCentsSnapshot: true, channelTypeSnapshot: true, rebateRateBpsSnapshot: true, group: { select: { name: true } }, channel: { select: { id: true, name: true } } }, orderBy: [{ sourceDate: "desc" }, { channelId: "asc" }] }),
    getSystemSettings(),
    db.leadCustomer.findMany({ where: memberOnly ? { ownerId: user.id } : { batch: { groupId } }, select: leadSelect, orderBy: [{ updatedAt: "desc" }] }),
    db.leadCustomer.findMany({ where: { batch: { groupId } }, select: leadSelect }),
    db.leadException.findMany({
      where: memberOnly ? { actorId: user.id } : { batch: { groupId } },
      select: {
        id: true, phone: true, kind: true, reason: true, occurredOn: true,
        actor: { select: { name: true } }, owner: { select: { name: true } },
        lead: { select: { customerName: true } },
        batch: { select: { sourceDate: true, channel: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: "desc" }], take: 100,
    }),
    db.device.findMany({
      where: { groupId, memberId: user.id, active: true },
      select: { id: true, code: true },
      orderBy: { code: "asc" },
    }),
    getApprovedInvalidFanTotals({
      groupIds: [groupId],
      ...(memberOnly ? { reporterIds: [user.id] } : {}),
    }),
    // 粉的归属只允许选当前小组内在职成员，避免跨公司／跨组串业绩。
    db.user.findMany({
      where: { groupId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { groupId },
      select: { id: true, name: true, active: true, role: true, roleAssignments: { select: { role: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    db.channel.findMany({
      where: { groupId, name: { not: "专家历史补录（系统）" } },
      select: { id: true, name: true, active: true, channelType: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
  ]);

  const channelRows = [...new Set(groupLeads.map((lead) => lead.batch.channel.name))].map((channel) => ({
    channel,
    mine: summarize(leads.filter((lead) => lead.batch.channel.name === channel)),
    group: summarize(groupLeads.filter((lead) => lead.batch.channel.name === channel)),
  }));
  const timezone = await resolveUserBusinessTimezone(user, settings.timezone);

  return <main className="page-shell entry-page"><EntryTabs
    role={isLead ? "LEAD" : "RECEPTION"}
    channels={channels}
    batches={batches}
    leads={leads}
    exceptions={exceptions}
    overview={{ mine: summarize(leads), group: summarize(groupLeads), channels: channelRows }}
    invalidReports={approvedInvalidReports}
    timezone={timezone}
    allowMemberChannelCreation={false}
    devices={devices}
    attributionOwners={attributionOwners}
    defaultAttributionOwnerId={user.id}
    historicalMembers={historicalMembers.map((member) => ({ id: member.id, name: member.name, active: member.active, roleLabel: getAssignedRoles(member).map((role) => role === "RECEPTION" ? "接粉" : role === "GROUP_OPERATOR" ? "炒群" : role === "EXPERT" ? "专家" : role === "LEAD" ? "组长" : role).join("／") || "成员" }))}
    historicalChannels={historicalChannels}
    currentUserId={user.id}
  /></main>;
}
