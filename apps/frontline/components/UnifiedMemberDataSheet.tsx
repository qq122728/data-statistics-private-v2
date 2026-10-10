"use client";

import MonthDaySelect from "../../../packages/customer-sheet/MonthDaySelect";
import { inGroupDelta } from "../../../packages/customer-sheet/in-group";
import DailyNumberInput from "./DailyNumberInput";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestJson } from "@/lib/backend";

type Values = {
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

type Entry = {
  id: string;
  businessDate: string;
  position: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  status: string;
  channel: { id: string; name: string };
  currentRevision: (Values & { id: string; changeReason: string | null }) | null;
  approvedRevision: Values | null;
};

type Context = {
  actorId: string;
  numberStockBaseline?: Record<string,number> | null;
  groupType: "HACKER" | "LAWYER";
  today: string;
  timezone: string;
  rolloverHour: number;
  rolloverLabel: string;
  channels: Array<{ id: string; name: string; channelType: string }>;
  entries: Entry[];
  unifiedEntries: Array<{
    entryId: string | null;
    revisionId: string | null;
    sourceMode?: string;
    businessDate: string;
    channel: { id: string; name: string };
    status: string;
    values: Values;
  }>;
};

type Mode = "daily" | "finance";
type ChannelState = { sourceMode?:string; values: Values; entryId: string | null; revisionId: string | null; approved: boolean };

const EMPTY_VALUES: Values = {
  dispatchCount: 0,
  duplicateCount: 0,
  lowAmountCount: 0,
  noWsCount: 0,
  manualInvalidCount: 0,
  lawyerRealCaseCount: 0,
  lawyerAddedCount: 0,
  lawyerExpertAddedCount: 0,
  customerServicePushCount: 0,
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
  return values.dispatchCount - values.duplicateCount - values.lowAmountCount - values.noWsCount - values.manualInvalidCount;
}

function rate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator * 100 : Number.NaN;
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

function cryptoDeposits(values: Values) {
  return values.cryptoInitialDepositCents + values.cryptoRechargeCents;
}

function bankDeposits(values: Values) {
  return values.bankInitialDepositCents + values.bankRechargeCents;
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
  {key:"currentInGroupCount",label:"当前在群",kind:"computed",read:v=>v.currentInGroupCount},
  numberMetric("expertIntroCount", "推专家"),
  numberMetric("registrationCount", "注册"),
  { key: "registrationRate", label: "注册率", kind: "rate", read: (values) => rate(values.registrationCount, values.expertIntroCount) },
  numberMetric("orderCount", "开单"),
  { key: "orderRate", label: "开单率", kind: "rate", read: (values) => rate(values.orderCount, values.registrationCount) },
  { key: "netPerformance", label: "净业绩", kind: "computedMoney", tone: "ok", read: netPerformance },
];

const LAWYER_DAILY_METRICS: Metric[] = [
  numberMetric("dispatchCount", "接粉"),
  numberMetric("replyCount", "回复"),
  { key: "unrepliedCount", label: "未回复", kind: "computed", read: (values) => Math.max(0, values.dispatchCount - values.replyCount) },
  numberMetric("lowAmountCount", "接粉小金额", "bad"),
  numberMetric("lawyerRealCaseCount", "接粉真实案件", "ok"),
  { key: "lawyerReplyRate", label: "回复率", kind: "rate", read: (values) => rate(values.replyCount, values.dispatchCount) },
  numberMetric("lawyerAddedCount", "添加律师"),
  numberMetric("lawyerExpertAddedCount", "添加专家"),
  { key: "lawyerAddedRate", label: "添加律师率", kind: "rate", read: (values) => rate(values.lawyerAddedCount, values.dispatchCount) },
  { key: "lawyerExpertAddedRate", label: "添加专家率", kind: "rate", read: (values) => rate(values.lawyerExpertAddedCount, values.dispatchCount) },
  numberMetric("customerServicePushCount", "总推客服数量"),
  numberMetric("registrationCount", "总注册数量"),
  numberMetric("orderCount", "总开单数量"),
  moneyMetric("cryptoDeposits", "加密货币充值金额", cryptoDeposits, (values, value) => ({ ...values, cryptoInitialDepositCents: value, cryptoRechargeCents: 0 }), "ok"),
  moneyMetric("bankDeposits", "银行卡充值金额", bankDeposits, (values, value) => ({ ...values, bankInitialDepositCents: value, bankRechargeCents: 0 }), "ok"),
  moneyMetric("lawyerWithdrawal", "出金金额", (values) => values.withdrawalCents, (values, value) => ({ ...values, withdrawalCents: value }), "bad"),
];

const FINANCE_METRICS: Metric[] = [
  moneyMetric("bankFirst", "首充 · 银行卡", v=>v.bankInitialDepositCents, (v,n)=>({...v,bankInitialDepositCents:n})),
  moneyMetric("cryptoFirst", "首充 · 加密货币", v=>v.cryptoInitialDepositCents, (v,n)=>({...v,cryptoInitialDepositCents:n})),
  moneyMetric("bankRecharge", "续充 · 银行卡", v=>v.bankRechargeCents, (v,n)=>({...v,bankRechargeCents:n})),
  moneyMetric("cryptoRecharge", "续充 · 加密货币", v=>v.cryptoRechargeCents, (v,n)=>({...v,cryptoRechargeCents:n})),
  moneyMetric("withdrawal", "出金", (values) => values.withdrawalCents, (values, value) => ({ ...values, withdrawalCents: value }), "bad"),
  { key: "netPerformance", label: "净业绩", kind: "computedMoney", tone: "ok", read: netPerformance },
];


function display(value: number, kind: Metric["kind"]) {
  if (!Number.isFinite(value)) return "—";
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
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const gridRef = useRef(grid);
  const dirtyRef = useRef(dirty);
  const savingRef = useRef(saving);
  const typingRef = useRef(false);
  const recentEntries=useRef(new Map<string,Context["unifiedEntries"][number]>());
  useEffect(()=>{recentEntries.current.clear();},[context]);
  function dailyEntries(){const entries=new Map((context?.unifiedEntries??[]).map(e=>[`${e.businessDate}:${e.channel.id}`,e]));for(const [key,value] of recentEntries.current)entries.set(key,value);return [...entries.values()];}
  const [ratesOpen,setRatesOpen]=useState(true);
  const editVersionRef = useRef<Record<string, number>>({});
  gridRef.current = grid;
  dirtyRef.current = dirty;
  savingRef.current = saving;

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

  const refresh = useCallback(async () => {
    if (dirtyRef.current.size || savingRef.current.size || typingRef.current) return;
    setRefreshing(true);
    try {
      const next = await requestJson<Context>("/api/daily-stats");
      setContext(next);
      setDate((current) => !current || current > next.today ? next.today : current);
    } catch {
      // 短暂网络错误不打断当前填写；下一轮会自动重试。
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const handleDataUpdated = () => { void refresh(); };
    const handleFocus = () => { void refresh(); };
    const handleVisibility = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("ai-data-updated", handleDataUpdated);

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("ai-data-updated", handleDataUpdated);

      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!context || !date) return;
    const next: Record<string, ChannelState> = {};
    for (const channel of context.channels) {
      const entry = dailyEntries().find((item) => item.businessDate === date && item.channel.id === channel.id) ?? null;
      next[channel.id] = {
        values: { ...(entry ? { ...EMPTY_VALUES, ...entry.values } : { ...EMPTY_VALUES }), currentInGroupCount:context.groupType==="HACKER"
          ? (dailyEntries().filter(e=>e.channel.id===channel.id&&e.businessDate<=date&&(date<"2026-09-01"||e.businessDate>="2026-09-01")).sort((a,b)=>b.businessDate.localeCompare(a.businessDate))[0]?.values.currentInGroupCount ?? (date>="2026-09-01"?context.numberStockBaseline?.[channel.id]??0:0))
          : dailyEntries().filter(e=>e.channel.id===channel.id&&e.businessDate<date).reduce((n,e)=>n+inGroupDelta(e.values),0)+inGroupDelta(entry?.values??EMPTY_VALUES) },
        sourceMode:entry?.sourceMode,
        entryId: entry?.entryId ?? null,
        revisionId: entry?.revisionId ?? null,
        approved: entry?.status === "APPROVED",
      };
    }
    setGrid(next);
    setDirty(new Set());
    setSavedAt("");
    setError("");
    editVersionRef.current = {};
  }, [context, date]);

  const lawyerGroup = context?.groupType === "LAWYER";
  const metrics = [...(lawyerGroup ? LAWYER_DAILY_METRICS.filter((m) => !["cryptoDeposits", "bankDeposits", "lawyerWithdrawal"].includes(m.key)) : DAILY_METRICS.filter((m) => m.key !== "netPerformance")), ...FINANCE_METRICS];

  function update(channelId: string, metric: Metric, rawValue: number) {
    if (!lawyerGroup || !metric.write || grid[channelId]?.sourceMode==="NUMBER") return;
    const value = metric.kind === "money" ? Math.max(0, Math.round(rawValue * 100)) : rawValue;
    setGrid((current) => {
      const values=metric.write!(current[channelId]?.values??EMPTY_VALUES,value);
      values.currentInGroupCount=dailyEntries().filter(e=>e.channel.id===channelId&&e.businessDate<date).reduce((n,e)=>n+inGroupDelta(e.values),0)+inGroupDelta(values);
      return {...current,[channelId]:{...current[channelId],values}};
    });
    setDirty((current) => new Set(current).add(channelId));
    editVersionRef.current[channelId] = (editVersionRef.current[channelId] ?? 0) + 1;
    setSavedAt("");setError("");
  }

  const saveChannel = useCallback(async (channelId: string) => {
    const current = gridRef.current[channelId];
    if (!current || !context || context.groupType!=="LAWYER") return;
    if (savingRef.current.has(channelId)) return;
    savingRef.current = new Set(savingRef.current).add(channelId);
    const savingVersion = editVersionRef.current[channelId] ?? 0;
    setSaving((items) => new Set(items).add(channelId));
    setError("");
    try {
      const values = {
        ...current.values,
        effectiveCount: effective(current.values),
        currentInGroupCount: 0,
      };
      const result = await requestJson<{ entry: Entry }>("/api/daily-stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(current.entryId ? { entryId: current.entryId } : {}),
          businessDate: date,
          expectedStatisticsDate: context.today,
          expectedRevisionId: current.revisionId,
          position: "RECEPTION",
          channelId,
          sourceReceptionId: null,
          sourceGroupOperatorId: null,
          changeReason: null,
          values,
        }),
      });
      if(result.entry.currentRevision)recentEntries.current.set(`${date}:${channelId}`,{entryId:result.entry.id,revisionId:result.entry.currentRevision.id,businessDate:date,channel:result.entry.channel,status:result.entry.status,values:result.entry.currentRevision});
      setGrid((items) => ({ ...items, [channelId]: { ...items[channelId], entryId: result.entry.id, revisionId: result.entry.currentRevision?.id ?? null, approved: Boolean(result.entry.approvedRevision) } }));
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
      savingRef.current = new Set([...savingRef.current].filter(id=>id!==channelId));
      setSaving((items) => { const next = new Set(items); next.delete(channelId); return next; });
    }
  }, [context, date]);

  useEffect(() => {
    if (!dirty.size || error) return;
    const channelIds = [...dirty].filter(id=>!saving.has(id));
    const timer = window.setTimeout(() => { channelIds.forEach((channelId) => void saveChannel(channelId)); }, 850);
    return () => window.clearTimeout(timer);
  }, [dirty, saving, error, saveChannel]);

  const totals = useMemo(() => {
    const aggregate = { ...EMPTY_VALUES };
    for (const channel of context?.channels ?? []) {
      const values = grid[channel.id]?.values ?? EMPTY_VALUES;
      for (const key of Object.keys(EMPTY_VALUES) as Array<keyof Values>) aggregate[key] += values[key];
    }
    return Object.fromEntries(metrics.map((metric) => [metric.key, metric.read(aggregate)]));
  }, [context, grid, metrics]);

  const ratios=metrics.filter(m=>m.kind==="rate");
  const entryMetrics=metrics.filter(m=>m.kind!=="rate");
  const acquisition=new Set(lawyerGroup?["dispatchCount","replyCount","unrepliedCount","lowAmountCount","lawyerRealCaseCount"]:["dispatchCount","duplicateCount","lowAmountCount","noWsCount","manualInvalidCount","effectiveCount"]);
  const sections=[
    {name:lawyerGroup?"添加与案件数据":"添加与有效数据",items:entryMetrics.filter(m=>acquisition.has(m.key))},
    {name:"客户跟进",items:entryMetrics.filter(m=>!acquisition.has(m.key)&&!["money","computedMoney"].includes(m.kind))},
    {name:"资金数据 · USD",items:entryMetrics.filter(m=>["money","computedMoney"].includes(m.kind))},
  ];
  const yesterday=context?new Date(Date.parse(context.today+"T00:00:00Z")-86400000).toISOString().slice(0,10):"";
  if (loading && !context) return <section className="card unified-sheet-loading">正在读取真实数据…</section>;
  if (!context) return <section className="card unified-sheet-loading unified-sheet-error">{error || "数据暂时不可用"}</section>;

  return <section className="unified-member-sheet">
    <div className="card unified-sheet-toolbar">
      <div>
        <strong>{mode === "finance" ? "我的财务填写" : lawyerGroup ? "我的律师组渠道数据" : "我的渠道数据"}</strong>
        <span>{memberName} · {context.channels.length} 个渠道</span>
      </div>
      <details className="unified-help"><summary>{lawyerGroup?"填写说明":"统计说明"}</summary><div>{lawyerGroup?"按日期和渠道填写数量、金额，修改后自动保存。比率与灰底格自动计算。":"黑客组所有渠道均按客户号码和资金流水统计，不能手填数量或金额。添加按接粉日期，后续动作按发生日期计入；待进群只是全部客户的一部分。"}当前在群＝截至所选日期累计进群－累计正常退群－累计异常退群。发现差异请核对对应日期的原始记录。</div></details>
      <label><span>统计日期（北京时间 14:00 换日）</span><MonthDaySelect label="统计日期" max={context.today} value={date} onChange={setDate} clearable={false} disabled={Boolean(dirty.size||saving.size)}/></label>
      <button className="btn" data-size="sm" disabled={Boolean(dirty.size||saving.size)} onClick={()=>setDate(context.today)}>今天</button>
      <button className="btn" data-size="sm" disabled={Boolean(dirty.size||saving.size)} onClick={()=>setDate(yesterday)}>昨天</button>
      <button className="btn" data-size="sm" type="button" disabled={refreshing || Boolean(dirty.size) || Boolean(saving.size)} onClick={() => void refresh()}>{refreshing ? "同步中…" : "刷新进度"}</button>
      <span className="unified-save-state" data-state={error ? "error" : dirty.size || saving.size ? "saving" : "saved"}>
        {error ? "保存失败" : dirty.size || saving.size ? "正在自动保存…" : savedAt ? `${savedAt} 已保存` : "已同步"}
      </span>
    </div>

    {error ? <div className="notice" data-tone="bad" role="alert">{error}<button className="btn" onClick={()=>setError("")}>重试保存</button></div> : null}



    <div className="card unified-sheet-card unified-transposed-card">
      <div className="daily-rates-heading"><strong>渠道比率 <span>自动计算 · {context.channels.length} 个渠道</span></strong><button type="button" aria-expanded={ratesOpen} aria-controls="daily-channel-rates" onClick={()=>setRatesOpen(open=>!open)}>{ratesOpen ? "收起比率" : "展开比率"}</button></div>
      {ratesOpen ? <div id="daily-channel-rates" className="daily-rates-scroll">
        <table className="daily-rates-table" aria-label="各渠道比率"><thead><tr><th scope="col">渠道</th>{ratios.map(metric=><th scope="col" key={metric.key}>{metric.label}</th>)}</tr></thead><tbody>
          <tr className="daily-rates-total"><th scope="row">我的总计</th>{ratios.map(metric=><td key={metric.key}>{display(totals[metric.key],metric.kind)}</td>)}</tr>
          {context.channels.map(channel=><tr key={channel.id}><th scope="row">{channel.name}<small>{channel.channelType}{context.groupType==="LAWYER"?" · 手填日报":grid[channel.id]?.sourceMode==="MANUAL"?" · 历史手填（只读）":" · 号码自动统计"}</small></th>{ratios.map(metric=><td key={metric.key}>{display(metric.read(grid[channel.id]?.values??EMPTY_VALUES),metric.kind)}</td>)}</tr>)}
        </tbody></table>
      </div> : null}
      <div className="unified-sheet-scroll unified-entry-scroll">
        <table className="unified-sheet-table" aria-label={lawyerGroup?"数量和金额填写":"数量和金额汇总（只读）"}>
          <thead><tr><th>数据指标</th><th>我的总计</th>{context.channels.map((channel) => <th key={channel.id}>{channel.name}<small>{channel.channelType}{context.groupType==="LAWYER"?" · 手填日报":grid[channel.id]?.sourceMode==="MANUAL"?" · 历史手填（只读）":" · 号码自动统计"}</small></th>)}</tr></thead>
          <tbody>{sections.map(section=><Fragment key={section.name}><tr className="unified-section-row"><th colSpan={context.channels.length+2}>{section.name}</th></tr>{section.items.map((metric) => <tr key={metric.key} data-tone={metric.tone}>
            <th>{metric.label}{metric.kind === "rate" || metric.kind === "computed" || metric.kind === "computedMoney" ? <small>系统计算</small> : null}</th>
            <td className="unified-sheet-total">{display(totals[metric.key] ?? 0, metric.kind)}</td>
            {context.channels.map((channel) => {
              const values = grid[channel.id]?.values ?? EMPTY_VALUES;
              const value = metric.read(values);
              const editable = lawyerGroup && Boolean(metric.write) && grid[channel.id]?.sourceMode!=="NUMBER";
              return <td key={channel.id} data-formula={!editable}>
                {editable ? <DailyNumberInput key={`${date}-${channel.id}-${metric.key}`} label={`${channel.name}-${metric.label}`} money={metric.kind === "money"} value={metric.kind === "money" ? value / 100 : value} onChange={(next) => update(channel.id, metric, next)} onEditing={active=>{typingRef.current=active;}} /> : <span>{display(value, metric.kind)}</span>}
              </td>;
            })}
          </tr>)}</Fragment>)}</tbody>
        </table>
      </div>
      <footer>
        <span>{context.groupType==="LAWYER"?"律师组数量和金额手动填写，编辑后自动保存；客户记录不覆盖日报":"黑客组所有渠道只读，数量和资金按号码明细自动统计；历史手填记录保留"}</span>
        <span>{mode === "finance" ? "公司认账净业绩＝首充＋续充－出金" : lawyerGroup ? "未回复＝接粉－回复；添加率＝添加数量÷接粉" : "有效数据＝添加数据－撞粉－低金额－无 WS－人工无效"}</span>
      </footer>
    </div>
  </section>;
}
