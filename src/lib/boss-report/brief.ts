import type { PerformanceLeaderboardRow } from "../analytics/performance-leaderboard-query";
import { buildHeadquartersPerformance } from "../analytics/headquarters-performance";
import type {
  BossReportAnomalies,
  BossReportRates,
  BossReportTotals,
  DailyBossBrief,
} from "./types";

const numericFields = [
  "orders",
  "rechargeCents",
  "withdrawalCents",
  "netPerformanceCents",
  "newFans",
  "effectiveFans",
  "replies",
  "groupJoin",
  "expertIntro",
  "expertContacted",
  "registration",
  "noNumber",
  "duplicateFans",
  "matureNewFans",
  "matureOrders",
] as const;

function subtractRows(
  current: PerformanceLeaderboardRow[],
  previous: PerformanceLeaderboardRow[],
): PerformanceLeaderboardRow[] {
  const previousByGroup = new Map(previous.map((row) => [row.groupId, row]));
  return current.map((row) => {
    const before = previousByGroup.get(row.groupId);
    const result = { ...row };
    for (const field of numericFields) {
      result[field] = Number(row[field] ?? 0) - Number(before?.[field] ?? 0);
    }
    result.matureOrderRate = result.matureNewFans ? result.matureOrders / result.matureNewFans : null;
    return result;
  });
}

const sum = (rows: PerformanceLeaderboardRow[], field: keyof PerformanceLeaderboardRow) =>
  rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function buildDailyBossBrief(input: {
  reportDate: string;
  generatedAt?: Date;
  currentRows: PerformanceLeaderboardRow[];
  previousRows: PerformanceLeaderboardRow[];
  anomalies: BossReportAnomalies;
}): DailyBossBrief {
  const rows = subtractRows(input.currentRows, input.previousRows);
  const totals: BossReportTotals = {
    newFans: sum(rows, "newFans"),
    effectiveFans: sum(rows, "effectiveFans"),
    replies: sum(rows, "replies"),
    groupJoin: sum(rows, "groupJoin"),
    expertIntro: sum(rows, "expertIntro"),
    expertContacted: sum(rows, "expertContacted"),
    registration: sum(rows, "registration"),
    orders: sum(rows, "orders"),
    rechargeCents: sum(rows, "rechargeCents"),
    withdrawalCents: sum(rows, "withdrawalCents"),
    netPerformanceCents: sum(rows, "netPerformanceCents"),
  };
  const rates: BossReportRates = {
    replyRate: ratio(totals.replies, totals.effectiveFans),
    joinRate: ratio(totals.groupJoin, totals.replies),
    expertIntroRate: ratio(totals.expertIntro, totals.groupJoin),
    expertContactRate: ratio(totals.expertContacted, totals.expertIntro),
    expertOrderRate: ratio(totals.orders, totals.expertIntro),
  };
  const rankings = buildHeadquartersPerformance(rows);
  const groupRows = rows.map((row) => ({
    groupId: row.groupId,
    name: row.groupName,
    departmentName: row.departmentName,
    newFans: row.newFans ?? 0,
    effectiveFans: row.effectiveFans,
    replies: row.replies ?? 0,
    groupJoin: row.groupJoin ?? 0,
    expertIntro: row.expertIntro ?? 0,
    expertContacted: row.expertContacted ?? 0,
    registration: row.registration ?? 0,
    orders: row.orders,
    rechargeCents: row.rechargeCents ?? 0,
    withdrawalCents: row.withdrawalCents ?? 0,
    netPerformanceCents: row.netPerformanceCents ?? 0,
  }));
  const topCompanies = rankings.companies.slice(0, 3).map((row) => ({
    name: row.departmentName,
    orders: row.orders,
    netPerformanceCents: row.netPerformanceCents,
  }));
  const topGroups = rankings.groups.slice(0, 3).map((row) => ({
    name: row.groupName,
    departmentName: row.departmentName,
    orders: row.orders,
    netPerformanceCents: row.netPerformanceCents,
  }));
  const hasData = Object.values(totals).some((value) => typeof value === "number" && value !== 0);

  return {
    reportDate: input.reportDate,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    hasData,
    totals,
    rates,
    topCompanies,
    topGroups,
    groupRows,
    anomalies: input.anomalies,
  };
}
