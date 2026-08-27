export type EmployeeStage = "TRAINING" | "OBSERVATION" | "FORMAL" | "PAUSED";

export function resolveEmployeeStage(input: {
  onDate: string;
  hireDate: string | null;
  override: EmployeeStage | null;
  trainingDays: number;
  observationDays: number;
}): { stage: EmployeeStage; employmentDay: number | null; source: "AUTO" | "OVERRIDE" } {
  const employmentDay = input.hireDate === null
    ? null
    : Math.max(0, Math.floor((Date.parse(`${input.onDate}T00:00:00.000Z`) - Date.parse(`${input.hireDate}T00:00:00.000Z`)) / 86_400_000));

  if (input.override !== null) {
    return { stage: input.override, employmentDay, source: "OVERRIDE" };
  }

  if (employmentDay === null || employmentDay <= input.trainingDays) {
    return { stage: "TRAINING", employmentDay, source: "AUTO" };
  }
  if (employmentDay <= input.observationDays) {
    return { stage: "OBSERVATION", employmentDay, source: "AUTO" };
  }
  return { stage: "FORMAL", employmentDay, source: "AUTO" };
}
