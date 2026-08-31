"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { BackendUser } from "@/lib/backend";
import { requestJson } from "@/lib/backend";
import styles from "./ResourceWorkspace.module.css";
import standard from "./ResourceWorkspaceStandard.module.css";
import { UnifiedNotificationCenter } from "@/components/UnifiedNotificationCenter";
import { WorkspaceNavButton, WorkspaceNavGroup, WorkspaceShell, type WorkspaceIcon } from "@/components/WorkspaceShell";

export type ResourceWorkspaceProps = { user: BackendUser; onLogout: () => void };

type View = "dashboard" | "daily" | "summary" | "channels" | "usage" | "accounts" | "comparison" | "anomalies" | "notifications";
type SummaryMode = "channel" | "department" | "group" | "day";
type Totals = {
  added: number; collision: number; lowAmount: number; noWs: number; manualInvalid: number; effective: number;
  replied: number; joined: number; left: number; abnormalLeft: number; inGroup: number;
  pushed: number; registered: number; ordered: number; initialDepositCents: number; rechargeCents: number; depositCents: number; withdrawalCents: number;
};
type ReportRow = {
  channel: { id: string; name: string; normalizedName: string };
  group: { id: string; name: string; departmentId?: string; departmentName: string; companyId?: string | null; companyName?: string };
  period: { preset: string; from: string; to: string; today: string; timezone: string };
  totals: Totals;
};
type Reporting = {
  rows: ReportRow[];
  days: Array<{ date: string; rows: ReportRow[] }>;
  channels: Array<{ id: string; name: string; normalizedName: string }>;
  groups: Array<{ id: string; name: string; departmentId: string; departmentName: string; companyId: string | null; companyName: string }>;
  members: Array<{ id: string; name: string; role: string; groupId: string | null }>;
  memberRows: Array<{ date: string; channelId: string; groupId: string; member: { id: string; name: string; role: string }; totals: Totals }>;
};
type Channel = { id: string; name: string; active: boolean; channelType: "SMS" | "ADS" | "REBATE"; createdAt: string; creator?: { name: string } | null; groupCount: number; batchCount: number };
const emptyTotals = (): Totals => ({ added: 0, collision: 0, lowAmount: 0, noWs: 0, manualInvalid: 0, effective: 0, replied: 0, joined: 0, left: 0, abnormalLeft: 0, inGroup: 0, pushed: 0, registered: 0, ordered: 0, initialDepositCents: 0, rechargeCents: 0, depositCents: 0, withdrawalCents: 0 });
const sumTotals = (rows: Array<{ totals: Totals }>) => rows.reduce((sum, row) => {
  for (const key of Object.keys(sum) as Array<keyof Totals>) sum[key] += Number(row.totals[key] ?? 0);
  return sum;
}, emptyTotals());
const sumMemberTotals = (rows: Reporting["memberRows"]) => {
  const totals = sumTotals(rows);
  const latest = new Map<string, { date: string; inGroup: number }>();
  for (const row of rows) {
    const key = `${row.member.id}\u0000${row.channelId}\u0000${row.groupId}`;
    const current = latest.get(key);
    if (!current || row.date > current.date) latest.set(key, { date: row.date, inGroup: row.totals.inGroup });
  }
  totals.inGroup = [...latest.values()].reduce((sum, item) => sum + item.inGroup, 0);
  return totals;
};
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const rate = (top: number, bottom: number) => bottom > 0 ? `${(top / bottom * 100).toFixed(1)}%` : "—";
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const typeLabel = (type: Channel["channelType"]) => type === "SMS" ? "短信粉" : type === "ADS" ? "投流粉" : "底料返点";

export default function ResourceWorkspace({ user, onLogout }: ResourceWorkspaceProps) {
  const [view, setView] = useState<View>("dashboard");
  const [range, setRange] = useState("month");
  const [from, setFrom] = useState(() => `${localDate().slice(0, 8)}01`);
  const [to, setTo] = useState(localDate);
  const [channelId, setChannelId] = useState("");
  const [company, setCompany] = useState("");
  const [department, setDepartment] = useState("");
  const [groupId, setGroupId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [day, setDay] = useState("");
  const [summaryMode, setSummaryMode] = useState<SummaryMode>("channel");
  const [report, setReport] = useState<Reporting | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [channelSearch, setChannelSearch] = useState("");
  const [createChannel, setCreateChannel] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ range });
      if (range === "custom") { query.set("sourceDateFrom", from); query.set("sourceDateTo", to); }
      const [nextReport, channelPayload, notificationPayload] = await Promise.all([
        requestJson<Reporting>(`/api/resource/reporting?${query}`),
        requestJson<{ channels: Channel[] }>("/api/admin/channels"),
        requestJson<{ unread: number }>("/api/notifications"),
      ]);
      setReport(nextReport); setChannels(channelPayload.channels); setUnread(notificationPayload.unread);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "资源工作区读取失败"); }
    finally { setLoading(false); }
  }, [from, range, to]);
  useEffect(() => { void load(); }, [load]);

  const companies = useMemo(() => [...new Set((report?.groups ?? []).map((group) => group.companyName))].sort(), [report]);
  const departments = useMemo(() => [...new Set((report?.groups ?? []).filter((group) => !company || group.companyName === company).map((group) => group.departmentName))].sort(), [company, report]);
  const filterGroups = useMemo(() => (report?.groups ?? []).filter((group) => (!company || group.companyName === company) && (!department || group.departmentName === department)), [company, department, report]);
  const filterMembers = useMemo(() => (report?.members ?? []).filter((member) => !groupId || member.groupId === groupId), [groupId, report]);
  const visibleBaseRows = useMemo(() => (report?.rows ?? []).filter((row) =>
    (!channelId || row.channel.id === channelId) && (!company || row.group.companyName === company) && (!department || row.group.departmentName === department) && (!groupId || row.group.id === groupId)
  ), [channelId, company, department, groupId, report]);
  const visibleDailyRows = useMemo(() => (report?.days ?? []).flatMap((item) => item.rows.map((row) => ({ ...row, group: { ...(report?.groups.find((group) => group.id === row.group.id) ?? row.group), ...row.group }, displayDate: item.date }))).filter((row) =>
    (!day || row.displayDate === day) && (!channelId || row.channel.id === channelId) && (!company || row.group.companyName === company) && (!department || row.group.departmentName === department) && (!groupId || row.group.id === groupId)
  ), [channelId, company, day, department, groupId, report]);
  const totals = useMemo(() => sumTotals(visibleBaseRows), [visibleBaseRows]);
  const groupedRows = useMemo(() => {
    const buckets = new Map<string, { label: string; sub?: string; totals: Totals }>();
    if (summaryMode === "day") {
      for (const row of visibleDailyRows) {
        const existing = buckets.get(row.displayDate) ?? { label: row.displayDate, totals: emptyTotals() };
        existing.totals = sumTotals([{ totals: existing.totals }, row]);
        buckets.set(row.displayDate, existing);
      }
      return [...buckets.values()];
    }
    for (const row of visibleBaseRows) {
      const key = summaryMode === "channel" ? row.channel.id : summaryMode === "department" ? row.group.departmentName : row.group.id;
      const label = summaryMode === "channel" ? row.channel.name : summaryMode === "department" ? row.group.departmentName : row.group.name;
      const existing = buckets.get(key) ?? { label, sub: summaryMode === "group" ? row.group.departmentName : undefined, totals: emptyTotals() };
      existing.totals = sumTotals([{ totals: existing.totals }, row]);
      buckets.set(key, existing);
    }
    return [...buckets.values()];
  }, [summaryMode, visibleBaseRows, visibleDailyRows]);
  const activeChannels = useMemo(() => channels.filter((channel) => channel.name.toLowerCase().includes(channelSearch.trim().toLowerCase())), [channelSearch, channels]);
  const authorizedChannelType = useMemo(() => {
    const types = [...new Set(channels.map((channel) => channel.channelType))];
    return types.length === 1 ? types[0] : null;
  }, [channels]);

  async function saveChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSavingId("new-channel"); setError("");
    const data = new FormData(event.currentTarget);
    try {
      if (!authorizedChannelType) throw new Error("当前资源账号没有唯一的渠道类型，请联系总公司管理员修正授权");
      await requestJson("/api/admin/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ global: true, name: String(data.get("name") ?? ""), channelType: authorizedChannelType }) });
      setCreateChannel(false); setNotice("渠道已创建，并按当前资源账号的授权范围管理"); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "渠道创建失败"); }
    finally { setSavingId(""); }
  }
  async function toggleChannel(channel: Channel) {
    setSavingId(channel.id); setError("");
    try { await requestJson("/api/admin/channels", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: channel.id, global: true, active: !channel.active }) }); setNotice(`${channel.name}已${channel.active ? "停用" : "启用"}`); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "渠道状态修改失败"); }
    finally { setSavingId(""); }
  }
  const title = ({ dashboard: "资源工作台", daily: "每日渠道数据", summary: "渠道数据汇总", channels: "渠道与单价", usage: "渠道使用情况", accounts: "资源账号管理", comparison: "渠道表现对比", anomalies: "异常数据提醒", notifications: "通知中心" } satisfies Record<View, string>)[view];
  const showFilters = ["dashboard", "daily", "summary", "comparison", "anomalies", "usage"].includes(view);
  const resourceTypeLabel = channels.length && channels.every((channel) => channel.channelType === "ADS") ? "投流资源" : channels.length && channels.every((channel) => channel.channelType === "SMS") ? "短信资源" : channels.length ? "授权资源" : "未授权资源";

  return <WorkspaceShell mark="资" workspaceLabel="资源部管理员" title={title} subtitle="所有数据均来自已保存的真实业务记录" userName={user.name} userLabel={resourceTypeLabel} onLogout={onLogout} scope={{ label: resourceTypeLabel, value: "仅显示已授权渠道，不可切换资源类型" }} navigation={<>
      <NavButton active={view === "dashboard"} onClick={() => setView("dashboard")} icon="dashboard">资源工作台</NavButton>
      <NavButton active={view === "daily"} onClick={() => setView("daily")} icon="calendar">每日渠道数据</NavButton>
      <NavButton active={view === "summary"} onClick={() => setView("summary")} icon="sigma">渠道数据汇总</NavButton>
      <NavGroup label="资源管理"><NavButton active={view === "channels"} onClick={() => setView("channels")} icon="channel">渠道与单价</NavButton><NavButton active={view === "usage"} onClick={() => setView("usage")} icon="usage">渠道使用情况</NavButton><NavButton active={view === "accounts"} onClick={() => setView("accounts")} icon="accounts">资源账号管理</NavButton></NavGroup>
      <NavGroup label="分析报告"><NavButton active={view === "comparison"} onClick={() => setView("comparison")} icon="analysis">渠道表现对比</NavButton><NavButton active={view === "anomalies"} onClick={() => setView("anomalies")} icon="warning">异常数据提醒</NavButton></NavGroup>
      <NavButton active={view === "notifications"} onClick={() => setView("notifications")} icon="notifications">通知中心{unread ? <b>{unread}</b> : null}</NavButton>
      </>}>
        {showFilters ? <Filters report={report} range={range} from={from} to={to} channelId={channelId} company={company} department={department} groupId={groupId} memberId={memberId} day={view === "daily" ? day : undefined} companies={companies} departments={departments} groups={filterGroups} members={filterMembers} setRange={setRange} setFrom={setFrom} setTo={setTo} setChannelId={setChannelId} setCompany={(value) => { setCompany(value); setDepartment(""); setGroupId(""); setMemberId(""); }} setDepartment={(value) => { setDepartment(value); setGroupId(""); setMemberId(""); }} setGroupId={(value) => { setGroupId(value); setMemberId(""); }} setMemberId={setMemberId} setDay={setDay} onRefresh={() => void load()} /> : null}
        {loading ? <StateCard>正在读取已授权渠道数据…</StateCard> : null}
        {error ? <div className={styles.error}>{error}</div> : null}{notice ? <div className={styles.success}>{notice}</div> : null}
        {!loading && view === "dashboard" ? <Dashboard totals={totals} rows={visibleBaseRows} /> : null}
        {!loading && view === "daily" ? <>{groupId ? <MemberMatrix report={report} day={day} channelId={channelId} groupId={groupId} memberId={memberId} /> : <><StateCard>请按“日期 → 渠道 → 公司 → 部门 → 小组”定位，选定小组后会展开员工共享表。</StateCard><DataTable title="每日渠道数据" rows={visibleDailyRows.map((row) => ({ label: row.displayDate, sub: `${row.group.companyName} / ${row.group.departmentName} / ${row.group.name} / ${row.channel.name}`, totals: row.totals }))} /></>}</> : null}
        {!loading && view === "summary" ? <><div className={styles.tabs}>{([ ["channel", "按渠道"], ["department", "按公司/部门"], ["group", "按小组"], ["day", "按日期"] ] as const).map(([key, label]) => <button key={key} data-active={summaryMode === key} onClick={() => setSummaryMode(key)}>{label}</button>)}</div><DataTable title="渠道数据汇总" rows={groupedRows} /></> : null}
        {!loading && view === "channels" ? <ChannelCatalog channels={activeChannels} authorizedChannelType={authorizedChannelType} search={channelSearch} setSearch={setChannelSearch} createOpen={createChannel} setCreateOpen={setCreateChannel} savingId={savingId} onSave={saveChannel} onToggle={(channel) => void toggleChannel(channel)} /> : null}
        {!loading && view === "usage" ? <UsageTable rows={visibleBaseRows} channels={channels} /> : null}
        {!loading && view === "accounts" ? <ReadOnlyAccount user={user} channels={channels} /> : null}
        {!loading && view === "comparison" ? <><SmartAnalysis rows={visibleBaseRows} /><DataTable title="渠道表现对比" rows={groupByChannel(visibleBaseRows)} /></> : null}
        {!loading && view === "anomalies" ? <Anomalies rows={visibleBaseRows} /> : null}
        {!loading && view === "notifications" ? <UnifiedNotificationCenter onUnreadChange={setUnread} /> : null}
  </WorkspaceShell>;
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) { return <WorkspaceNavGroup label={label}>{children}</WorkspaceNavGroup>; }
function NavButton({ active, icon, onClick, children }: { active: boolean; icon: WorkspaceIcon; onClick: () => void; children: React.ReactNode }) { return <WorkspaceNavButton active={active} icon={icon} onClick={onClick}>{children}</WorkspaceNavButton>; }
function StateCard({ children }: { children: React.ReactNode }) { return <section className={`fresh-sheet-card ${styles.card} ${styles.state}`}>{children}</section>; }

function Filters(props: { report: Reporting | null; range: string; from: string; to: string; channelId: string; company: string; department: string; groupId: string; memberId: string; day?: string; companies: string[]; departments: string[]; groups: Reporting["groups"]; members: Reporting["members"]; setRange: (value: string) => void; setFrom: (value: string) => void; setTo: (value: string) => void; setChannelId: (value: string) => void; setCompany: (value: string) => void; setDepartment: (value: string) => void; setGroupId: (value: string) => void; setMemberId: (value: string) => void; setDay: (value: string) => void; onRefresh: () => void }) {
  return <section className={`fresh-toolbar ${styles.filters}`}>
    {props.day !== undefined ? <label><span>1. 日期</span><select value={props.day} onChange={(event) => props.setDay(event.target.value)}><option value="">全部日期</option>{props.report?.days.map((item) => <option key={item.date}>{item.date}</option>)}</select></label> : <label><span>统计周期</span><select value={props.range} onChange={(event) => props.setRange(event.target.value)}><option value="today">今天</option><option value="yesterday">昨天</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option><option value="month">本月</option><option value="lastMonth">上月</option><option value="custom">自定义</option></select></label>}
    {props.range === "custom" ? <><label><span>开始日期</span><input type="date" value={props.from} onChange={(event) => props.setFrom(event.target.value)} /></label><label><span>结束日期</span><input type="date" value={props.to} onChange={(event) => props.setTo(event.target.value)} /></label></> : null}
    <label><span>{props.day !== undefined ? "2. " : ""}渠道</span><select value={props.channelId} onChange={(event) => props.setChannelId(event.target.value)}><option value="">全部授权渠道</option>{props.report?.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
    <label><span>{props.day !== undefined ? "3. " : ""}公司</span><select value={props.company} onChange={(event) => props.setCompany(event.target.value)}><option value="">全部公司</option>{props.companies.map((name) => <option key={name}>{name}</option>)}</select></label>
    <label><span>{props.day !== undefined ? "4. " : ""}部门</span><select value={props.department} onChange={(event) => props.setDepartment(event.target.value)}><option value="">全部部门</option>{props.departments.map((name) => <option key={name}>{name}</option>)}</select></label>
    <label><span>{props.day !== undefined ? "5. " : ""}小组</span><select value={props.groupId} onChange={(event) => props.setGroupId(event.target.value)}><option value="">全部小组</option>{props.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    {props.day !== undefined ? <label><span>6. 归属成员</span><select value={props.memberId} onChange={(event) => props.setMemberId(event.target.value)}><option value="">全部归属成员</option>{props.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label> : null}
    <button className="fresh-primary" onClick={props.onRefresh}>刷新</button>
  </section>;
}

function Dashboard({ totals, rows }: { totals: Totals; rows: ReportRow[] }) {
  return <><section className={styles.kpis}>{[["添加数据", totals.added], ["有效数据", totals.effective], ["有效率", rate(totals.effective, totals.added)], ["进群", totals.joined], ["开单", totals.ordered], ["净业绩", money(totals.depositCents - totals.withdrawalCents)]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section><SmartAnalysis rows={rows} /><DataTable title="当前筛选范围汇总" rows={groupByChannel(rows)} /></>;
}

function DataTable({ title, rows }: { title: string; rows: Array<{ label: string; sub?: string; totals: Totals }> }) {
  const totals = sumTotals(rows);
  const cells = (value: Totals) => {
    const normalLeft = value.left - value.abnormalLeft;
    return <><td>{value.added}</td><td>{value.collision}</td><td>{value.lowAmount}</td><td>{value.noWs}</td><td>{value.manualInvalid}</td><td><strong>{value.effective}</strong></td><td>{value.replied}</td><td>{value.joined}</td><td>{normalLeft}</td><td>{value.abnormalLeft}</td><td>{value.inGroup}</td><td>{value.pushed}</td><td>{value.registered}</td><td>{value.ordered}</td><td>{rate(value.replied, value.effective)}</td><td>{rate(value.joined, value.effective)}</td><td>{rate(value.abnormalLeft, value.joined - normalLeft)}</td><td>{rate(value.registered, value.pushed)}</td><td>{rate(value.ordered, value.registered)}</td><td>{money(value.initialDepositCents)}</td><td>{money(value.rechargeCents)}</td><td>{money(value.withdrawalCents)}</td><td><strong>{money(value.depositCents - value.withdrawalCents)}</strong></td></>;
  };
  return <section className={`fresh-sheet-card ${styles.card}`}><header className={`fresh-sheet-title ${styles.cardTitle}`}><div><h2>{title}</h2><p>底部合计只计算当前筛选后显示的行，转化率按合计数重新计算</p></div><div><span>共</span><strong>{rows.length} 行</strong></div></header><div className={styles.tableWrap}><table className={styles.dataTable}><thead><tr><th>名称</th><th>添加</th><th>撞粉</th><th>低金额</th><th>无 WS</th><th>人工无效</th><th>有效</th><th>回复</th><th>进群</th><th>正常退群</th><th>异常退群</th><th>在群</th><th>推专家</th><th>注册</th><th>开单</th><th>回复率</th><th>进群率</th><th>异常退群率</th><th>注册率</th><th>开单率</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.label}-${row.sub ?? ""}-${index}`}><td><strong>{row.label}</strong>{row.sub ? <small>{row.sub}</small> : null}</td>{cells(row.totals)}</tr>)}<tr className={styles.total}><td><strong>合计</strong><small>当前显示 {rows.length} 行</small></td>{cells(totals)}</tr></tbody></table></div></section>;
}

function MemberMatrix({ report, day, channelId, groupId, memberId }: { report: Reporting | null; day: string; channelId: string; groupId: string; memberId: string }) {
  const allMembers = (report?.members ?? []).filter((member) => member.groupId === groupId);
  const members = memberId ? allMembers.filter((member) => member.id === memberId) : allMembers;
  const rows = (report?.memberRows ?? []).filter((row) => row.groupId === groupId && (!day || row.date === day) && (!channelId || row.channelId === channelId));
  const groupTotals = sumMemberTotals(rows);
  const byMember = new Map(allMembers.map((member) => [member.id, sumMemberTotals(rows.filter((row) => row.member.id === member.id))]));
  const filteredTotals = memberId ? byMember.get(memberId) ?? emptyTotals() : groupTotals;
  const group = report?.groups.find((item) => item.id === groupId);
  const value = (metric: string, totals: Totals) => {
    const normalLeft = totals.left - totals.abnormalLeft;
    const values: Record<string, string | number> = {
      "添加数据": totals.added, "撞粉": totals.collision, "低金额": totals.lowAmount, "无 WS 号码": totals.noWs, "人工无效": totals.manualInvalid,
      "有效数据": totals.effective, "回复": totals.replied, "进群": totals.joined, "正常退群": normalLeft, "异常退群": totals.abnormalLeft, "当前在群": totals.inGroup,
      "推专家": totals.pushed, "注册": totals.registered, "开单": totals.ordered, "回复率": rate(totals.replied, totals.effective), "进群率": rate(totals.joined, totals.effective),
      "异常退群率": rate(totals.abnormalLeft, totals.joined - normalLeft), "注册率": rate(totals.registered, totals.pushed), "开单率": rate(totals.ordered, totals.registered),
      "首充": money(totals.initialDepositCents), "续充": money(totals.rechargeCents), "出金": money(totals.withdrawalCents), "净业绩": money(totals.depositCents - totals.withdrawalCents),
    };
    return values[metric];
  };
  const metrics = ["添加数据", "撞粉", "低金额", "无 WS 号码", "人工无效", "有效数据", "回复", "进群", "正常退群", "异常退群", "当前在群", "推专家", "注册", "开单", "回复率", "进群率", "异常退群率", "注册率", "开单率", "首充", "续充", "出金", "净业绩"];
  return <section className={`fresh-sheet-card ${styles.card}`}><header className={`fresh-sheet-title ${styles.cardTitle}`}><div><h2>{group?.name ?? "小组"} · 员工归属汇总表</h2><p>{day || "当前周期"} · {channelId ? report?.channels.find((item) => item.id === channelId)?.name : "全部授权渠道"} · 每名组员一列，后续数据归最初来源组员</p></div><div><span>当前列</span><strong>{members.length} 名归属成员</strong></div></header><div className={styles.tableWrap}><table className={standard.matrix}><thead><tr><th>数据指标</th><th>小组合计</th>{members.map((member) => <th key={member.id}>{member.name}<small>{member.role}</small></th>)}<th>当前筛选汇总</th></tr></thead><tbody>{metrics.map((metric) => <tr key={metric}><td><strong>{metric}</strong></td><td className={standard.groupTotal}>{value(metric, groupTotals)}</td>{members.map((member) => <td key={member.id}>{value(metric, byMember.get(member.id) ?? emptyTotals())}</td>)}<td className={standard.currentTotal}>{value(metric, filteredTotals)}</td></tr>)}</tbody></table></div></section>;
}

function ChannelCatalog(props: { channels: Channel[]; authorizedChannelType: Channel["channelType"] | null; search: string; setSearch: (value: string) => void; createOpen: boolean; setCreateOpen: (value: boolean) => void; savingId: string; onSave: (event: FormEvent<HTMLFormElement>) => void; onToggle: (channel: Channel) => void }) {
  return <section className={styles.card}><header className={styles.cardTitle}><div><h2>已授权渠道目录</h2><p>可新建和启停当前账号有权管理的渠道；新版结算未使用渠道固定单价</p></div><div className={styles.actions}><input placeholder="搜索渠道" value={props.search} onChange={(event) => props.setSearch(event.target.value)} /><button disabled={!props.authorizedChannelType} onClick={() => props.setCreateOpen(!props.createOpen)}>{props.createOpen ? "取消" : "新建渠道"}</button></div></header>{props.createOpen && props.authorizedChannelType ? <form className={styles.inlineForm} onSubmit={props.onSave}><label><span>渠道名称</span><input name="name" required maxLength={100} /></label><label><span>渠道类型</span><input value={typeLabel(props.authorizedChannelType)} readOnly /></label><button disabled={props.savingId === "new-channel"}>{props.savingId === "new-channel" ? "保存中…" : "确认创建"}</button></form> : null}<div className={styles.tableWrap}><table><thead><tr><th>渠道</th><th>类型</th><th>单价/结算</th><th>覆盖小组</th><th>使用批次</th><th>状态</th><th>操作</th></tr></thead><tbody>{props.channels.map((channel) => <tr key={channel.id}><td><strong>{channel.name}</strong></td><td>{typeLabel(channel.channelType)}</td><td><span className={styles.readonly}>新版未启用固定单价</span></td><td>{channel.groupCount}</td><td>{channel.batchCount}</td><td><em data-active={channel.active}>{channel.active ? "启用" : "停用"}</em></td><td><button disabled={props.savingId === channel.id} onClick={() => props.onToggle(channel)}>{props.savingId === channel.id ? "保存中…" : channel.active ? "停用" : "启用"}</button></td></tr>)}</tbody></table></div></section>;
}
function UsageTable({ rows, channels }: { rows: ReportRow[]; channels: Channel[] }) { const catalog = new Map(channels.map((channel) => [channel.id, channel])); return <section className={styles.card}><header className={styles.cardTitle}><div><h2>渠道使用情况</h2><p>覆盖小组和批次来自渠道目录，业务量来自当前筛选报表</p></div></header><div className={styles.tableWrap}><table><thead><tr><th>渠道</th><th>公司/部门</th><th>小组</th><th>添加</th><th>有效</th><th>有效率</th><th>覆盖小组</th><th>历史批次</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.channel.id}-${row.group.id}`}><td>{row.channel.name}</td><td>{row.group.departmentName}</td><td>{row.group.name}</td><td>{row.totals.added}</td><td>{row.totals.effective}</td><td>{rate(row.totals.effective, row.totals.added)}</td><td>{catalog.get(row.channel.id)?.groupCount ?? "—"}</td><td>{catalog.get(row.channel.id)?.batchCount ?? "—"}</td></tr>)}</tbody></table></div></section>; }
function ReadOnlyAccount({ user, channels }: { user: BackendUser; channels: Channel[] }) { return <section className={`${styles.card} ${styles.readOnlyPanel}`}><span>只读</span><h2>当前资源账号</h2><dl><div><dt>姓名</dt><dd>{user.name}</dd></div><div><dt>登录账号</dt><dd>{user.username}</dd></div><div><dt>已授权渠道</dt><dd>{channels.length} 个</dd></div></dl><p>资源账号的创建、停用和渠道授权会影响数据边界，现有安全接口只允许总公司管理员操作。本页不提供虚假的编辑按钮，如需改权限，请联系总公司管理员。</p></section>; }

function groupByChannel(rows: ReportRow[]) { const map = new Map<string, { label: string; totals: Totals }>(); for (const row of rows) { const current = map.get(row.channel.id) ?? { label: row.channel.name, totals: emptyTotals() }; current.totals = sumTotals([{ totals: current.totals }, row]); map.set(row.channel.id, current); } return [...map.values()]; }
function SmartAnalysis({ rows }: { rows: ReportRow[] }) { const groups = groupByChannel(rows).filter((row) => row.totals.added > 0); if (!groups.length) return <StateCard>当前筛选范围没有可分析数据</StateCard>; const best = [...groups].sort((a, b) => b.totals.effective / Math.max(1, b.totals.added) - a.totals.effective / Math.max(1, a.totals.added))[0]; const mostOrders = [...groups].sort((a, b) => b.totals.ordered - a.totals.ordered)[0]; return <section className={styles.insights}><article data-tone="good"><span>有效率领先</span><strong>{best.label}</strong><p>{rate(best.totals.effective, best.totals.added)}，{best.totals.effective} 条有效数据</p></article><article data-tone="info"><span>开单最多</span><strong>{mostOrders.label}</strong><p>{mostOrders.totals.ordered} 单，净业绩 {money(mostOrders.totals.depositCents - mostOrders.totals.withdrawalCents)}</p></article></section>; }
function Anomalies({ rows }: { rows: ReportRow[] }) { const items = groupByChannel(rows).flatMap((row) => { const result: Array<{ tone: string; title: string; detail: string }> = []; if (row.totals.added > 0 && row.totals.effective / row.totals.added < .6) result.push({ tone: "bad", title: `${row.label}：有效率偏低`, detail: `当前 ${rate(row.totals.effective, row.totals.added)}，有效 ${row.totals.effective} / 添加 ${row.totals.added}` }); if (row.totals.added > 0 && row.totals.collision / row.totals.added > .2) result.push({ tone: "warn", title: `${row.label}：撞粉占比偏高`, detail: `${rate(row.totals.collision, row.totals.added)}，撞粉 ${row.totals.collision} 条` }); if (row.totals.joined > 0 && row.totals.abnormalLeft / row.totals.joined > .1) result.push({ tone: "warn", title: `${row.label}：异常退群需关注`, detail: `${rate(row.totals.abnormalLeft, row.totals.joined)}，异常退群 ${row.totals.abnormalLeft} 人` }); return result; }); return <section className={styles.alerts}><header><h2>根据当前筛选数据自动检查</h2><p>规则：有效率低于 60%、撞粉超过 20%、异常退群超过进群 10%</p></header>{items.length ? items.map((item, index) => <article key={`${item.title}-${index}`} data-tone={item.tone}><strong>{item.title}</strong><p>{item.detail}</p></article>) : <div className={styles.empty}>当前未触发异常规则</div>}</section>; }
