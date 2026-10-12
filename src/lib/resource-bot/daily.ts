import type { ResourceAnalysis, Warning } from "./analysis";
import type { BotConfig } from "./config";

export type DueGroup = { groupId: string; groupName: string; date: string; ready: boolean };
export type DeliveryState = { sent: Record<string, { status: "sending" | "sent" | "uncertain"; at: string; messageId?: number }> };
const money = (n: number) => "$" + (n / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const rate = (n: number) => (n * 100).toFixed(1) + "%";
const compact = (s: string, n = 180) => s.length > n ? s.slice(0, n) + "…" : s;
const buyerKey = (w: Warning) => w.title.split("｜").slice(0, 3).join("｜");
export function dailyReportText(a: ResourceAnalysis, names: string[]) {
  if (!a.performance.recordCount) return "";
  const daily = a.dailyPerformance, month = a.performance;
  const line = (p: typeof month) => `回复 ${p.replies}｜进群 ${p.joins}｜引专家 ${p.introductions}｜注册 ${p.registrations}｜开单 ${p.orders}｜续充 ${money(p.rechargeCents)}`;
  const warnings = [...a.warnings].sort((a, b) => Number(/率|人均/.test(b.title)) - Number(/率|人均/.test(a.title)));
  const selected: Warning[] = [], buyers = new Set<string>();
  for (const w of warnings) if (!buyers.has(buyerKey(w))) { buyers.add(buyerKey(w)); selected.push(w); if (selected.length === 3) break; }
  const improvements = a.trends.filter(t => t.comparison === "批次环比" && t.scope.endsWith("全部国家") && t.unit === "rate" && t.declineRelative !== null && t.declineRelative <= -0.1).slice(0, 2);
  const lines = ["📊 资源参谋｜收工资源分析", `${a.range.to}｜${compact(names.join("、"), 100)}`, "范围：本时段收工小组中，已匹配投手/供应方的号码。", "", "今日发生", line({ ...daily, recordCount: month.recordCount }), "本月累计（截至本次收工）", line(month), ""];
  const rates = a.trends.filter(t => t.comparison === "批次环比" && t.scope.endsWith("全部国家") && t.unit === "rate");
  if (rates.length) {
    lines.push("同龄转化概览（各批均观察7天，开单率观察30天）");
    const scopes = [...new Set(rates.map(t => t.scope))].slice(0, 4);
    for (const scope of scopes) {
      const ts = rates.filter(t => t.scope === scope);
      lines.push(compact(scope.replace("｜全部国家", ""), 70) + "：" + ts.map(t => `${t.metric.replace("引专家后7日注册转化率", "7日注册转化")} ${rate(t.currentValue)}`).join("；"));
    }
    lines.push("");
  }
  if (improvements.length) {
    lines.push("🟢 转化改善");
    for (const t of improvements) lines.push(`${compact(t.scope, 70)} ${t.metric}：${rate(t.previousValue)} → ${rate(t.currentValue)}，提升 ${(-t.declineRelative! * 100).toFixed(1)}%；批次 ${t.previousFrom}—${t.previousTo} 对 ${t.currentFrom}—${t.currentTo}。建议保持跟进并继续验证后续开单。`);
    lines.push("");
  }
  lines.push(selected.length ? `🔴 严重预警（共${a.warnings.length}个比较信号，优先列${selected.length}个来源）` : "本次可比数据未触发严重预警。");
  for (const [i, w] of selected.entries()) lines.push(`${i + 1}. ${compact(w.title, 110)}\n${w.evidence}\n建议：${w.action}`);
  lines.push("", "调整原则：数量下降先对照接粉量；转化下滑再检查来源与业务承接；续充看同龄老客户，不把新粉尚未成熟判成差粉。", "相对下降≥10%触发严重预警；无可比数据的项目跳过。月环比对上月同段，同比对去年同期。可在群里 @我 继续查具体投手、国家或导出表格。");
  const text = lines.join("\n");
  if (text.length > 4000) throw Error("资源日报过长，需调整摘要长度");
  return text;
}

export async function dispatchResourceDaily(input: {
  config: BotConfig | null; due: DueGroup[]; state: DeliveryState; dryRun?: boolean;
  analyze: (date: string, groupIds: string[]) => Promise<ResourceAnalysis>;
  save: (state: DeliveryState) => Promise<void>;
  send: (chatId: string, text: string) => Promise<{ message_id: number }>;
}) {
  const { config, state } = input;
  if (!config?.enabled || !config.chatId) return [];
  const candidates = input.due.filter(r => r.ready && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !state.sent[`${config.botId}:${config.chatId}:${r.groupId}:${r.date}`]);
  const outputs = [];
  for (const date of [...new Set(candidates.map(r => r.date))]) {
    const groups = [...new Map(candidates.filter(r => r.date === date).map(r => [r.groupId, r])).values()];
    const a = await input.analyze(date, groups.map(g => g.groupId));
    const text = dailyReportText(a, groups.map(g => g.groupName));
    if (!text) continue;
    outputs.push({ date, groups: groups.map(g => g.groupName), text, status: input.dryRun ? "preview" : "sent" });
    if (input.dryRun) continue;
    const keys = groups.map(g => `${config.botId}:${config.chatId}:${g.groupId}:${date}`);
    for (const k of keys) state.sent[k] = { status: "sending", at: new Date().toISOString() };
    // Claim durably BEFORE sending; a timeout is uncertain, not permission to duplicate a group post.
    await input.save(state);
    try {
      const message = await input.send(config.chatId, text);
      for (const k of keys) state.sent[k] = { status: "sent", at: new Date().toISOString(), messageId: message.message_id };
      await input.save(state);
    } catch {
      for (const k of keys) state.sent[k] = { status: "uncertain", at: new Date().toISOString() };
      await input.save(state);
      throw Error("资源日报发送结果未确认，已保留记录避免重复推送，请检查发送日志");
    }
  }
  return outputs;
}
