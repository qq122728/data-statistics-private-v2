export type ConversionGrade = "NO_SAMPLE" | "BELOW_PASS" | "PASS" | "GOOD" | "EXCELLENT";

export type RateBand = { pass: number; good: number; excellent: number };

export type GroupConversionStandards = {
  receptionJoin: RateBand;
  operatorExpert: RateBand;
  expertOrder: RateBand;
};

export const defaultConversionStandards: GroupConversionStandards = {
  receptionJoin: { pass: 10, good: 15, excellent: 20 },
  operatorExpert: { pass: 60, good: 70, excellent: 80 },
  expertOrder: { pass: 10, good: 15, excellent: 20 },
};

export const conversionGradeLabels: Record<ConversionGrade, string> = {
  NO_SAMPLE: "暂无评级",
  BELOW_PASS: "不及格",
  PASS: "及格",
  GOOD: "良好",
  EXCELLENT: "优秀",
};

export function conversionRatePercent(completed: number, eligible: number): number | null {
  if (!Number.isSafeInteger(completed) || !Number.isSafeInteger(eligible) || completed < 0 || eligible <= 0) return null;
  return Math.min(100, (completed / eligible) * 100);
}

function dateNumber(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function hasReachedBusinessDay(eventDate: string | null, today: string, elapsedDays: number): boolean {
  if (!eventDate || !Number.isInteger(elapsedDays) || elapsedDays < 0) return false;
  const start = dateNumber(eventDate);
  const end = dateNumber(today);
  return start !== null && end !== null && Math.floor((end - start) / 86_400_000) >= elapsedDays;
}

export function gradeConversion(completed: number, eligible: number, band: RateBand): ConversionGrade {
  const rate = conversionRatePercent(completed, eligible);
  if (rate === null) return "NO_SAMPLE";
  if (rate >= band.excellent) return "EXCELLENT";
  if (rate >= band.good) return "GOOD";
  if (rate >= band.pass) return "PASS";
  return "BELOW_PASS";
}

export function validateConversionStandards(value: unknown): { valid: true; standards: GroupConversionStandards } | { valid: false; error: string } {
  if (!value || typeof value !== "object") return { valid: false, error: "评级标准参数不正确" };
  const input = value as Record<string, unknown>;
  const keys: Array<keyof GroupConversionStandards> = ["receptionJoin", "operatorExpert", "expertOrder"];
  const standards = {} as GroupConversionStandards;
  for (const key of keys) {
    const raw = input[key];
    if (!raw || typeof raw !== "object") return { valid: false, error: "请完整填写三个岗位的评级标准" };
    const band = raw as Record<string, unknown>;
    const pass = band.pass;
    const good = band.good;
    const excellent = band.excellent;
    if (![pass, good, excellent].every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 100)) {
      return { valid: false, error: "评级标准必须是 0 到 100 的整数" };
    }
    if (!(Number(pass) < Number(good) && Number(good) < Number(excellent))) {
      return { valid: false, error: "每个岗位必须满足：及格 < 良好 < 优秀" };
    }
    standards[key] = { pass: Number(pass), good: Number(good), excellent: Number(excellent) };
  }
  return { valid: true, standards };
}

export function standardsFromGroup(group: {
  receptionJoinPassRate: number; receptionJoinGoodRate: number; receptionJoinExcellentRate: number;
  operatorExpertPassRate: number; operatorExpertGoodRate: number; operatorExpertExcellentRate: number;
  expertOrderPassRate: number; expertOrderGoodRate: number; expertOrderExcellentRate: number;
}): GroupConversionStandards {
  return {
    receptionJoin: { pass: group.receptionJoinPassRate, good: group.receptionJoinGoodRate, excellent: group.receptionJoinExcellentRate },
    operatorExpert: { pass: group.operatorExpertPassRate, good: group.operatorExpertGoodRate, excellent: group.operatorExpertExcellentRate },
    expertOrder: { pass: group.expertOrderPassRate, good: group.expertOrderGoodRate, excellent: group.expertOrderExcellentRate },
  };
}
