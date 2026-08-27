import { describe, expect, it } from "vitest";
import { resolveEmployeeStage } from "../../src/lib/employee-stage";

describe("employee stage resolution", () => {
  it("uses training for employment days zero through seven", () => {
    expect(resolveEmployeeStage({
      onDate: "2026-08-08",
      hireDate: "2026-08-01",
      override: null,
      trainingDays: 7,
      observationDays: 30,
    })).toEqual({ stage: "TRAINING", employmentDay: 7, source: "AUTO" });
  });

  it("uses observation for employment days eight through thirty", () => {
    expect(resolveEmployeeStage({
      onDate: "2026-08-31",
      hireDate: "2026-08-01",
      override: null,
      trainingDays: 7,
      observationDays: 30,
    })).toEqual({ stage: "OBSERVATION", employmentDay: 30, source: "AUTO" });
  });

  it("uses formal status after the observation window", () => {
    expect(resolveEmployeeStage({
      onDate: "2026-09-01",
      hireDate: "2026-08-01",
      override: null,
      trainingDays: 7,
      observationDays: 30,
    })).toEqual({ stage: "FORMAL", employmentDay: 31, source: "AUTO" });
  });

  it("uses an explicit stage override before automatic calculation", () => {
    expect(resolveEmployeeStage({
      onDate: "2026-08-08",
      hireDate: "2026-08-01",
      override: "PAUSED",
      trainingDays: 7,
      observationDays: 30,
    })).toEqual({ stage: "PAUSED", employmentDay: 7, source: "OVERRIDE" });
  });

  it("clamps future hire dates to training day zero", () => {
    expect(resolveEmployeeStage({
      onDate: "2026-08-01",
      hireDate: "2026-08-10",
      override: null,
      trainingDays: 7,
      observationDays: 30,
    })).toEqual({ stage: "TRAINING", employmentDay: 0, source: "AUTO" });
  });
});
