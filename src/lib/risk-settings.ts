export const defaultRiskSettings = {
  trainingDays: 7,
  observationDays: 30,
  coachingEfficiency: 0.80,
  coachingDays: 7,
  limitEfficiency: 0.70,
  limitDays: 15,
  eliminationEfficiency: 0.60,
  eliminationDays: 30,
  replyMinNewFans: 50,
  groupMinNewFans: 50,
  leaveMinGroupJoin: 30,
  expertMinGroupJoin: 30,
  registrationMinExpert: 20,
  orderMinNewFans: 100,
  efficiencyMinEffectiveFans: 100,
  priceComparisonMinOrders: 5,
} as const;

export type RiskSettings = { -readonly [Key in keyof typeof defaultRiskSettings]: number };

const BASIS_POINT_SCALE = 10_000;

function toBasisPoints(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const scaled = value * BASIS_POINT_SCALE;
  const rounded = Math.round(scaled);
  const floatingPointTolerance = Number.EPSILON * BASIS_POINT_SCALE * 4;
  return Number.isSafeInteger(rounded) && Math.abs(scaled - rounded) <= floatingPointTolerance
    ? rounded
    : null;
}

export function hasBasisPointPrecision(value: number): boolean {
  return toBasisPoints(value) !== null;
}

type StoredSetting = { key: string; value: string };

const integerSettings = {
  trainingDays: "risk.trainingDays",
  observationDays: "risk.observationDays",
  coachingDays: "risk.coachingDays",
  limitDays: "risk.limitDays",
  eliminationDays: "risk.eliminationDays",
  replyMinNewFans: "risk.replyMinNewFans",
  groupMinNewFans: "risk.groupMinNewFans",
  leaveMinGroupJoin: "risk.leaveMinGroupJoin",
  expertMinGroupJoin: "risk.expertMinGroupJoin",
  registrationMinExpert: "risk.registrationMinExpert",
  orderMinNewFans: "risk.orderMinNewFans",
  efficiencyMinEffectiveFans: "risk.efficiencyMinEffectiveFans",
  priceComparisonMinOrders: "risk.priceComparisonMinOrders",
} as const;

const efficiencySettings = {
  coachingEfficiency: "risk.coachingEfficiencyBps",
  limitEfficiency: "risk.limitEfficiencyBps",
  eliminationEfficiency: "risk.eliminationEfficiencyBps",
} as const;

function readInteger(value: string | undefined, fallback: number, key: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (/^\d+$/.test(value) && Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  console.error(`Invalid risk setting ${key}; using default`);
  return fallback;
}

function readEfficiency(value: string | undefined, fallback: number, key: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (/^\d+$/.test(value) && Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 10_000) return parsed / 10_000;
  console.error(`Invalid risk setting ${key}; using default`);
  return fallback;
}

export function parseRiskSettings(settings: readonly StoredSetting[]): RiskSettings {
  const stored = new Map(settings.map(({ key, value }) => [key, value]));
  const parsed = { ...defaultRiskSettings } as RiskSettings;

  for (const [name, key] of Object.entries(integerSettings) as Array<[keyof typeof integerSettings, string]>) {
    parsed[name] = readInteger(stored.get(key), defaultRiskSettings[name], key);
  }
  for (const [name, key] of Object.entries(efficiencySettings) as Array<[keyof typeof efficiencySettings, string]>) {
    parsed[name] = readEfficiency(stored.get(key), defaultRiskSettings[name], key);
  }

  return parsed;
}

export function toRiskSettingEntries(settings: RiskSettings): StoredSetting[] {
  const storedEfficiencies = Object.entries(efficiencySettings).map(([name, key]) => {
    const basisPoints = toBasisPoints(settings[name as keyof typeof efficiencySettings]);
    if (basisPoints === null) throw new RangeError("效率阈值最多保留 4 位小数");
    return { key, value: String(basisPoints) };
  });
  return [
    ...Object.entries(integerSettings).map(([name, key]) => ({ key, value: String(settings[name as keyof typeof integerSettings]) })),
    ...storedEfficiencies,
  ];
}

export const riskSettingKeys = [
  ...Object.values(integerSettings),
  ...Object.values(efficiencySettings),
] as const;
