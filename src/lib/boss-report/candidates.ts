import type {
  BossChannelQuality,
  BossEmployeeFunnel,
  BossProblemCandidate,
  DailyBossBrief,
} from "./types";

const MAX_EMPLOYEES_PER_ROLE = 6;
const MAX_CHANNELS = 12;

function uniqueBy<T>(rows: T[], key: (row: T) => string): T[] {
  const result: T[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = key(row);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(row);
  }
  return result;
}

function gradePriority(row: BossEmployeeFunnel) {
  if (row.sampleState === "INSUFFICIENT") return 4;
  return ({ BELOW_PASS: 0, PASS: 1, GOOD: 2, EXCELLENT: 3, NO_SAMPLE: 4 } as const)[row.evaluation.grade];
}

/**
 * The database may contain hundreds of employees. Scan all calculated rows,
 * but keep only the worst verified conversions plus the largest samples for AI.
 */
export function selectEmployeeFunnelsForAi(rows: BossEmployeeFunnel[]): BossEmployeeFunnel[] {
  return (["接粉", "炒群", "专家"] as const).flatMap((role) => {
    const roleRows = rows.filter((row) => row.role === role);
    const abnormal = [...roleRows]
      .filter((row) => row.sampleState === "RANKABLE")
      .sort((left, right) => gradePriority(left) - gradePriority(right)
        || (left.evaluation.ratePercent ?? Infinity) - (right.evaluation.ratePercent ?? Infinity)
        || right.sample - left.sample)
      .slice(0, 4);
    const largest = [...roleRows].sort((left, right) => right.sample - left.sample).slice(0, 3);
    const remaining = [...roleRows].sort((left, right) => gradePriority(left) - gradePriority(right)
      || (left.evaluation.ratePercent ?? Infinity) - (right.evaluation.ratePercent ?? Infinity)
      || right.sample - left.sample);
    return uniqueBy([...abnormal, ...largest, ...remaining], (row) => row.employeeId).slice(0, MAX_EMPLOYEES_PER_ROLE);
  });
}

function channelRisk(row: BossChannelQuality) {
  if (row.sampleState === "INSUFFICIENT") return -1;
  const rates = [row.effectiveRate, row.effectiveFanReplyRate, row.d7SubmittedOrderRate]
    .filter((value): value is number => value !== null);
  const weakest = rates.length ? Math.min(...rates) : 1;
  return (row.invalidRate ?? 0) * 2 + (1 - weakest);
}

export function selectChannelsForAi(rows: BossChannelQuality[]): BossChannelQuality[] {
  const risky = [...rows].sort((left, right) => channelRisk(right) - channelRisk(left) || right.submitted - left.submitted).slice(0, 8);
  const largest = [...rows].sort((left, right) => right.submitted - left.submitted).slice(0, 6);
  return uniqueBy([...risky, ...largest], (row) => row.name).slice(0, MAX_CHANNELS);
}

function employeeCandidate(row: BossEmployeeFunnel): BossProblemCandidate | null {
  if (row.sampleState !== "RANKABLE" || row.evaluation.grade !== "BELOW_PASS" || row.evaluation.ratePercent === null)
    return null;
  const { completed, eligible, metric, ratePercent, standard } = row.evaluation;
  return {
    id: `employee:${row.role}:${row.employeeId}`,
    category: "EMPLOYEE_CONVERSION",
    severity: ratePercent < standard.pass / 2 ? 3 : 2,
    target: `${row.groupName} / ${row.name}`,
    display: `${row.groupName} / ${row.name}：${metric} ${ratePercent.toFixed(1)}%，低于及格线 ${standard.pass}%（${completed}/${eligible}）`,
    actionHint: `由对应组长复盘${metric}的未转化样本，区分资源、话术和推进问题`,
    facts: { role: row.role, metric, ratePercent, completed, eligible, passRatePercent: standard.pass },
  };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function channelCandidates(rows: BossChannelQuality[]): BossProblemCandidate[] {
  const rankable = rows.filter((row) => row.sampleState === "RANKABLE");
  const replyMedian = median(rankable.flatMap((row) => row.effectiveFanReplyRate === null ? [] : [row.effectiveFanReplyRate]));
  const effectiveMedian = median(rankable.flatMap((row) => row.effectiveRate === null ? [] : [row.effectiveRate]));
  return rankable.flatMap((row) => {
    const issues: string[] = [];
    if (row.invalidRate !== null && row.invalidRate >= 0.2) issues.push(`无效率 ${(row.invalidRate * 100).toFixed(1)}%`);
    if (replyMedian !== null && row.effectiveFanReplyRate !== null && row.effectiveFanReplyRate < replyMedian * 0.7)
      issues.push(`回复率 ${(row.effectiveFanReplyRate * 100).toFixed(1)}%`);
    if (effectiveMedian !== null && row.effectiveRate !== null && row.effectiveRate < effectiveMedian * 0.7)
      issues.push(`有效率 ${(row.effectiveRate * 100).toFixed(1)}%`);
    if (!issues.length) return [];
    return [{
      id: `channel:${row.name}`,
      category: "CHANNEL_QUALITY" as const,
      severity: issues.length >= 2 ? 3 as const : 2 as const,
      target: row.name,
      display: `渠道 ${row.name}：${issues.join("，")}，样本 ${row.submitted}`,
      actionHint: "资源部按公司和小组拆分复查渠道质量，确认是资源问题还是承接问题后再调整投放",
      facts: {
        submitted: row.submitted,
        invalidRate: row.invalidRate,
        effectiveRate: row.effectiveRate,
        effectiveFanReplyRate: row.effectiveFanReplyRate,
      },
    }];
  });
}

function fallbackCandidate(index: number): BossProblemCandidate {
  const messages = [
    ["员工观察", "其余达到样本门槛的员工暂未发现低于及格线的转化", "保持当前执行节奏，继续积累下一业务日样本"],
    ["渠道观察", "其余达到样本门槛的渠道暂未发现明显质量异常", "维持观察，不根据单日波动调整渠道预算"],
    ["整体观察", "当前没有更多已核实问题，不追加主观判断", "次日继续核对数据完整性和转化变化"],
  ][index % 3];
  return {
    id: `observation:${index + 1}`,
    category: "OBSERVATION",
    severity: 0,
    target: messages[0],
    display: messages[1],
    actionHint: messages[2],
    facts: {},
  };
}

export function buildVerifiedProblems(brief: DailyBossBrief): BossProblemCandidate[] {
  const context = brief.aiContext;
  if (!context) return [fallbackCandidate(0), fallbackCandidate(1), fallbackCandidate(2)];
  const problems: BossProblemCandidate[] = [];
  const completeness = context.dataCompleteness;
  if (completeness.activeFrontline > completeness.confirmedFrontline) {
    const missing = completeness.activeFrontline - completeness.confirmedFrontline;
    problems.push({
      id: "data:confirmation",
      category: "DATA_COMPLETENESS",
      severity: 3,
      target: "数据完整性",
      display: `仍有 ${missing} 名在职一线员工未确认 ${brief.reportDate} 数据，员工评价暂缓`,
      actionHint: "先由组长完成数据确认，再讨论员工表现和渠道质量",
      facts: { activeFrontline: completeness.activeFrontline, confirmedFrontline: completeness.confirmedFrontline, missing },
    });
  }
  const anomalyRows: Array<[string, number, string, string]> = [
    ["intro", brief.anomalies.overdueExpertIntro, "进群第3天仍未推专家", "安排炒群员逐个检查并在当天推进或说明原因"],
    ["contact", brief.anomalies.overdueExpertContact, "推专家后1天仍未联系", "安排专家逐个联系并记录结果"],
    ["order", brief.anomalies.overdueOrder, "联系后2天仍未开单", "由专家复盘注册和入金引导卡点"],
  ];
  for (const [key, count, label, hint] of anomalyRows) {
    if (!count) continue;
    problems.push({
      id: `flow:${key}`,
      category: "CUSTOMER_FLOW",
      severity: 3,
      target: label,
      display: `${label}：${count} 位`,
      actionHint: hint,
      facts: { count },
    });
  }
  const early = context.leavesToday.day1To8Abnormal;
  if (early.total) {
    problems.push({
      id: "leave:early",
      category: "EARLY_LEAVE",
      severity: 3,
      target: "1–8天异常退群",
      display: `1–8天异常退群 ${early.total} 位，其中已开单 ${early.withOrder} 位、未开单 ${early.withoutOrder} 位`,
      actionHint: "逐个核查退群时间、退群原因和开单情况，并分清资源质量与群内承接问题",
      facts: { total: early.total, withOrder: early.withOrder, withoutOrder: early.withoutOrder },
    });
  }
  if (completeness.activeFrontline === completeness.confirmedFrontline) {
    problems.push(...context.employeeFunnels.flatMap((row) => employeeCandidate(row) ?? []));
    problems.push(...channelCandidates(context.channelQuality));
  }

  const categoryPriority: Record<BossProblemCandidate["category"], number> = {
    DATA_COMPLETENESS: 0,
    EARLY_LEAVE: 1,
    CUSTOMER_FLOW: 2,
    EMPLOYEE_CONVERSION: 3,
    CHANNEL_QUALITY: 4,
    OBSERVATION: 5,
  };
  const selected = uniqueBy(
    problems.sort((left, right) => right.severity - left.severity
      || categoryPriority[left.category] - categoryPriority[right.category]
      || left.id.localeCompare(right.id)),
    (row) => row.id,
  ).slice(0, 3);
  while (selected.length < 3) selected.push(fallbackCandidate(selected.length));
  return selected;
}
