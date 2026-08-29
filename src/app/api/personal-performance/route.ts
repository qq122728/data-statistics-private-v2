import { NextResponse } from "next/server";

import { AuthenticationError, requireUser } from "../../../lib/auth";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { assessGroupLeave } from "../../../lib/group-leave";
import { resolveDateRangeWithDefault, type LeadDateRange } from "../../../lib/lead-date-range";
import { hasOversizedQueryValue } from "../../../lib/request-limits";
import { hasAssignedRole } from "../../../lib/role-access";
import { authorizationDenied } from "../../../lib/security-events";
import { getSystemSettings } from "../../../lib/settings";

type Role = "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
type Lead = {
  isHistoricalRecord: boolean; invalid: boolean; receptionCategory: string; repliedOn: string | null;
  joinedOn: string | null; leftOn: string | null; groupStatus: string; expertIntroducedOn: string | null;
  expertContactedOn: string | null; registeredOn: string | null; expertStalledOn: string | null; noInitialDepositOn: string | null;
  batch: { sourceDate: string; isHistoricalRecord: boolean };
  customerOrder: null | { openedOn: string; initialDepositCents: number; voidedAt: Date | null; events: Array<{ kind: string; occurredOn: string; amountCents: number | null; continuationNumber: number | null; voidedAt: Date | null }> };
};
const empty = () => ({ added: 0, lowAmount: 0, noWs: 0, effective: 0, replied: 0, joined: 0, left: 0, earlyLeft: 0, introduced: 0, contacted: 0, registered: 0, orders: 0, noInitialDeposit: 0, stalled: 0, initialDepositCents: 0, rechargeCents: 0, withdrawalCents: 0, netCents: 0 });
const inRange = (value: string | null | undefined, range: LeadDateRange) => Boolean(value && value >= range.from && value <= range.to);
const historical = (lead: Lead) => lead.isHistoricalRecord || lead.batch.isHistoricalRecord;
const invalid = (lead: Lead) => lead.invalid || ["INVALID", "LOW_AMOUNT", "NO_WS"].includes(lead.receptionCategory);
function summarize(leads: Lead[], range: LeadDateRange) {
  const totals = empty();
  for (const lead of leads) {
    if (!historical(lead) && inRange(lead.batch.sourceDate, range)) { totals.added += 1; if (lead.receptionCategory === "LOW_AMOUNT") totals.lowAmount += 1; if (lead.receptionCategory === "NO_WS") totals.noWs += 1; if (!invalid(lead)) totals.effective += 1; }
    if (!historical(lead)) {
      if (inRange(lead.repliedOn, range)) totals.replied += 1;
      if (inRange(lead.joinedOn, range)) totals.joined += 1;
      if (inRange(lead.leftOn, range)) { totals.left += 1; if (assessGroupLeave(lead.joinedOn, lead.leftOn).level === "EARLY") totals.earlyLeft += 1; }
      if (inRange(lead.expertIntroducedOn, range)) totals.introduced += 1;
      if (inRange(lead.expertContactedOn, range)) totals.contacted += 1;
      if (inRange(lead.registeredOn, range)) totals.registered += 1;
      if (inRange(lead.noInitialDepositOn, range)) totals.noInitialDeposit += 1;
      if (inRange(lead.expertStalledOn, range)) totals.stalled += 1;
    }
    const order = lead.customerOrder;
    if (!order || order.voidedAt) continue;
    if (inRange(order.openedOn, range)) { totals.orders += 1; totals.initialDepositCents += order.initialDepositCents; }
    for (const event of order.events) {
      if (event.voidedAt || !inRange(event.occurredOn, range)) continue;
      if (event.kind === "RECHARGE" && event.continuationNumber !== null) totals.rechargeCents += event.amountCents ?? 0;
      if (event.kind === "WITHDRAWAL") totals.withdrawalCents += event.amountCents ?? 0;
    }
  }
  totals.netCents = totals.initialDepositCents + totals.rechargeCents - totals.withdrawalCents;
  return totals;
}
const rate = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;

export async function GET(request: Request) {
  let actor;
  try { actor = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 }); throw error; }
  const role = actor.role as Role;
  if (!actor.active || !actor.groupId || !(["RECEPTION", "GROUP_OPERATOR", "EXPERT"] as string[]).includes(role) || !hasAssignedRole(actor, role))
    return authorizationDenied(actor, "当前账号没有一线个人业绩权限");
  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const settings = await getSystemSettings();
  const timezone = await resolveUserBusinessTimezone(actor, settings.timezone);
  const today = localDateYYYYMMDD(new Date(), timezone);
  const range = resolveDateRangeWithDefault(Object.fromEntries(params), today, "month");
  const leads = await db.leadCustomer.findMany({
    where: role === "RECEPTION" ? { ownerId: actor.id } : role === "GROUP_OPERATOR" ? { groupOperatorOwnerId: actor.id } : { expertOwnerId: actor.id },
    select: {
      isHistoricalRecord: true, invalid: true, receptionCategory: true, repliedOn: true, joinedOn: true, leftOn: true, groupStatus: true, expertIntroducedOn: true, expertContactedOn: true, registeredOn: true, expertStalledOn: true, noInitialDepositOn: true,
      batch: { select: { sourceDate: true, isHistoricalRecord: true } },
      customerOrder: { select: { openedOn: true, initialDepositCents: true, voidedAt: true, events: { where: { kind: { in: ["RECHARGE", "WITHDRAWAL"] } }, select: { kind: true, occurredOn: true, amountCents: true, continuationNumber: true, voidedAt: true } } } },
    },
  }) as Lead[];
  const totals = summarize(leads, range);
  const currentInGroup = leads.filter((lead) => !historical(lead) && lead.groupStatus === "JOINED").length;
  const operatorCohort = leads.filter((lead) => !historical(lead) && inRange(lead.joinedOn, range));
  const expertCohort = leads.filter((lead) => !historical(lead) && inRange(lead.expertIntroducedOn, range));
  return NextResponse.json({
    role, today, timezone, range, totals, currentInGroup,
    rates: {
      reply: rate(totals.replied, totals.effective), join: rate(totals.joined, totals.replied),
      introduced: rate(operatorCohort.filter((lead) => Boolean(lead.expertIntroducedOn && lead.expertIntroducedOn <= range.to)).length, operatorCohort.length),
      contacted: rate(expertCohort.filter((lead) => Boolean(lead.expertContactedOn && lead.expertContactedOn <= range.to)).length, expertCohort.length),
      registered: rate(expertCohort.filter((lead) => Boolean(lead.registeredOn && lead.registeredOn <= range.to)).length, expertCohort.filter((lead) => Boolean(lead.expertContactedOn && lead.expertContactedOn <= range.to)).length),
      ordered: rate(expertCohort.filter((lead) => Boolean(lead.customerOrder && !lead.customerOrder.voidedAt && lead.customerOrder.openedOn <= range.to)).length, expertCohort.filter((lead) => Boolean(lead.registeredOn && lead.registeredOn <= range.to)).length),
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
