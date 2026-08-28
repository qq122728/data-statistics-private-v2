import type { EmployeeStage } from "../employee-stage";
import type { RiskSettings } from "../risk-settings";
import { addCalendarDays } from "./maturity-window";

export type DailyEvaluation = {
  evaluationDate: string;
  eligible: boolean;
  efficiency: number | null;
  state: "LOW" | "OK" | "OBSERVING";
  reason: "READY" | "IMMATURE" | "INSUFFICIENT_SAMPLE" | "DATA_INVALID";
};

export type PerformanceRiskLevel = "NONE" | "COACHING" | "LIMIT_WATCH" | "ELIMINATION_WATCH";

type PerformanceRules = Pick<
  RiskSettings,
  | "coachingEfficiency"
  | "coachingDays"
  | "limitEfficiency"
  | "limitDays"
  | "eliminationEfficiency"
  | "eliminationDays"
>;

export type PerformanceRiskResult = {
  category: "PERFORMANCE";
  level: PerformanceRiskLevel;
  lowDays: {
    coaching: number;
    limit: number;
    elimination: number;
  };
};

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function currentUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function generateEvaluationDates(from: string, through: string): string[] {
  if (!isCalendarDate(from) || !isCalendarDate(through)) {
    throw new RangeError("Evaluation range must contain valid calendar dates");
  }
  if (from > through) throw new RangeError("Evaluation date range is reversed");

  const dates: string[] = [];
  for (let date = from; date <= through; date = addCalendarDays(date, 1)) dates.push(date);
  return dates;
}

export function countConsecutiveLowDays(
  evaluations: readonly DailyEvaluation[],
  threshold: number,
  today = currentUtcDate(),
): number {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("Efficiency threshold must be between 0 and 1");
  }
  if (!isCalendarDate(today)) throw new RangeError("Today must be a valid calendar date");

  let previousDate: string | null = null;
  let lowDays = 0;
  for (const evaluation of evaluations) {
    if (!isCalendarDate(evaluation.evaluationDate)) {
      throw new RangeError("Evaluation date must be a valid calendar date");
    }
    if (evaluation.evaluationDate > today) throw new RangeError("Evaluation date cannot be in the future");
    if (previousDate !== null && evaluation.evaluationDate <= previousDate) {
      throw new RangeError("Evaluation dates must be strictly increasing");
    }
    previousDate = evaluation.evaluationDate;

    if (!evaluation.eligible) continue;
    if (evaluation.efficiency === null || !Number.isFinite(evaluation.efficiency)) {
      throw new RangeError("Eligible evaluations require a finite efficiency");
    }
    if (evaluation.efficiency < threshold) lowDays += 1;
    else lowDays = 0;
  }
  return lowDays;
}

export function evaluatePerformanceRisk(input: {
  evaluations: readonly DailyEvaluation[];
  stage: EmployeeStage;
  rules: PerformanceRules;
  today?: string;
}): PerformanceRiskResult {
  const lowDays = {
    coaching: countConsecutiveLowDays(input.evaluations, input.rules.coachingEfficiency, input.today),
    limit: countConsecutiveLowDays(input.evaluations, input.rules.limitEfficiency, input.today),
    elimination: countConsecutiveLowDays(input.evaluations, input.rules.eliminationEfficiency, input.today),
  };

  let level: PerformanceRiskLevel = "NONE";
  if (input.stage === "FORMAL") {
    if (lowDays.elimination >= input.rules.eliminationDays) level = "ELIMINATION_WATCH";
    else if (lowDays.limit >= input.rules.limitDays) level = "LIMIT_WATCH";
    else if (lowDays.coaching >= input.rules.coachingDays) level = "COACHING";
  } else if (input.stage === "OBSERVATION" && lowDays.coaching >= input.rules.coachingDays) {
    level = "COACHING";
  }

  return { category: "PERFORMANCE", level, lowDays };
}
