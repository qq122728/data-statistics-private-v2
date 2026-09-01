export type DailyValues = {
  dispatchCount: number;
  duplicateCount: number;
  lowAmountCount: number;
  noWsCount: number;
  manualInvalidCount: number;
  lawyerRealCaseCount: number;
  lawyerAddedCount: number;
  lawyerExpertAddedCount: number;
  customerServicePushCount: number;
  effectiveCount: number;
  replyCount: number;
  joinCount: number;
  operatorReceivedCount: number;
  normalLeaveCount: number;
  abnormalLeaveCount: number;
  currentInGroupCount: number;
  expertIntroCount: number;
  expertReceivedCount: number;
  expertContactedCount: number;
  registrationCount: number;
  orderCount: number;
  cryptoInitialDepositCents: number;
  bankInitialDepositCents: number;
  cryptoRechargeCents: number;
  bankRechargeCents: number;
  withdrawalCents: number;
};

export const EMPTY_DAILY_VALUES: DailyValues = {
  dispatchCount: 0, duplicateCount: 0, lowAmountCount: 0, noWsCount: 0, manualInvalidCount: 0,
  lawyerRealCaseCount: 0, lawyerAddedCount: 0, lawyerExpertAddedCount: 0, customerServicePushCount: 0,
  effectiveCount: 0, replyCount: 0, joinCount: 0, operatorReceivedCount: 0, normalLeaveCount: 0,
  abnormalLeaveCount: 0, currentInGroupCount: 0, expertIntroCount: 0, expertReceivedCount: 0,
  expertContactedCount: 0, registrationCount: 0, orderCount: 0, cryptoInitialDepositCents: 0,
  bankInitialDepositCents: 0, cryptoRechargeCents: 0, bankRechargeCents: 0, withdrawalCents: 0,
};

export type MetricUpdate = { key: keyof DailyValues; label: string; value: number; money?: boolean };
export type AssistantIntent =
  | { kind: "daily"; correction: boolean; updates: MetricUpdate[] }
  | { kind: "customer_query"; phoneTail: string }
  | { kind: "customer_note"; phoneTail: string; noteKind: "group" | "expert"; note: string }
  | { kind: "legacy_event"; phoneTail: string; event: "JOINED" | "ORDERED" | "RECHARGE"; sourceDate: string; amountCents?: number; channelName?: string; receptionOwnerName?: string; groupOperatorName?: string; expertName?: string }
  | { kind: "unknown" };

const metricPatterns: Array<{ key: keyof DailyValues; label: string; money?: boolean; patterns: string[] }> = [
  { key: "dispatchCount", label: "添加数据", patterns: ["添加数据", "接粉", "添加"] },
  { key: "duplicateCount", label: "撞粉", patterns: ["撞粉"] },
  { key: "lowAmountCount", label: "低金额", patterns: ["低金额", "小金额"] },
  { key: "noWsCount", label: "无 WS 号码", patterns: ["无WS号码", "无WS", "无号码"] },
  { key: "manualInvalidCount", label: "人工无效", patterns: ["人工无效", "无效"] },
  { key: "replyCount", label: "回复", patterns: ["回复数据", "回复"] },
  { key: "joinCount", label: "进群", patterns: ["进群数据", "拉群数据", "进群", "拉群"] },
  { key: "normalLeaveCount", label: "正常退群", patterns: ["正常退群"] },
  { key: "abnormalLeaveCount", label: "异常退群", patterns: ["异常退群"] },
  { key: "expertIntroCount", label: "推专家", patterns: ["推专家", "引导专家"] },
  { key: "registrationCount", label: "注册", patterns: ["注册数据", "注册"] },
  { key: "orderCount", label: "开单", patterns: ["开单数据", "开单"] },
  { key: "cryptoInitialDepositCents", label: "首充", money: true, patterns: ["首充"] },
  { key: "cryptoRechargeCents", label: "续充", money: true, patterns: ["续充", "入金"] },
  { key: "withdrawalCents", label: "出金", money: true, patterns: ["出金"] },
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phoneTail(message: string) {
  const candidates = message.match(/[+\d][\d\s()-]{4,}/g) ?? [];
  const digits = candidates.map((item) => item.replace(/\D/g, "")).find((item) => item.length >= 4);
  return digits ? digits.slice(-6) : "";
}

export function interpretAssistantMessage(message: string): AssistantIntent {
  const compact = message.replace(/[,，:：=＝]/g, " ").replace(/\s+/g, " ").trim();
  const tail = phoneTail(compact);
  const sourceDateMatch = compact.match(/(?:(20\d{2})[年/.-])?(\d{1,2})[月/.-](\d{1,2})日?/);
  if (tail && sourceDateMatch && /老客户|老粉|历史|的粉/.test(compact) && /进群|拉群|开单|续充/.test(compact)) {
    const sourceDate = `${sourceDateMatch[1] ?? new Date().getFullYear()}-${sourceDateMatch[2].padStart(2, "0")}-${sourceDateMatch[3].padStart(2, "0")}`;
    const event = /续充/.test(compact) ? "RECHARGE" as const : /开单/.test(compact) ? "ORDERED" as const : "JOINED" as const;
    const amountMatch = event === "JOINED" ? null : compact.match(/(?:开单|首充|续充|金额)[^\d]{0,12}(\d+(?:\.\d+)?)/);
    return { kind: "legacy_event", phoneTail: tail, event, sourceDate, ...(amountMatch ? { amountCents: Math.round(Number(amountMatch[1]) * 100) } : {}) };
  }
  const groupMatch = compact.match(/(?:炒群情况|群内情况|炒群进度)(?:写错了|改成|修改为|更新为|是|为)?\s*(.+)$/);
  if (tail && groupMatch?.[1]?.trim()) return { kind: "customer_note", phoneTail: tail, noteKind: "group", note: groupMatch[1].trim() };
  const expertMatch = compact.match(/(?:专家情况|专家进度)(?:写错了|改成|修改为|更新为|是|为)?\s*(.+)$/);
  if (tail && expertMatch?.[1]?.trim()) return { kind: "customer_note", phoneTail: tail, noteKind: "expert", note: expertMatch[1].trim() };

  const updates: MetricUpdate[] = [];
  const occupied = new Set<keyof DailyValues>();
  for (const metric of metricPatterns) {
    for (const alias of metric.patterns) {
      const match = compact.match(new RegExp(`${escapeRegExp(alias)}[^\\d-]{0,24}(?:\\$|¥|￥)?\\s*(-?\\d+(?:\\.\\d+)?)`, "i"));
      if (!match) continue;
      const raw = Number(match[1]);
      if (!Number.isFinite(raw) || raw < 0 || occupied.has(metric.key)) break;
      updates.push({ key: metric.key, label: metric.label, value: metric.money ? Math.round(raw * 100) : Math.round(raw), money: metric.money });
      occupied.add(metric.key);
      break;
    }
  }
  if (updates.length) return { kind: "daily", correction: /写错|改成|修改|纠正|应该是|不对/.test(compact), updates };
  if (tail && /查|查询|看看|进度|客户/.test(compact)) return { kind: "customer_query", phoneTail: tail };
  return { kind: "unknown" };
}

export function withComputedValues(values: DailyValues): DailyValues {
  return {
    ...values,
    effectiveCount: Math.max(0, values.dispatchCount - values.duplicateCount - values.lowAmountCount - values.noWsCount - values.manualInvalidCount),
    currentInGroupCount: Math.max(0, values.joinCount - values.normalLeaveCount - values.abnormalLeaveCount),
  };
}

export function formatAssistantValue(value: number, money?: boolean) {
  return money
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value / 100)
    : Math.round(value).toLocaleString();
}
