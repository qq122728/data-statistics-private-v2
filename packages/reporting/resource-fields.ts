export type ResourceBusiness = "HACKER" | "LAWYER";
export type ResourceTotals = {
  added: number; collision: number; lowAmount: number; noWs: number; manualInvalid: number; effective: number;
  lawyerRealCase: number; lawyerAdded: number; lawyerExpertAdded: number; customerServicePush: number;
  replied: number; joined: number; left: number; abnormalLeft: number; inGroup: number;
  pushed: number; registered: number; ordered: number; initialDepositCents: number; rechargeCents: number;
  depositCents: number; cryptoDepositCents: number; bankDepositCents: number; withdrawalCents: number;
};
export type ResourceFieldGroup = "common" | "rates" | "leaves" | "historical";
export type ResourceField = { id: string; label: string; group: ResourceFieldGroup; kind?: "money" | "rate"; value: (totals: ResourceTotals) => number | null };
const ratio = (n: number, d: number) => d > 0 ? n / d : null;
const count = (id: keyof ResourceTotals, label: string, group: ResourceFieldGroup = "common"): ResourceField => ({ id, label, group, value: t => t[id] ?? 0 });
const currency = (id: keyof ResourceTotals, label: string): ResourceField => ({ ...count(id, label), kind: "money" });

// The same fields drive channel columns and member rows. Filtering these definitions never filters data.
export const HACKER_RESOURCE_FIELDS: readonly ResourceField[] = [
  count("added", "添加"), count("effective", "有效"), count("replied", "回复"), count("joined", "进群"),
  count("inGroup", "当前在群"), count("pushed", "加专家"), count("registered", "注册"), count("ordered", "开单"),
  currency("initialDepositCents", "首充"), currency("rechargeCents", "续充"), currency("withdrawalCents", "出金"),
  { id: "net", label: "净业绩", group: "common", kind: "money", value: t => t.depositCents - t.withdrawalCents },
  { id: "replyRate", label: "回复率", group: "rates", kind: "rate", value: t => ratio(t.replied, t.effective) },
  { id: "joinRate", label: "进群率", group: "rates", kind: "rate", value: t => ratio(t.joined, t.effective) },
  { id: "abnormalLeaveRate", label: "异常退群率", group: "rates", kind: "rate", value: t => ratio(t.abnormalLeft, t.joined - (t.left - t.abnormalLeft)) },
  { id: "registerRate", label: "注册率", group: "rates", kind: "rate", value: t => ratio(t.registered, t.pushed) },
  { id: "orderRate", label: "开单率", group: "rates", kind: "rate", value: t => ratio(t.ordered, t.registered) },
  { id: "normalLeft", label: "正常退群", group: "leaves", value: t => t.left - t.abnormalLeft },
  count("abnormalLeft", "异常退群", "leaves"),
  count("collision", "撞粉", "historical"), count("lowAmount", "低金额", "historical"),
  count("noWs", "无 WS", "historical"), count("manualInvalid", "人工无效", "historical"),
];

export const LAWYER_RESOURCE_FIELDS: readonly ResourceField[] = [
  count("added", "接粉"), count("replied", "回复"),
  { id: "unreplied", label: "未回复", group: "common", value: t => Math.max(0, t.added - t.replied) },
  count("lowAmount", "接粉小金额"), count("lawyerRealCase", "接粉真实案件"),
  { id: "replyRate", label: "回复率", group: "rates", kind: "rate", value: t => ratio(t.replied, t.added) },
  count("lawyerAdded", "添加律师"), count("lawyerExpertAdded", "添加专家"),
  { id: "lawyerRate", label: "添加律师率", group: "rates", kind: "rate", value: t => ratio(t.lawyerAdded, t.added) },
  { id: "lawyerExpertRate", label: "添加专家率", group: "rates", kind: "rate", value: t => ratio(t.lawyerExpertAdded, t.added) },
  count("customerServicePush", "总推客服"), count("registered", "总注册"), count("ordered", "总开单"),
  currency("cryptoDepositCents", "加密货币充值"), currency("bankDepositCents", "银行卡充值"), currency("withdrawalCents", "出金"),
];

export type ResourceFieldVisibility = Record<Exclude<ResourceFieldGroup, "common">, boolean>;
export function visibleResourceFields(business: ResourceBusiness, visibility: ResourceFieldVisibility) {
  return business === "LAWYER" ? LAWYER_RESOURCE_FIELDS : HACKER_RESOURCE_FIELDS.filter(f => f.group === "common" || visibility[f.group]);
}
export function hasHistoricalResourceValues(totals: readonly ResourceTotals[]) {
  return totals.some(t => [t.collision, t.lowAmount, t.noWs, t.manualInvalid].some(n => Number(n ?? 0) !== 0));
}
export function isPreviousResourceMonth(periods: readonly { from: string; today: string }[]) {
  return periods.some(p => /^\d{4}-\d{2}-\d{2}$/.test(p.from) && /^\d{4}-\d{2}-\d{2}$/.test(p.today) && p.from.slice(0, 7) < p.today.slice(0, 7));
}
export function resourcePreferenceKey(userId: string, business: ResourceBusiness, reportType: string) {
  return `resource-fields:v1:${JSON.stringify([userId, business, reportType])}`;
}
export type ResourceFieldPreference = { rates?: boolean; leaves?: boolean; historical?: { context: string; expanded: boolean } };
export function readResourceFieldPreference(raw: string | null): ResourceFieldPreference {
  try {
    const p = JSON.parse(raw ?? "{}");
    if (!p || typeof p !== "object") return {};
    return {
      ...(typeof p.rates === "boolean" ? { rates: p.rates } : {}),
      ...(typeof p.leaves === "boolean" ? { leaves: p.leaves } : {}),
      ...(typeof p.historical?.context === "string" && typeof p.historical.expanded === "boolean" ? { historical: p.historical } : {}),
    };
  } catch { return {}; }
}
export function resolveResourceVisibility(preference: ResourceFieldPreference, context: string, warnHistory: boolean): ResourceFieldVisibility {
  return { rates: preference.rates ?? false, leaves: preference.leaves ?? false, historical: preference.historical?.context === context ? preference.historical.expanded : warnHistory };
}
