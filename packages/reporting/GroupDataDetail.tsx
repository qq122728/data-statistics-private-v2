"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./GroupDataDetail.module.css";
import type { RealMetrics } from "./RealMetricsTable";

type Business = "HACKER" | "LAWYER";
type ViewMode = "groups" | "members" | "channels";
type DateMode = "today" | "3d" | "7d" | "month" | "lastMonth" | "custom";
type MetricsRow = { id: string; name: string; groupId?: string; groupName?: string; groupType?: Business; totals: RealMetrics };
type Group = MetricsRow & { groupType: Business; department: { id: string; name: string }; company: { id: string; name: string } | null };
type Member = MetricsRow & { groupId: string; groupName: string; groupType: Business };
type GroupChannel = MetricsRow & { groupId: string; groupName: string; groupType: Business; channel: { name: string } };
type DailyDetail = { date: string; groupId: string; groupName: string; groupType: Business; member: { id: string; name: string }; channel: { id: string; name: string }; totals: RealMetrics };
type Payload = { range: { label: string; from: string; to: string }; groups: Group[]; members: Member[]; groupChannels: GroupChannel[]; dailyDetails?: DailyDetail[] };
type Metric = { key: keyof RealMetrics | "replyRate" | "groupRate" | "expertRate" | "registerRate" | "orderRate"; label: string; money?: boolean; rate?: boolean };

const hackerMetrics: Metric[] = [
  { key: "added", label: "添加" }, { key: "collision", label: "撞粉" }, { key: "lowAmount", label: "低金额" },
  { key: "noWs", label: "无WS号码" }, { key: "manualInvalid", label: "人工无效" }, { key: "effective", label: "有效" },
  { key: "replied", label: "回复" }, { key: "replyRate", label: "回复率", rate: true }, { key: "joined", label: "进群" },
  { key: "groupRate", label: "进群率", rate: true }, { key: "leftNormal", label: "正常退群" }, { key: "leftAbnormal", label: "异常退群" },
  { key: "inGroup", label: "当前在群" }, { key: "pushed", label: "推专家" }, { key: "expertRate", label: "推专家率", rate: true },
  { key: "registered", label: "注册" }, { key: "registerRate", label: "注册率", rate: true }, { key: "ordered", label: "开单" },
  { key: "orderRate", label: "开单率", rate: true }, { key: "initialDepositCents", label: "首充", money: true },
  { key: "rechargeCents", label: "续充", money: true }, { key: "withdrawalCents", label: "出金", money: true }, { key: "netCents", label: "净业绩", money: true },
];
const lawyerMetrics: Metric[] = [
  { key: "added", label: "接粉" }, { key: "replied", label: "回复" }, { key: "replyRate", label: "回复率", rate: true },
  { key: "lowAmount", label: "接粉小金额" }, { key: "lawyerRealCase", label: "真实案件" }, { key: "lawyerAdded", label: "添加律师" },
  { key: "groupRate", label: "添加律师率", rate: true }, { key: "lawyerExpertAdded", label: "添加专家" },
  { key: "expertRate", label: "添加专家率", rate: true }, { key: "customerServicePush", label: "推客服" },
  { key: "registered", label: "注册" }, { key: "registerRate", label: "注册率", rate: true }, { key: "ordered", label: "开单" },
  { key: "orderRate", label: "开单率", rate: true }, { key: "initialDepositCents", label: "首充", money: true },
  { key: "rechargeCents", label: "续充", money: true }, { key: "withdrawalCents", label: "出金", money: true }, { key: "netCents", label: "净业绩", money: true },
];
const today = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const month = () => today().slice(0, 7);
const shift = (value: string, days: number) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
const number = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
const ratio = (top: number, bottom: number) => bottom > 0 ? top / bottom : null;

function metricValue(row: Pick<MetricsRow, "totals">, metric: Metric, business: Business): number | null {
  const value = row.totals;
  if (metric.key === "replyRate") return ratio(value.replied, business === "HACKER" ? value.effective : value.added);
  if (metric.key === "groupRate") return ratio(business === "HACKER" ? value.joined : value.lawyerAdded ?? 0, business === "HACKER" ? value.effective : value.added);
  if (metric.key === "expertRate") return ratio(business === "HACKER" ? value.pushed : value.lawyerExpertAdded ?? 0, business === "HACKER" ? value.joined : value.lawyerAdded ?? 0);
  if (metric.key === "registerRate") return ratio(value.registered, business === "HACKER" ? value.pushed : value.lawyerExpertAdded ?? 0);
  if (metric.key === "orderRate") return ratio(value.ordered, value.registered);
  return Number(value[metric.key] ?? 0);
}
function formatMetric(row: Pick<MetricsRow, "totals">, metric: Metric, business: Business) {
  const value = metricValue(row, metric, business);
  if (value == null) return "—";
  if (metric.rate) return `${(value * 100).toFixed(1)}%`;
  return metric.money ? money(value) : number(value);
}
function sumRows(rows: MetricsRow[]): RealMetrics {
  const result = {
    added: 0, collision: 0, lowAmount: 0, noWs: 0, manualInvalid: 0, effective: 0,
    replied: 0, joined: 0, leftNormal: 0, leftAbnormal: 0, inGroup: 0, pushed: 0,
    registered: 0, ordered: 0, depositCents: 0, initialDepositCents: 0,
    rechargeCents: 0, withdrawalCents: 0, netCents: 0,
    lawyerRealCase: 0, lawyerAdded: 0, lawyerExpertAdded: 0, customerServicePush: 0,
  } as RealMetrics;
  for (const row of rows) for (const key of Object.keys(result) as Array<keyof RealMetrics>) result[key] = Number(result[key] ?? 0) + Number(row.totals[key] ?? 0);
  return result;
}

export function GroupDataDetail({ permissionLabel, finance = false }: { permissionLabel: string; finance?: boolean }) {
  const [business, setBusiness] = useState<Business>("HACKER");
  const [dateMode, setDateMode] = useState<DateMode>("month");
  const [selectedMonth, setSelectedMonth] = useState(month);
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [companyId, setCompanyId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [mode, setMode] = useState<ViewMode>("groups");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [detail, setDetail] = useState<{ row: MetricsRow; metric: Metric } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  function currentParams(includeDailyDetails = false) {
    const params = new URLSearchParams();
    if (includeDailyDetails) params.set("dailyDetails", "1");
    if (dateMode === "month") params.set("month", selectedMonth);
    else if (dateMode === "today") params.set("range", "today");
    else if (dateMode === "7d") params.set("range", "7d");
    else if (dateMode === "lastMonth") params.set("range", "lastMonth");
    else {
      const from = dateMode === "3d" ? shift(today(), -2) : customFrom;
      const to = dateMode === "3d" ? today() : customTo;
      params.set("range", "custom"); params.set("sourceDateFrom", from); params.set("sourceDateTo", to);
    }
    return params;
  }

  useEffect(() => {
    const controller = new AbortController();
    const params = currentParams();
    setDetail(null);
    setLoading(true); setError("");
    void fetch(`/api/org/reporting?${params}`, { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "读取小组明细失败"); return body as Payload; })
      .then(setData).catch(caught => { if (caught instanceof Error && caught.name !== "AbortError") setError(caught.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [customFrom, customTo, dateMode, reload, selectedMonth]);

  const typedGroups = useMemo(() => (data?.groups ?? []).filter(row => row.groupType === business), [business, data]);
  const companies = useMemo(() => [...new Map(typedGroups.filter(row => row.company).map(row => [row.company!.id, row.company!.name])).entries()], [typedGroups]);
  const departments = useMemo(() => [...new Map(typedGroups.filter(row => !companyId || row.company?.id === companyId).map(row => [row.department.id, row.department.name])).entries()], [companyId, typedGroups]);
  const visibleGroups = useMemo(() => typedGroups.filter(row => (!companyId || row.company?.id === companyId) && (!departmentId || row.department.id === departmentId) && (!groupId || row.id === groupId)), [companyId, departmentId, groupId, typedGroups]);
  const selectedGroup = typedGroups.find(row => row.id === groupId) ?? null;
  const members = useMemo(() => (data?.members ?? []).filter(row => row.groupType === business && (!groupId || row.groupId === groupId)), [business, data, groupId]);
  const channels = useMemo(() => (data?.groupChannels ?? []).filter(row => row.groupType === business && (!groupId || row.groupId === groupId)).map(row => ({ ...row, name: row.channel.name })), [business, data, groupId]);
  const rows: MetricsRow[] = mode === "groups" ? visibleGroups : mode === "members" ? members : channels;
  const metrics = business === "HACKER" ? hackerMetrics : lawyerMetrics;
  const totalRow: MetricsRow = { id: "__total__", name: mode === "groups" ? "当前范围合计" : "小组合计", totals: sumRows(rows) };

  function chooseGroup(id: string, nextMode: ViewMode = "members") { setGroupId(id); setMode(nextMode); setDetail(null); }
  function changeMode(next: ViewMode) { if (next !== "groups" && !groupId) setGroupId(visibleGroups[0]?.id ?? typedGroups[0]?.id ?? ""); setMode(next); setDetail(null); }
  function openDetail(row: MetricsRow, metric: Metric) {
    setDetail({ row, metric });
    if (!data || data.dailyDetails) return;
    const expectedFrom = data.range.from;
    const expectedTo = data.range.to;
    setDetailLoading(true);
    void fetch(`/api/org/reporting?${currentParams(true)}`, { credentials: "include", cache: "no-store" })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "读取组成明细失败"); return body as Payload; })
      .then(body => setData(current => current && current.range.from === expectedFrom && current.range.to === expectedTo ? { ...current, dailyDetails: body.dailyDetails ?? [] } : current))
      .catch(caught => setError(caught instanceof Error ? caught.message : "读取组成明细失败"))
      .finally(() => setDetailLoading(false));
  }
  const detailRows = useMemo(() => {
    if (!detail) return [];
    const isTotal = detail.row.id === "__total__";
    const visibleGroupIds = new Set(visibleGroups.map(row => row.id));
    return (data?.dailyDetails ?? []).filter(row => row.groupType === business
      && (mode === "groups" ? (isTotal ? visibleGroupIds.has(row.groupId) : row.groupId === detail.row.id) : row.groupId === groupId)
      && (mode !== "members" || isTotal || row.member.id === detail.row.id)
      && (mode !== "channels" || isTotal || row.channel.name === detail.row.name));
  }, [business, data, detail, groupId, mode, visibleGroups]);

  return <div className={styles.page}>
    <section className={styles.toolbar}>
      <div className={styles.quick}>{([['today','今天'],['3d','近3天'],['7d','近7天'],['month','本月'],['lastMonth','上月'],['custom','自定义']] as Array<[DateMode,string]>).map(([key,label]) => <button key={key} aria-pressed={dateMode === key} onClick={() => setDateMode(key)}>{label}</button>)}</div>
      <label>统计月份<input type="month" value={selectedMonth} disabled={dateMode !== "month"} onChange={event => setSelectedMonth(event.target.value)} /></label>
      {dateMode === "custom" ? <><label>开始日期<input type="date" value={customFrom} onChange={event => setCustomFrom(event.target.value)} /></label><label>结束日期<input type="date" value={customTo} onChange={event => setCustomTo(event.target.value)} /></label></> : null}
      <label>公司<select value={companyId} onChange={event => { setCompanyId(event.target.value); setDepartmentId(""); setGroupId(""); setMode("groups"); }}><option value="">全部公司</option>{companies.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>部门<select value={departmentId} onChange={event => { setDepartmentId(event.target.value); setGroupId(""); setMode("groups"); }}><option value="">全部部门</option>{departments.map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>小组<select value={groupId} onChange={event => { setGroupId(event.target.value); if (!event.target.value) setMode("groups"); }}><option value="">全部小组</option>{typedGroups.filter(row => (!companyId || row.company?.id === companyId) && (!departmentId || row.department.id === departmentId)).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <div className={styles.business}><button aria-pressed={business === "HACKER"} onClick={() => { setBusiness("HACKER"); setGroupId(""); setMode("groups"); }}>黑客组</button><button aria-pressed={business === "LAWYER"} onClick={() => { setBusiness("LAWYER"); setGroupId(""); setMode("groups"); }}>律师组</button></div>
      <button className={styles.refresh} onClick={() => setReload(value => value + 1)}>刷新数据</button>
      <p><strong>{data?.range.label ?? "当前区间"}</strong> · {permissionLabel} · 数量和资金按实际发生日期汇总</p>
    </section>

    <section className={styles.sheet}>
      <div className={styles.tabs} role="tablist" aria-label="数据查看方式">
        <button role="tab" aria-selected={mode === "groups"} onClick={() => changeMode("groups")}>小组汇总</button>
        <button role="tab" aria-selected={mode === "members"} onClick={() => changeMode("members")}>组员明细</button>
        <button role="tab" aria-selected={mode === "channels"} onClick={() => changeMode("channels")}>渠道明细</button>
        <span>{selectedGroup ? `${selectedGroup.department.name} / ${selectedGroup.name}` : `${visibleGroups.length} 个小组`}</span>
      </div>
      {finance ? <div className={styles.readOnly}>财务只读：可核对完整指标及其日期、组员、渠道组成，不能进入客户资料或修改业务数据。</div> : null}
      {loading ? <div className={styles.state}>正在读取小组数据…</div> : error ? <div className={styles.state} data-error>{error}<button onClick={() => setReload(value => value + 1)}>重试</button></div> : <>
        {mode !== "groups" && !groupId ? <div className={styles.state}>请先选择一个小组</div> : <div className={styles.tableWrap}><table><thead><tr><th>{mode === "groups" ? "部门 / 小组" : mode === "members" ? "组员" : "渠道"}</th>{metrics.map(metric => <th key={metric.key}>{metric.label}</th>)}<th>查看</th></tr></thead><tbody>
          <DataRow row={totalRow} metrics={metrics} business={business} total onDetail={(metric) => openDetail(totalRow, metric)} />
          {rows.map(row => <DataRow key={row.id} row={row} metrics={metrics} business={business} sub={mode === "groups" ? `${(row as Group).department.name} / ${row.name}` : row.name} onDetail={metric => openDetail(row, metric)} action={mode === "groups" ? <button className={styles.link} onClick={() => chooseGroup(row.id)}>展开</button> : null} />)}
          {!rows.length ? <tr><td colSpan={metrics.length + 2} className={styles.empty}>当前范围暂无数据</td></tr> : null}
        </tbody></table></div>}
        <div className={styles.foot}><span>完整指标 {metrics.length} 项 · 点击蓝色数字查看按日期、组员和渠道组成</span><span>{rows.length} 行</span></div>
      </>}
    </section>
    {detail ? <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) setDetail(null); }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label={`${detail.metric.label}组成明细`}>
      <header><div><h2>{detail.row.name} · {detail.metric.label}</h2><p>{data?.range.from} 至 {data?.range.to} · 汇总值 {formatMetric(detail.row, detail.metric, business)}</p></div><button aria-label="关闭" onClick={() => setDetail(null)}>关闭</button></header>
      <div className={styles.detailTable}><table><thead><tr><th>日期</th><th>组员</th><th>渠道</th><th>{detail.metric.label}</th></tr></thead><tbody>{detailRows.map((row,index) => <tr key={`${row.date}-${row.member.id}-${row.channel.id}-${index}`}><td>{row.date}</td><td>{row.member.name}</td><td>{row.channel.name}</td><td>{formatMetric(row, detail.metric, business)}</td></tr>)}{detailLoading ? <tr><td colSpan={4} className={styles.empty}>正在读取组成明细…</td></tr> : !detailRows.length ? <tr><td colSpan={4} className={styles.empty}>当前指标没有可展开的日数据</td></tr> : null}</tbody></table></div>
      <footer><span>只读组成明细，不显示客户号码</span><button onClick={() => setDetail(null)}>关闭</button></footer>
    </section></div> : null}
  </div>;
}

function DataRow({ row, metrics, business, total = false, sub, onDetail, action }: { row: MetricsRow; metrics: Metric[]; business: Business; total?: boolean; sub?: string; onDetail: (metric: Metric) => void; action?: React.ReactNode }) {
  return <tr data-total={total || undefined}><th>{sub ?? row.name}</th>{metrics.map(metric => <td key={metric.key}><button className={styles.value} onClick={() => onDetail(metric)}>{formatMetric(row, metric, business)}</button></td>)}<td>{action ?? "查看"}</td></tr>;
}
