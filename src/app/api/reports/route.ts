import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { calculateBatchTotals, calculateConversionRates } from "../../../lib/metrics";
import type { BatchTotals, ConversionRates } from "../../../lib/metrics";
import type { PermissionUser } from "../../../lib/permissions";
import { resolveReadableReportGroups, resolveSelectedReportGroupIds } from "../../../lib/report-scope";
import { getSystemSettings, resolveReportView } from "../../../lib/settings";
import { normalizeChannelName } from "../../../lib/channel-names";
import { resolveChannelFilterSelection } from "../../../lib/report-filters";
import { loadCanonicalMetricEvents } from "../../../lib/analytics/canonical-events";
import { calculateCanonicalFinancials, type CanonicalFinancials } from "../../../lib/analytics/canonical-financials";
import { hasOversizedQueryValue } from "../../../lib/request-limits";
import { authorizationDenied } from "../../../lib/security-events";

export type ReportQuery = {
  user: PermissionUser;
  groupId?: string;
  memberId?: string;
  channelId?: string;
  channelName?: string;
  normalizedName?: string;
  sourceDateFrom?: string;
  sourceDateTo?: string;
  occurredDateFrom?: string;
  occurredDateTo?: string;
  timeZone?: string;
};

export type ReportRow = {
  id: string;
  label: string;
  sourceDate: string;
  group: { id: string; name: string };
  channel: { id: string; name: string };
  totals: BatchTotals;
  financials: CanonicalFinancials & { netPerformanceCents: number };
  rates: ConversionRates | null;
};

export type ReportData = {
  mode: "cumulative" | "incremental";
  rows: ReportRow[];
  filterWarning?: "AMBIGUOUS_LEGACY_CHANNEL_ID";
};

function dateRange(from?: string, to?: string): Prisma.StringFilter | undefined {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

async function buildReport(query: ReportQuery): Promise<ReportData> {
  const allGroups = await db.teamGroup.findMany({ select: { id: true, departmentId: true, countryCode: true, department: { select: { countryCode: true } } } });
  const readableGroups = resolveReadableReportGroups(query.user, allGroups);
  const readableGroupIds = resolveSelectedReportGroupIds(readableGroups, query.groupId);

  const sourceDate = dateRange(query.sourceDateFrom, query.sourceDateTo);
  const today = localDateYYYYMMDD(new Date(), query.timeZone);
  const cappedOccurredDateTo = !query.occurredDateTo || query.occurredDateTo > today ? today : query.occurredDateTo;
  const incremental = Boolean(query.occurredDateFrom || query.occurredDateTo);
  const occurredOn = dateRange(query.occurredDateFrom, cappedOccurredDateTo);
  const enteredById = query.user.role === "RECEPTION" ? query.user.id : query.memberId;
  let normalizedName = query.normalizedName || query.channelName
    ? normalizeChannelName(query.normalizedName ?? query.channelName ?? "")
    : undefined;
  if (!normalizedName && query.channelId) {
    const legacyChannels = await db.channel.findMany({
      where: { groupId: { in: readableGroupIds }, id: query.channelId },
      select: { id: true, name: true, normalizedName: true, active: true, groupId: true },
    });
    const selection = resolveChannelFilterSelection(legacyChannels, {
      groupId: query.groupId,
      channelId: query.channelId,
    });
    if (selection.unresolvedLegacyChannelId) {
      return {
        mode: incremental ? "incremental" : "cumulative",
        rows: [],
        filterWarning: "AMBIGUOUS_LEGACY_CHANNEL_ID",
      };
    }
    normalizedName = selection.normalizedName;
  }
  const canonicalEvents = await loadCanonicalMetricEvents({
    groupIds: readableGroupIds,
    sourceDateFrom: query.sourceDateFrom,
    sourceDateTo: query.sourceDateTo,
    normalizedName,
    memberId: enteredById,
    occurredOnFrom: query.occurredDateFrom,
    occurredOnTo: cappedOccurredDateTo,
  });
  const eventsByBatch = new Map<string, typeof canonicalEvents>();
  for (const event of canonicalEvents) eventsByBatch.set(event.batchId, [...(eventsByBatch.get(event.batchId) ?? []), event]);
  const rows = await db.sourceBatch.findMany({
    where: {
      groupId: { in: readableGroupIds },
      ...(normalizedName ? { channel: { normalizedName } } : {}),
      ...(sourceDate ? { sourceDate } : {}),
    },
    include: {
      group: { select: { id: true, name: true } },
      channel: { select: { id: true, groupId: true, name: true, normalizedName: true } },
      events: {
        where: {
          ...(enteredById ? { enteredById } : {}),
          ...(occurredOn ? { occurredOn } : {}),
          voidedAt: null,
          derivedFromLedger: false,
        },
        select: {
          id: true,
          kind: true,
          quantity: true,
          amountCents: true,
          occurredOn: true,
          enteredById: true,
          enteredBy: { select: { id: true, name: true, active: true, hireDate: true, stageOverride: true } },
        },
      },
    },
    orderBy: [{ sourceDate: "desc" }, { channelId: "asc" }],
  });

  return {
    mode: incremental ? "incremental" as const : "cumulative" as const,
    rows: rows.flatMap((batch) => {
      const canonical = eventsByBatch.get(batch.id) ?? [];
      const ids = new Set(canonical.map((event) => event.id));
      const legacy = batch.events.flatMap((event) => ids.has(`legacy:${event.id}`) ? [] : [{
        ...event,
        id: `legacy:${event.id}`,
        batchId: batch.id,
        voidedAt: null,
        batch: {
          sourceDate: batch.sourceDate,
          group: batch.group,
          channel: {
            ...batch.channel,
            fanCostMode: batch.fanCostModeSnapshot,
            effectiveFanPriceCents: batch.effectiveFanPriceCentsSnapshot,
            channelType: batch.channelTypeSnapshot,
            rebateRateBps: batch.rebateRateBpsSnapshot,
          },
        },
        enteredBy: { ...event.enteredBy, role: "RECEPTION" as const },
      }]);
      const events = [...canonical, ...legacy];
      if (query.user.role === "RECEPTION" && events.length === 0) return [];
      const totals = calculateBatchTotals(events);
      const financials = calculateCanonicalFinancials(events);
      return {
        id: batch.id,
        label: `${batch.sourceDate} · ${batch.channel.name}`,
        sourceDate: batch.sourceDate,
        group: batch.group,
        channel: batch.channel,
        totals,
        financials: {
          ...financials,
          netPerformanceCents: totals.rechargeCents - totals.withdrawalCents,
        },
        rates: incremental ? null : calculateConversionRates(totals),
      };
    }),
  };
}

async function getReport(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!["ADMIN", "LEAD", "RECEPTION"].includes(user.role))
    return authorizationDenied(user, "当前岗位无权查看该报表");

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const value = (name: string) => params.get(name) || undefined;
  const settings = await getSystemSettings();
  const values = resolveReportView({
    mode: value("mode"),
    groupId: value("groupId"),
    memberId: value("memberId"),
    channelId: value("channelId"),
    channelName: value("channelName"),
    normalizedName: value("normalizedName"),
    sourceDateFrom: value("sourceDateFrom"),
    sourceDateTo: value("sourceDateTo"),
    occurredDateFrom: value("occurredDateFrom"),
    occurredDateTo: value("occurredDateTo"),
  }, settings);
  const report = await buildReport({
    user,
    ...values,
    timeZone: settings.timezone,
  });
  return NextResponse.json(report);
}

export const GET = Object.assign(getReport, { buildReport });
