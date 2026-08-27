import { describe, expect, it, vi } from "vitest";
import {
  countConsecutiveLowDays,
  evaluatePerformanceRisk,
  generateEvaluationDates,
  type DailyEvaluation,
} from "../../src/lib/analytics/risk-evaluation";

const daily = (
  evaluationDate: string,
  efficiency: number | null,
  state: DailyEvaluation["state"],
  reason: DailyEvaluation["reason"] = state === "OBSERVING" ? "INSUFFICIENT_SAMPLE" : "READY",
): DailyEvaluation => ({
  evaluationDate,
  eligible: state !== "OBSERVING",
  efficiency,
  state,
  reason,
});

describe("daily member risk evaluation", () => {
  it("counts eligible low days while observing days pause without clearing the count", () => {
    const evaluations = [
      daily("2026-08-09", 0.72, "LOW"),
      daily("2026-08-10", 0.75, "LOW"),
      daily("2026-08-11", null, "OBSERVING"),
      daily("2026-08-12", 0.79, "LOW"),
    ];

    expect(countConsecutiveLowDays(evaluations, 0.8, "2026-08-14")).toBe(3);
  });

  it("clears accumulated low days only on an eligible non-low day", () => {
    const evaluations = [
      daily("2026-08-09", 0.72, "LOW"),
      daily("2026-08-10", null, "OBSERVING", "PENDING_PRICE"),
      daily("2026-08-11", 0.81, "OK"),
      daily("2026-08-12", null, "OBSERVING", "DATA_INVALID"),
      daily("2026-08-13", 0.69, "LOW"),
    ];

    expect(countConsecutiveLowDays(evaluations, 0.8, "2026-08-14")).toBe(1);
  });

  it("rejects duplicate, descending, invalid, and future evaluation dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    try {
      expect(() => countConsecutiveLowDays([
        daily("2026-08-10", 0.7, "LOW"),
        daily("2026-08-10", 0.6, "LOW"),
      ], 0.8)).toThrow(/strictly increasing/i);
      expect(() => countConsecutiveLowDays([
        daily("2026-08-11", 0.7, "LOW"),
        daily("2026-08-10", 0.6, "LOW"),
      ], 0.8)).toThrow(/strictly increasing/i);
      expect(() => countConsecutiveLowDays([daily("2026-02-30", 0.7, "LOW")], 0.8)).toThrow(/valid calendar date/i);
      expect(() => countConsecutiveLowDays([daily("2026-08-15", 0.7, "LOW")], 0.8)).toThrow(/future/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("generates an inclusive pure calendar-date sequence without accepting a reversed range", () => {
    expect(generateEvaluationDates("2026-08-12", "2026-08-14")).toEqual([
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
    ]);
    expect(() => generateEvaluationDates("2026-08-15", "2026-08-14")).toThrow(/range/i);
  });

  it("selects the highest satisfied level and caps it by employee stage", () => {
    const evaluations = [
      daily("2026-08-10", 0.5, "LOW"),
      daily("2026-08-11", null, "OBSERVING"),
      daily("2026-08-12", 0.5, "LOW"),
      daily("2026-08-13", 0.5, "LOW"),
    ];
    const rules = {
      coachingEfficiency: 0.8,
      coachingDays: 2,
      limitEfficiency: 0.7,
      limitDays: 3,
      eliminationEfficiency: 0.6,
      eliminationDays: 3,
    };

    expect(evaluatePerformanceRisk({ evaluations, stage: "TRAINING", rules, today: "2026-08-14" }).level).toBe("NONE");
    expect(evaluatePerformanceRisk({ evaluations, stage: "PAUSED", rules, today: "2026-08-14" }).level).toBe("NONE");
    expect(evaluatePerformanceRisk({ evaluations, stage: "OBSERVATION", rules, today: "2026-08-14" })).toMatchObject({
      level: "COACHING",
      lowDays: { coaching: 3, limit: 3, elimination: 3 },
    });
    expect(evaluatePerformanceRisk({ evaluations, stage: "FORMAL", rules, today: "2026-08-14" })).toMatchObject({
      level: "ELIMINATION_WATCH",
      lowDays: { coaching: 3, limit: 3, elimination: 3 },
    });
  });
});
