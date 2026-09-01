import { db } from "../db";
import { addLocalDays } from "../dates";
import { assessGroupLeave } from "../group-leave";
import { loadChannelAnalysis } from "../analytics/channel-analysis";
import type { PerformanceLeaderboardRow } from "../analytics/performance-leaderboard-query";
import { loadRoleRankings } from "../analytics/role-rankings";
import { getSampleState } from "../analytics/metrics";
import type { AnalysisScope } from "../analytics/types";
import {
  conversionGradeLabels,
  conversionRatePercent,
  defaultConversionStandards,
  gradeConversion,
} from "../conversion-standards";
import { buildDailyBossBrief } from "./brief";
import {
  buildVerifiedProblems,
  selectChannelsForAi,
  selectEmployeeFunnelsForAi,
} from "./candidates";
import type {
  BossAiContext,
  BossChannelQuality,
  BossEmployeeFunnel,
  BossLeaveBreakdown,
  BossReportAnomalies,
  BossReportSnapshot,
  BossReportTotals,
  DailyBossBrief,
} from "./types";
import { revisionForNumberTracking, usesCustomerNumberTracking } from "../customer-number-tracking";

const ALL_HISTORY_FROM = "1970-01-01";
const EMPTY_ANOMALIES: BossReportAnomalies = {
  overdueExpertIntro: 0,
  overdueExpertContact: 0,
  overdueOrder: 0,
  invalidCustomers: 0,
};

type BriefGroup = { id: string; name: string; groupType: string; department: { name: string } };

/** 日报累计快照只读审核通过的每日统计；客户进度表不参与日报数字。 */
async function loadApprovedDailySnapshot(groups: BriefGroup[], to: string): Promise<PerformanceLeaderboardRow[]> {
  const entries = groups.length ? await db.dailyStatEntry.findMany({
    where: { groupId: { in: groups.map((group) => group.id) }, businessDate: { gte: ALL_HISTORY_FROM, lte: to }, approvedRevisionId: { not: null } },
    select: { groupId: true, businessDate: true, position: true, approvedRevision: true },
  }) : [];
  const rows = new Map<string, PerformanceLeaderboardRow>(groups.map((group) => [group.id, {
    groupId: group.id, groupName: group.name, departmentId: group.department.name, departmentName: group.department.name,
    orders: 0, rechargeCents: 0, withdrawalCents: 0, netPerformanceCents: 0,
    newFans: 0, effectiveFans: 0, replies: 0, groupJoin: 0, expertIntro: 0, expertContacted: 0,
    registration: 0, noNumber: 0, duplicateFans: 0, matureNewFans: 0, matureOrders: 0,
    matureOrderRate: null, confirmedPeople: 0, activePeople: 0, risk: "LOW",
  }]));
  for (const entry of entries) {
    const row = rows.get(entry.groupId);
    const rawValue = entry.approvedRevision;
    const group = groups.find((item) => item.id === entry.groupId);
    if (!row || !rawValue || !group) continue;
    const value = revisionForNumberTracking(rawValue, {
      businessDate: entry.businessDate,
      position: entry.position,
      groupType: group.groupType,
    });
    if (entry.position === "RECEPTION") {
      row.newFans = (row.newFans ?? 0) + value.dispatchCount; row.effectiveFans += value.effectiveCount;
      row.noNumber = (row.noNumber ?? 0) + value.noWsCount; row.duplicateFans = (row.duplicateFans ?? 0) + value.duplicateCount;
      row.replies = (row.replies ?? 0) + value.replyCount; row.groupJoin = (row.groupJoin ?? 0) + value.joinCount;
    } else if (entry.position === "GROUP_OPERATOR") {
      if (group.groupType === "HACKER" && usesCustomerNumberTracking(entry.businessDate)) row.groupJoin = (row.groupJoin ?? 0) + value.operatorReceivedCount;
      row.expertIntro = (row.expertIntro ?? 0) + value.expertIntroCount;
    } else {
      row.expertContacted = (row.expertContacted ?? 0) + value.expertContactedCount; row.registration = (row.registration ?? 0) + value.registrationCount; row.orders += value.orderCount;
      row.rechargeCents += value.cryptoInitialDepositCents + value.bankInitialDepositCents + value.cryptoRechargeCents + value.bankRechargeCents;
      row.withdrawalCents += value.withdrawalCents;
    }
    row.netPerformanceCents = row.rechargeCents - row.withdrawalCents;
    row.matureNewFans = row.newFans ?? 0; row.matureOrders = row.orders;
    row.matureOrderRate = row.matureNewFans ? row.matureOrders / row.matureNewFans : null;
  }
  return [...rows.values()];
}

function averageTotals(totals: BossReportTotals, days: number): BossReportTotals {
  const divide = (value: number) => Number((value / days).toFixed(2));
  return {
    newFans: divide(totals.newFans),
    effectiveFans: divide(totals.effectiveFans),
    replies: divide(totals.replies),
    groupJoin: divide(totals.groupJoin),
    expertIntro: divide(totals.expertIntro),
    expertContacted: divide(totals.expertContacted),
    registration: divide(totals.registration),
    orders: divide(totals.orders),
    rechargeCents: divide(totals.rechargeCents),
    withdrawalCents: divide(totals.withdrawalCents),
    netPerformanceCents: divide(totals.netPerformanceCents),
  };
}

function snapshot(brief: DailyBossBrief, averageDays = 1): BossReportSnapshot {
  return {
    totals: averageDays === 1 ? brief.totals : averageTotals(brief.totals, averageDays),
    rates: brief.rates,
  };
}

function leaveBreakdown(): BossLeaveBreakdown {
  return { total: 0, withOrder: 0, withoutOrder: 0 };
}

async function loadAnomalies(groupIds: string[], reportDate: string): Promise<BossReportAnomalies> {
  if (!groupIds.length) {
    return {
      overdueExpertIntro: 0,
      overdueExpertContact: 0,
      overdueOrder: 0,
      invalidCustomers: 0,
    };
  }
  // 入群当天是第1天，因此报告日往前2天入群的客户已到第3天。
  const introCutoff = addLocalDays(reportDate, -2) ?? reportDate;
  const contactCutoff = addLocalDays(reportDate, -1) ?? reportDate;
  const orderCutoff = addLocalDays(reportDate, -2) ?? reportDate;
  const scope = { batch: { groupId: { in: groupIds } } } as const;
  const [overdueExpertIntro, overdueExpertContact, overdueOrder, invalidCustomers] = await Promise.all([
    db.leadCustomer.count({
      where: { ...scope, invalid: false, joinedOn: { lte: introCutoff }, expertIntroducedOn: null },
    }),
    db.leadCustomer.count({
      where: { ...scope, invalid: false, expertIntroducedOn: { lte: contactCutoff }, expertContactedOn: null },
    }),
    db.leadCustomer.count({
      where: {
        ...scope,
        invalid: false,
        expertContactedOn: { lte: orderCutoff },
        OR: [{ customerOrder: null }, { customerOrder: { voidedAt: { not: null } } }],
      },
    }),
    db.leadCustomer.count({
      where: { ...scope, invalid: true, batch: { groupId: { in: groupIds }, sourceDate: reportDate } },
    }),
  ]);
  return { overdueExpertIntro, overdueExpertContact, overdueOrder, invalidCustomers };
}

export async function loadDailyBossBrief(reportDate: string, options: { groupIds?: string[] } = {}): Promise<DailyBossBrief> {
  const previousDate = addLocalDays(reportDate, -1);
  const twoDaysAgo = addLocalDays(reportDate, -2);
  const sevenDaysAgo = addLocalDays(reportDate, -7);
  const analysisFrom = addLocalDays(reportDate, -29);
  if (!previousDate || !twoDaysAgo || !sevenDaysAgo || !analysisFrom) throw new Error("日报日期格式不正确");
  const groups = await db.teamGroup.findMany({
    where: { active: true, department: { active: true }, ...(options.groupIds ? { id: { in: options.groupIds } } : {}) },
    select: {
      id: true,
      name: true,
      groupType: true,
      department: { select: { name: true } },
      receptionJoinPassRate: true,
      receptionJoinGoodRate: true,
      receptionJoinExcellentRate: true,
      operatorExpertPassRate: true,
      operatorExpertGoodRate: true,
      operatorExpertExcellentRate: true,
      expertOrderPassRate: true,
      expertOrderGoodRate: true,
      expertOrderExcellentRate: true,
    },
  });
  const groupIds = groups.map((group) => group.id);
  const groupLabels = new Map(groups.map((group) => [group.id, `${group.department.name} / ${group.name}`]));
  const aiScope: AnalysisScope = {
    actorId: "boss-daily-brief",
    role: "ADMIN",
    groupIds,
    requestedForbiddenGroup: false,
    showInsufficient: true,
    sourceDateFrom: analysisFrom,
    sourceDateTo: reportDate,
    includeInactive: false,
  };
  const [currentRows, previousRows, twoDaysAgoRows, sevenDaysAgoRows, anomalies, roleRankings, channelAnalysis, leaves, activeFrontline, confirmedFrontline] = await Promise.all([
    loadApprovedDailySnapshot(groups, reportDate),
    loadApprovedDailySnapshot(groups, previousDate),
    loadApprovedDailySnapshot(groups, twoDaysAgo),
    loadApprovedDailySnapshot(groups, sevenDaysAgo),
    loadAnomalies(groupIds, reportDate),
    loadRoleRankings({ groupIds, sourceDateFrom: analysisFrom, sourceDateTo: reportDate, today: reportDate }),
    loadChannelAnalysis(aiScope, reportDate),
    db.leadCustomer.findMany({
      where: { invalid: false, leftOn: reportDate, batch: { groupId: { in: groupIds } } },
      select: {
        joinedOn: true,
        leftOn: true,
        leftWithOrder: true,
        customerOrder: { select: { voidedAt: true } },
      },
    }),
    db.user.count({
      where: {
        active: true,
        role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] },
        groupId: { in: groupIds },
      },
    }),
    db.dailyEntryConfirmation.count({
      where: {
        businessDate: reportDate,
        user: {
          active: true,
          role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] },
          groupId: { in: groupIds },
        },
      },
    }),
  ]);
  const brief = buildDailyBossBrief({ reportDate, currentRows, previousRows, anomalies });
  const yesterdayBrief = buildDailyBossBrief({ reportDate: previousDate, currentRows: previousRows, previousRows: twoDaysAgoRows, anomalies: EMPTY_ANOMALIES });
  const trailingSevenDayBrief = buildDailyBossBrief({ reportDate, currentRows, previousRows: sevenDaysAgoRows, anomalies: EMPTY_ANOMALIES });

  const employeeFunnelsAll: BossEmployeeFunnel[] = [
    ...roleRankings.reception.filter((row) => row.active && row.valid > 0).map((row) => {
      const standard = roleRankings.standardsByGroup[row.groupId]?.receptionJoin ?? defaultConversionStandards.receptionJoin;
      const grade = gradeConversion(row.joined, row.valid, standard);
      return {
      employeeId: row.id,
      role: "接粉" as const,
      name: row.name,
      groupName: groupLabels.get(row.groupId) ?? row.groupName,
      sample: row.valid,
      sampleState: getSampleState(row.valid),
      stages: { validFans: row.valid, replied: row.replied, joined: row.joined, pushedExpert: row.expertIntroduced, contactedExpert: row.expertContacted ?? 0, registered: row.registered, orders: row.orders },
      evaluation: {
        metric: "有效数据入群率" as const,
        completed: row.joined,
        eligible: row.valid,
        ratePercent: conversionRatePercent(row.joined, row.valid),
        grade,
        gradeLabel: conversionGradeLabels[grade],
        standard,
      },
    }}),
    ...roleRankings.groupOperators.filter((row) => row.active && row.eligibleForIntroduction > 0).map((row) => {
      const standard = roleRankings.standardsByGroup[row.groupId]?.operatorExpert ?? defaultConversionStandards.operatorExpert;
      const grade = gradeConversion(row.introducedEligible, row.eligibleForIntroduction, standard);
      return {
      employeeId: row.id,
      role: "炒群" as const,
      name: row.name,
      groupName: groupLabels.get(row.groupId) ?? row.groupName,
      sample: row.eligibleForIntroduction,
      sampleState: getSampleState(row.eligibleForIntroduction),
      stages: { sharedCustomers: row.sharedCustomerCount, currentInGroup: row.currentInGroup, day3Eligible: row.eligibleForIntroduction, pushedExpert: row.introducedEligible, contactedExpert: row.downstreamContacted ?? 0, registered: row.downstreamRegistered, orders: row.downstreamOrders },
      evaluation: {
        metric: "第3天推专家率" as const,
        completed: row.introducedEligible,
        eligible: row.eligibleForIntroduction,
        ratePercent: conversionRatePercent(row.introducedEligible, row.eligibleForIntroduction),
        grade,
        gradeLabel: conversionGradeLabels[grade],
        standard,
      },
    }}),
    ...roleRankings.experts.filter((row) => row.active && row.assigned > 0).map((row) => {
      const standard = roleRankings.standardsByGroup[row.groupId]?.expertOrder ?? defaultConversionStandards.expertOrder;
      const grade = gradeConversion(row.orderedEligible, row.eligibleForOrder, standard);
      return {
      employeeId: row.id,
      role: "专家" as const,
      name: row.name,
      groupName: groupLabels.get(row.groupId) ?? row.groupName,
      sample: row.eligibleForOrder,
      sampleState: getSampleState(row.eligibleForOrder),
      stages: { assigned: row.assigned, contacted: row.contacted ?? 0, registered: row.registered, day2Eligible: row.eligibleForOrder, orderedEligible: row.orderedEligible, orders: row.orders },
      evaluation: {
        metric: "第2天开单率" as const,
        completed: row.orderedEligible,
        eligible: row.eligibleForOrder,
        ratePercent: conversionRatePercent(row.orderedEligible, row.eligibleForOrder),
        grade,
        gradeLabel: conversionGradeLabels[grade],
        standard,
      },
    }}),
  ];
  const employeeFunnels = selectEmployeeFunnelsForAi(employeeFunnelsAll);

  const leaveGroups = {
    day1To8Abnormal: leaveBreakdown(),
    day9To13Watch: leaveBreakdown(),
    day14PlusNormal: leaveBreakdown(),
    dateMissing: leaveBreakdown(),
  };
  for (const lead of leaves) {
    const assessment = assessGroupLeave(lead.joinedOn, lead.leftOn);
    const target = assessment.level === "EARLY" ? leaveGroups.day1To8Abnormal
      : assessment.level === "WATCH" ? leaveGroups.day9To13Watch
      : assessment.level === "NORMAL" ? leaveGroups.day14PlusNormal
      : leaveGroups.dateMissing;
    const withOrder = lead.leftWithOrder ?? Boolean(lead.customerOrder && !lead.customerOrder.voidedAt);
    target.total += 1;
    if (withOrder) target.withOrder += 1;
    else target.withoutOrder += 1;
  }

  const channelQualityAll: BossChannelQuality[] = channelAnalysis.rows.map((row) => {
    const submitted = row.submitted ?? row.newFans;
    return {
      name: row.displayName,
      sampleState: getSampleState(submitted),
      groupNames: row.groups,
      submitted,
      effective: row.effective ?? row.totals.effectiveFans,
      replies: row.totals.replies,
      joined: row.totals.groupJoin,
      pushedExpert: row.totals.expertIntro,
      orders: row.totals.orders,
      effectiveRate: row.effectiveRate ?? null,
      effectiveFanReplyRate: row.customerReplyRate ?? null,
      d7SubmittedOrderRate: row.d7OrderRate ?? null,
      invalidRate: row.invalidRate ?? null,
    };
  });
  const aiContext: BossAiContext = {
    headlinePeriod: { type: "DAILY", date: reportDate },
    analysisWindow: { from: analysisFrom, to: reportDate },
    dataCompleteness: {
      activeFrontline,
      confirmedFrontline,
      confirmationRate: activeFrontline ? confirmedFrontline / activeFrontline : null,
    },
    comparison: {
      yesterday: snapshot(yesterdayBrief),
      trailing7DayAverage: snapshot(trailingSevenDayBrief, 7),
    },
    employeeFunnels,
    channelQuality: selectChannelsForAi(channelQualityAll),
    verifiedProblems: [],
    leavesToday: leaveGroups,
  };
  const withContext = { ...brief, aiContext };
  aiContext.verifiedProblems = buildVerifiedProblems(withContext);
  const hasOperationalSignal = brief.hasData
    || Object.values(anomalies).some((value) => value > 0)
    || leaveGroups.day1To8Abnormal.total > 0
    || activeFrontline > confirmedFrontline;
  return { ...brief, hasData: hasOperationalSignal, aiContext };
}
