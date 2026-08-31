/** 客户漏斗数据的通用计算——接粉/炒群/专家三个岗位共用同一套口径，只是各自传进来的
 *  activeLeads/downstreamLeads 范围不同（接粉按 attributionOwner 筛，炒群按 groupOperator，
 *  专家按 expertOwner）。所有人对这份数据都有利益关系，所以口径必须统一、不能各岗位各算一套。 */
import type { DownstreamLead, Lead } from "./mock-data";

export function pct(n: number, d: number): string {
  if (d <= 0) return "—";
  return `${Math.round((n / d) * 1000) / 10}%`;
}

/** 某个月第一天——日期范围筛选默认从这里开始 */
export function monthStart(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

/** [start, end] 闭区间里的每一天，YYYY-MM-DD——封个上限，防止手滑选个跨好几年的范围卡死页面 */
export function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const last = new Date(`${end}T00:00:00`);
  while (cursor.getTime() <= last.getTime() && out.length < 366) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** 客户漏斗数据的一行——不管是"某一天"、"整个时间范围"还是"某个渠道"，都用同一套字段 */
export type FunnelRow = {
  added: number; duplicate: number; lowAmount: number; noWs: number; effective: number;
  replied: number; joined: number; left: number; leftAbnormal: number;
  pushed: number; registered: number; ordered: number;
  depositUsd: number; withdrawalUsd: number; netUsd: number;
};

/** 按天统计只能用真的留了日期戳的字段——添加/回复/低金额/无WS 用来源日期（这几步在这个业务里
 *  通常就发生在添加前后几天，来源日期是唯一一直保留的时间锚点）；进群/退群/推专家/注册/开单/
 *  入金/出金用各自动作实际发生那天存的日期字段，更准。首充/续充/出金统一从 moneyEvents 里取，
 *  不再单独存 lastOrderAmountUsd/orderedDate——一笔流水一条记录，编辑/核对都对着同一份数据。 */
export function computeFunnelRow(
  activeLeads: Lead[], downstreamLeads: DownstreamLead[], match: (dateStr: string) => boolean,
): FunnelRow {
  const added = [...activeLeads, ...downstreamLeads].filter((l) => match(l.sourceDate)).length;
  const lowAmount = activeLeads.filter((l) => match(l.sourceDate) && l.invalidKind === "LOW_AMOUNT").length;
  const noWs = activeLeads.filter((l) => match(l.sourceDate) && l.invalidKind === "NO_WS").length;
  const effective = added - lowAmount - noWs;
  const repliedActive = activeLeads.filter((l) => match(l.sourceDate) && (l.repliedAt || l.chatStatus)).length;
  const repliedDownstream = downstreamLeads.filter((d) => match(d.sourceDate)).length;
  const replied = repliedActive + repliedDownstream;
  const joined = downstreamLeads.filter((d) => match(d.groupJoinDate ?? d.sourceDate)).length;
  const leftRecords = downstreamLeads.filter((d) => d.leftGroupDate && match(d.leftGroupDate));
  const left = leftRecords.length;
  const leftAbnormal = leftRecords.filter((d) => d.leftGroupAbnormal).length;
  const pushed = downstreamLeads.filter((d) => d.pushedToExpertDate && match(d.pushedToExpertDate)).length;
  const registered = downstreamLeads.filter((d) => d.registeredDate && match(d.registeredDate)).length;
  const allEvents = downstreamLeads.flatMap((d) => (d.moneyEvents ?? []).map((e) => ({ ...e, leadId: d.id })));
  const orderedEvents = allEvents.filter((e) => e.kind === "首充" && match(e.date));
  const ordered = orderedEvents.length;
  const depositUsd = allEvents
    .filter((e) => (e.kind === "首充" || e.kind === "续充") && match(e.date))
    .reduce((s, e) => s + e.amountUsd, 0);
  const withdrawalUsd = allEvents
    .filter((e) => e.kind === "出金" && match(e.date))
    .reduce((s, e) => s + e.amountUsd, 0);
  return {
    added, duplicate: 0, lowAmount, noWs, effective, replied, joined, left, leftAbnormal,
    pushed, registered, ordered, depositUsd, withdrawalUsd, netUsd: depositUsd - withdrawalUsd,
  };
}

/** 当前还在群里的数量——已开单/已退群/历史补录都不算，是个"此刻"的快照，不受时间范围筛选影响 */
export function countCurrentlyInGroup(downstreamLeads: DownstreamLead[]): number {
  return downstreamLeads.filter((d) =>
    d.category === "inGroup" || d.category === "expertQueue" || d.category === "expertWorking").length;
}

/** 紧凑展示用——数量和转化率拼进同一格，不单独占一列，横着排、宽度不够就自动换行，不用左右滑动。
 *  两条口径已经跟老板确认过，锁定，别改：
 *  1) 进群率 = 进群 ÷ 添加数据（不是 ÷ 回复），例：添加100、进群10 → 进群率10%。
 *  2) 退群拆成正常/异常两个状态分开统计——进群满14天退的算正常，不满14天（1~13天）退的算异常。
 *     退群率专指异常退群率 = 异常退群 ÷ 进群，例：进群20、异常退群10 → 退群率50%。 */
export const FUNNEL_CHIPS: Array<{
  key: string; label: string; render: (r: FunnelRow) => string; tone?: (r: FunnelRow) => "ok" | "bad" | undefined;
}> = [
  { key: "added", label: "添加数据", render: (r) => `${r.added}` },
  { key: "dup", label: "撞粉", render: (r) => `${r.duplicate}` },
  { key: "lowAmount", label: "低金额", render: (r) => `${r.lowAmount}` },
  { key: "noWs", label: "无WS号码", render: (r) => `${r.noWs}` },
  { key: "effective", label: "有效数据", render: (r) => `${r.effective}` },
  { key: "replied", label: "回复", render: (r) => `${r.replied} · ${pct(r.replied, r.effective)}` },
  { key: "joined", label: "进群", render: (r) => `${r.joined} · ${pct(r.joined, r.added)}` },
  { key: "leftNormal", label: "正常退群", render: (r) => `${r.left - r.leftAbnormal}` },
  { key: "leftAbnormal", label: "异常退群 · 退群率", render: (r) => `${r.leftAbnormal} · ${pct(r.leftAbnormal, r.joined)}` },
  { key: "pushed", label: "推专家", render: (r) => `${r.pushed}` },
  { key: "registered", label: "注册", render: (r) => `${r.registered} · ${pct(r.registered, r.pushed)}` },
  { key: "ordered", label: "开单", render: (r) => `${r.ordered} · ${pct(r.ordered, r.registered)}` },
  { key: "depositUsd", label: "入金", render: (r) => `$${r.depositUsd}`, tone: () => "ok" },
  { key: "withdrawalUsd", label: "出金", render: (r) => `$${r.withdrawalUsd}`, tone: (r) => (r.withdrawalUsd > 0 ? "bad" : undefined) },
  { key: "netUsd", label: "净业绩", render: (r) => `$${r.netUsd}`, tone: (r) => (r.netUsd >= 0 ? "ok" : "bad") },
];
