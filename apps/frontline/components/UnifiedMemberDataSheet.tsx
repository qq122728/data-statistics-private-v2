"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "@/lib/backend";

type Values = {
  dispatchCount: number;
  duplicateCount: number;
  lowAmountCount: number;
  noWsCount: number;
  manualInvalidCount: number;
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

type Entry = {
  id: string;
  businessDate: string;
  position: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  status: string;
  channel: { id: string; name: string };
  currentRevision: (Values & { changeReason: string | null }) | null;
  approvedRevision: Values | null;
};

type Context = {
  actorId: string;
  today: string;
  channels: Array<{ id: string; name: string; channelType: string }>;
  entries: Entry[];
  unifiedEntries: Array<{
    entryId: string | null;
    businessDate: string;
    channel: { id: string; name: string };
    status: string;
    values: Values;
  }>;
};

type Mode = "daily" | "finance";
type ChannelState = { values: Values; entryId: string | null; approved: boolean };

const EMPTY_VALUES: Values = {
  dispatchCount: 0,
  duplicateCount: 0,
  lowAmountCount: 0,
  noWsCount: 0,
  manualInvalidCount: 0,
  effectiveCount: 0,
  replyCount: 0,
  joinCount: 0,
  operatorReceivedCount: 0,
  normalLeaveCount: 0,
  abnormalLeaveCount: 0,
  currentInGroupCount: 0,
  expertIntroCount: 0,
  expertReceivedCount: 0,
  expertContactedCount: 0,
  registrationCount: 0,
  orderCount: 0,
  cryptoInitialDepositCents: 0,
  bankInitialDepositCents: 0,
  cryptoRechargeCents: 0,
  bankRechargeCents: 0,
  withdrawalCents: 0,
};

type Metric = {
  key: string;
  label: string;
  kind: "number" | "money" | "rate" | "computed" | "computedMoney";
  tone?: "bad" | "ok";
  read: (values: Values) => number;
  write?: (values: Values, value: number) => Values;
};

const numberMetric = (key: keyof Values, label: string, tone?: "bad" | "ok"): Metric => ({
  key,
  label,
  kind: "number",
  tone,
  read: (values) => values[key],
  write: (values, value) => ({ ...values, [key]: Math.max(0, Math.round(value)) }),
});

const moneyMetric = (key: string, label: string, read: (values: Values) => number, write: (values: Values, value: number) => Values, tone?: "bad" | "ok"): Metric => ({
  key,
  label,
  kind: "money",
  tone,
  read,
  write,
});

function effective(values: Values) {
  return Math.max(0, values.dispatchCount - values.duplicateCount - values.lowAmountCount - values.noWsCount - values.manualInvalidCount);
}

function currentInGroup(values: Values) {
  return Math.max(0, values.joinCount - values.normalLeaveCount - values.abnormalLeaveCount);
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator * 100 : 0;
}

function firstDeposit(values: Values) {
  return values.cryptoInitialDepositCents + values.bankInitialDepositCents;
}

function recharge(values: Values) {
  return values.cryptoRechargeCents + values.bankRechargeCents;
}

function netPerformance(values: Values) {
  return firstDeposit(values) + recharge(values) - values.withdrawalCents;
}

const DAILY_METRICS: Metric[] = [
  numberMetric("dispatchCount", "添加数据"),
  numberMetric("duplicateCount", "撞粉", "bad"),
  numberMetric("lowAmountCount", "低金额", "bad"),
  numberMetric("noWsCount", "无 WS 号码", "bad"),
  numberMetric("manualInvalidCount", "人工无效", "bad"),
  { key: "effectiveCount", label: "有效数据", kind: "computed", tone: "ok", read: effective },
  numberMetric("replyCount", "回复"),
  { key: "replyRate", label: "回复率", kind: "rate", read: (values) => rate(values.replyCount, effective(values)) },
  numberMetric("joinCount", "进群"),
  { key: "joinRate", label: "进群率", kind: "rate", read: (values) => rate(values.joinCount, effective(values)) },
  numberMetric("normalLeaveCount", "正常退群", "bad"),
  numberMetric("abnormalLeaveCount", "异常退群", "bad"),
  { key: "abnormalLeaveRate", label: "异常退群率", kind: "rate", read: (values) => rate(values.abnormalLeaveCount, Math.max(0, values.joinCount - values.normalLeaveCount)) },
  { key: "currentInGroupCount", label: "当前在群", kind: "computed", tone: "ok", read: currentInGroup },
  numberMetric("expertIntroCount", "推专家"),
  numberMetric("registrationCount", "注册"),
  { key: "registrationRate", label: "注册率", kind: "rate", read: (values) => rate(values.registrationCount, values.expertIntroCount) },
  numberMetric("orderCount", "开单"),
  { key: "orderRate", label: "开单率", kind: "rate", read: (values) => rate(values.orderCount, values.registrationCount) },
  { key: "netPerformance", label: "净业绩", kind: "computedMoney", tone: "ok", read: netPerformance },
];

const FINANCE_METRICS: Metric[] = [
  moneyMetric("initialDeposit", "首充", firstDeposit, (values, value) => ({ ...values, cryptoInitialDepositCents: value, bankInitialDepositCents: 0 }), "ok"),
  moneyMetric("recharge", "续充", recharge, (values, value) => ({ ...values, cryptoRechargeCents: value, bankRechargeCents: 0 }), "ok"),
  moneyMetric("withdrawal", "出金", (values) => values.withdrawalCents, (values, value) => ({ ...values, withdrawalCents: value }), "bad"),
  { key: "netPerformance", label: "净业绩", kind: "computedMoney", tone: "ok", read: netPerformance },
];

function display(value: number, kind: Metric["kind"]) {
  if (kind === "rate") return `${value.toFixed(1)}%`;
  if (kind === "money" || kind === "computedMoney") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value / 100);
  }
  return Math.round(value).toLocaleString();
}

export function UnifiedMemberDataSheet({ mode, memberName }: { mode: Mode; memberName: string }) {
  const [context, setContext] = useState<Context | null>(null);
  const [date, setDate] = useState("");
  const [grid, setGrid] = useState<Record<string, ChannelState>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [savedAt, setSavedAt] = useState<string>("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const gridRef = useRef(grid);
  const editVersionRef = useRef<Record<string, number>>({});
  gridRef.current = grid;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await requestJson<Context>("/api/daily-stats");
      setContext(next);
      setDate((current) => current || next.today);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "数据读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!context || !date) return;
    const next: Record<string, ChannelState> = {};
    for (const channel of context.channels) {
      const entry = context.unifiedEntries.find((item) => item.businessDate === date && item.channel.id === channel.id) ?? null;
      next[channel.id] = {
        values: entry ? { ...EMPTY_VALUES, ...entry.values } : { ...EMPTY_VALUES },
        entryId: entry?.entryId ?? null,
        approved: entry?.status === "APPROVED",
      };
    }
    setGrid(next);
    setDirty(new Set());
    setSavedAt("");
    setError("");
    setReason("");
    editVersionRef.current = {};
  }, [context, date]);

  const metrics = mode === "finance" ? FINANCE_METRICS : DAILY_METRICS;
  const isHistorical = Boolean(context && date < context.today);

  function update(channelId: string, metric: Metric, rawValue: number) {
    if (!metric.write) return;
    const value = metric.kind === "money" ? Math.max(0, Math.round(rawValue * 100)) : rawValue;
    setGrid((current) => ({
      ...current,
      [channelId]: { ...current[channelId], values: metric.write!(current[channelId]?.values ?? EMPTY_VALUES, value) },
    }));
    setDirty((current) => new Set(current).add(channelId));
    editVersionRef.current[channelId] = (editVersionRef.current[channelId] ?? 0) + 1;
    setSavedAt("");
  }

  const saveChannel = useCallback(async (channelId: string) => {
    const current = gridRef.current[channelId];
    if (!current || !context) return;
    if (isHistorical && !reason.trim()) return;
    const savingVersion = editVersionRef.current[channelId] ?? 0;
    setSaving((items) => new Set(items).add(channelId));
    setError("");
    try {
      const values = {
        ...current.values,
        effectiveCount: effective(current.values),
        currentInGroupCount: currentInGroup(current.values),
      };
      const result = await requestJson<{ entry: Entry }>("/api/daily-stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(current.entryId ? { entryId: current.entryId } : {}),
          businessDate: date,
          position: "RECEPTION",
          channelId,
          sourceReceptionId: null,
          sourceGroupOperatorId: null,
          changeReason: isHistorical ? reason.trim() : null,
          values,
        }),
      });
      setGrid((items) => ({ ...items, [channelId]: { ...items[channelId], entryId: result.entry.id, approved: Boolean(result.entry.approvedRevision) } }));
      setDirty((items) => {
        if ((editVersionRef.current[channelId] ?? 0) !== savingVersion) return items;
        const next = new Set(items);
        next.delete(channelId);
        return next;
      });
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请稍后重试");
    } finally {
      setSaving((items) => { const next = new Set(items); next.delete(channelId); return next; });
    }
  }, [context, date, isHistorical, reason]);

  useEffect(() => {
    if (!dirty.size || isHistorical) return;
    const channelIds = [...dirty];
    const timer = window.setTimeout(() => { channelIds.forEach((channelId) => void saveChannel(channelId)); }, 850);
    return () => window.clearTimeout(timer);
  }, [dirty, isHistorical, saveChannel]);

  const totals = useMemo(() => {
    const aggregate = { ...EMPTY_VALUES };
    for (const channel of context?.channels ?? []) {
      const values = grid[channel.id]?.values ?? EMPTY_VALUES;
      for (const key of Object.keys(EMPTY_VALUES) as Array<keyof Values>) aggregate[key] += values[key];
    }
    return Object.fromEntries(metrics.map((metric) => [metric.key, metric.read(aggregate)]));
  }, [context, grid, metrics]);

  if (loading && !context) return <section className="card unified-sheet-loading">正在读取真实数据…</section>;
  if (!context) return <section className="card unified-sheet-loading unified-sheet-error">{error || "数据暂时不可用"}</section>;

  return <section className="unified-member-sheet">
    <div className="card unified-sheet-toolbar">
      <div>
        <strong>{mode === "finance" ? "我的财务填写" : "我的渠道数据"}</strong>
        <span>{mode === "finance" ? "按渠道填写首充、续充和出金" : "每个渠道单独填写；比例与绿色数据由系统计算"}</span>
      </div>
      <label><span>统计日期</span><input className="field" type="date" max={context.today} value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <span className="unified-save-state" data-state={error ? "error" : dirty.size || saving.size ? "saving" : "saved"}>
        {error ? "保存失败" : dirty.size || saving.size ? "正在自动保存…" : savedAt ? `${savedAt} 已保存` : "已同步"}
      </span>
    </div>

    {error ? <div className="notice" data-tone="bad" role="alert">{error}</div> : null}
    {isHistorical ? <div className="card unified-history-reason">
      <label><span>历史数据修改原因</span><input className="field" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：回复数少填 1 人" /></label>
      <button className="btn" data-variant="primary" disabled={!reason.trim() || !dirty.size || Boolean(saving.size)} onClick={() => [...dirty].forEach((channelId) => void saveChannel(channelId))}>保存历史修改</button>
    </div> : null}

    <div className="card unified-sheet-card">
      <header className="unified-sheet-title">
        <div><h2>{date} · {memberName}</h2><p>输入后自动保存，浅蓝框可填写，绿色格由系统自动计算</p></div>
        <div><span>{context.channels.length} 个渠道</span><strong>{mode === "finance" ? "金额单位：USD" : "本人数据"}</strong></div>
      </header>
      <div className="unified-sheet-scroll">
        <table className="unified-sheet-table">
          <thead><tr><th>数据指标</th><th>我的总计</th>{context.channels.map((channel) => <th key={channel.id}>{channel.name}<small>{channel.channelType}</small></th>)}</tr></thead>
          <tbody>{metrics.map((metric) => <tr key={metric.key} data-tone={metric.tone}>
            <th>{metric.label}{metric.kind === "rate" || metric.kind === "computed" || metric.kind === "computedMoney" ? <small>系统计算</small> : null}</th>
            <td className="unified-sheet-total">{display(totals[metric.key] ?? 0, metric.kind)}</td>
            {context.channels.map((channel) => {
              const values = grid[channel.id]?.values ?? EMPTY_VALUES;
              const value = metric.read(values);
              const editable = Boolean(metric.write);
              return <td key={channel.id} data-formula={!editable}>
                {editable ? <input aria-label={`${channel.name}-${metric.label}`} type="number" min="0" step={metric.kind === "money" ? "0.01" : "1"} value={metric.kind === "money" ? (value / 100).toFixed(2) : Math.round(value)} onChange={(event) => update(channel.id, metric, Number(event.target.value || 0))} /> : <span>{display(value, metric.kind)}</span>}
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <footer>
        <span>切换到没有填写过的日期时，所有数字从 0 开始</span>
        <span>{mode === "finance" ? "净业绩＝首充＋续充－出金" : "有效数据＝添加数据－撞粉－低金额－无 WS－人工无效"}</span>
      </footer>
    </div>
  </section>;
}
