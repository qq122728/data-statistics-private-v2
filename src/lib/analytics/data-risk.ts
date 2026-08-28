import type { BatchTotals } from "../metrics";

export type DataRiskCode =
  | "UNCONFIRMED"
  | "LONG_NO_RECORD"
  | "DOWNSTREAM_EXCEEDS_UPSTREAM"
  | "LEAVE_EXCEEDS_JOIN"
  | "FREQUENT_HISTORY_EDITS";

export type FinancialRiskCode = "WITHDRAWAL_ANOMALY";

export type RiskEvidence<Category extends "DATA" | "FINANCIAL", Code extends string> = {
  category: Category;
  code: Code;
  evidence: Record<string, unknown>;
};

export type DataRiskEvidence = RiskEvidence<"DATA", DataRiskCode>;
export type FinancialRiskEvidence = RiskEvidence<"FINANCIAL", FinancialRiskCode>;

function hasDownstreamAnomaly(totals: BatchTotals): boolean {
  return totals.effectiveFans + totals.noNumber + totals.duplicateFans > totals.newFans
    || totals.replies > totals.newFans
    || totals.groupJoin > totals.newFans
    || totals.expertIntro > totals.groupJoin
    || totals.registration > totals.expertIntro
    || totals.orders > totals.newFans;
}

export function evaluateDataRisks(input: {
  evaluationDate: string;
  confirmed: boolean;
  daysSinceLastRecord: number | null;
  longNoRecordDays: number;
  totals: BatchTotals;
  historyModificationCount: number;
  frequentModificationCount: number;
}): DataRiskEvidence[] {
  const risks: DataRiskEvidence[] = [];
  if (!input.confirmed) {
    risks.push({ category: "DATA", code: "UNCONFIRMED", evidence: { evaluationDate: input.evaluationDate } });
  }
  if (input.daysSinceLastRecord === null || input.daysSinceLastRecord >= input.longNoRecordDays) {
    risks.push({
      category: "DATA",
      code: "LONG_NO_RECORD",
      evidence: { daysSinceLastRecord: input.daysSinceLastRecord, thresholdDays: input.longNoRecordDays },
    });
  }
  if (hasDownstreamAnomaly(input.totals)) {
    risks.push({
      category: "DATA",
      code: "DOWNSTREAM_EXCEEDS_UPSTREAM",
      evidence: {
        newFans: input.totals.newFans,
        replies: input.totals.replies,
        groupJoin: input.totals.groupJoin,
        expertIntro: input.totals.expertIntro,
        registration: input.totals.registration,
        orders: input.totals.orders,
      },
    });
  }
  if (input.totals.groupLeave > input.totals.groupJoin) {
    risks.push({
      category: "DATA",
      code: "LEAVE_EXCEEDS_JOIN",
      evidence: { groupJoin: input.totals.groupJoin, groupLeave: input.totals.groupLeave },
    });
  }
  if (input.historyModificationCount >= input.frequentModificationCount) {
    risks.push({
      category: "DATA",
      code: "FREQUENT_HISTORY_EDITS",
      evidence: { count: input.historyModificationCount, threshold: input.frequentModificationCount },
    });
  }
  return risks;
}

export type FinancialRiskPeriod = {
  dataValid: boolean;
  rechargeCents: number;
  channelPerformanceCents: number;
  withdrawalCents: number;
};

export function evaluateFinancialRisks(input: {
  current: FinancialRiskPeriod;
  previous: FinancialRiskPeriod | null;
}): FinancialRiskEvidence[] {
  if (!input.current.dataValid) return [];

  const risks: FinancialRiskEvidence[] = [];
  const grossPerformanceCents = input.current.rechargeCents;
  if (grossPerformanceCents > 0 && input.current.withdrawalCents > grossPerformanceCents) {
    risks.push({
      category: "FINANCIAL",
      code: "WITHDRAWAL_ANOMALY",
      evidence: { grossPerformanceCents, withdrawalCents: input.current.withdrawalCents },
    });
  }
  return risks;
}
