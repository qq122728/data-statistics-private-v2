"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { BackendUser } from "@/lib/backend";
import { requestJson } from "@/lib/backend";
import { DepartmentCustomerProgress } from "@/components/DepartmentCustomerProgress";
import DepartmentPersonnelTransfer from "@/components/DepartmentPersonnelTransfer";
import { NotificationBadge, UnifiedNotificationCenter, useNotificationUnread } from "@/components/UnifiedNotificationCenter";
import DepartmentDeviceAccounts from "@/components/DepartmentDeviceAccounts";
import { WorkspaceNavButton, WorkspaceNavGroup, WorkspaceShell, type WorkspaceIcon } from "@/components/WorkspaceShell";
import { localCalendarDate, SmartDateRangeToolbar, type SmartDatePreset } from "@/components/SmartDateRangeToolbar";
import { OrgGroupMetricMatrix } from "@/components/MetricMatrixTable";
import styles from "./HeadquartersWorkspace.module.css";
import { AiSmartAssistant } from "@/components/AiSmartAssistant";

type View = "dashboard" | "summary" | "customers" | "companies" | "groups" | "admins" | "transfer" | "devices" | "channels" | "notices";
type SummaryMode = "company" | "department" | "group" | "member" | "channel" | "day";
type Metrics = {
  added: number; collision: number; lowAmount: number; noWs: number; manualInvalid?: number;
  lawyerRealCase?: number; lawyerAdded?: number; lawyerExpertAdded?: number; customerServicePush?: number;
  effective: number; replied: number; joined: number; leftNormal: number; leftAbnormal: number;
  inGroup: number; pushed: number; registered: number; ordered: number;
  initialDepositCents?: number; rechargeCents?: number; withdrawalCents: number; netCents: number; cryptoDepositCents?: number; bankDepositCents?: number;
};
type ReportGroup = { id: string; name: string; groupType: "HACKER" | "LAWYER"; department: { id: string; name: string }; company: { id: string; name: string } | null; activePeople: number; totals: Metrics };
type ReportMember = { id: string; name: string; groupId: string; groupName: string; groupType: "HACKER" | "LAWYER"; totals: Metrics };
type ReportChannel = { id: string; name: string; groupType: "HACKER" | "LAWYER"; groupCount: number; totals: Metrics };
type ReportDay = { date: string; groups: Array<{ groupId: string; groupType: "HACKER" | "LAWYER"; totals: Metrics }> };
type Report = { range: { preset: string; label: string }; groups: ReportGroup[]; members: ReportMember[]; channels: ReportChannel[]; days: ReportDay[] };
type GroupNode = { id: string; name: string; groupType: "HACKER" | "LAWYER"; active: boolean; leadId: string | null; leadName: string | null };
type DepartmentNode = { id: string; name: string; active: boolean; timezone: string; countryCode: string; companyId: string | null; groups: GroupNode[] };
type CompanyNode = { id: string; name: string; active: boolean; departments: DepartmentNode[] };
type Structure = { companies?: CompanyNode[]; unassignedDepartments?: DepartmentNode[] };
type Account = { id: string; name: string; username: string; role: string; duty: string | null; active: boolean; groupName: string | null; departmentName: string | null; resourceChannelIds?: string[] };
type ChannelCatalogItem = { id: string; name: string; active: boolean; channelType: "SMS" | "ADS" | "REBATE"; groupCount: number; batchCount: number };
type TableRow = { id: string; name: string; sub?: string; people?: number; totals: Metrics };

const money = (cents = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const rate = (numerator: number, denominator: number) => denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : "—";
function metricRates(value: Metrics) {
  return {
    reply: rate(value.replied, value.effective),
    joined: rate(value.joined, value.effective),
    abnormalLeave: rate(value.leftAbnormal, value.joined - value.leftNormal),
    registered: rate(value.registered, value.pushed),
    ordered: rate(value.ordered, value.registered),
  };
}
const emptyMetrics = (): Metrics => ({ added: 0, collision: 0, lowAmount: 0, noWs: 0, manualInvalid: 0, lawyerRealCase: 0, lawyerAdded: 0, lawyerExpertAdded: 0, customerServicePush: 0, effective: 0, replied: 0, joined: 0, leftNormal: 0, leftAbnormal: 0, inGroup: 0, pushed: 0, registered: 0, ordered: 0, initialDepositCents: 0, rechargeCents: 0, withdrawalCents: 0, netCents: 0, cryptoDepositCents: 0, bankDepositCents: 0 });
function sumMetrics(values: Metrics[]): Metrics {
  const output = emptyMetrics() as unknown as Record<string, number>;
  for (const value of values) for (const [key, amount] of Object.entries(value)) output[key] = (output[key] ?? 0) + (Number(amount) || 0);
  return output as unknown as Metrics;
}
function temporaryPassword() {
  const values = new Uint32Array(3); crypto.getRandomValues(values);
  return `Manager@${[...values].map((value) => value.toString(36)).join("").slice(0, 10)}9`;
}

export function HeadquartersWorkspace({ user, onLogout }: { user: BackendUser; onLogout: () => void }) {
  const [aiOpen, setAiOpen] = useState(false);
  const [notificationUnread, setNotificationUnread] = useNotificationUnread();
  const [view, setView] = useState<View>("dashboard");
  const [report, setReport] = useState<Report | null>(null);
  const [structure, setStructure] = useState<Structure>({ companies: [], unassignedDepartments: [] });
  const [range, setRange] = useState<SmartDatePreset>("month");
  const [from, setFrom] = useState(() => `${localCalendarDate().slice(0, 8)}01`); const [to, setTo] = useState(localCalendarDate);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<SummaryMode>("company");
  const [groupTypeFilter, setGroupTypeFilter] = useState<"HACKER" | "LAWYER">("HACKER");
  const [companyId, setCompanyId] = useState(""); const [departmentId, setDepartmentId] = useState(""); const [groupId, setGroupId] = useState("");
  const [channelReport, setChannelReport] = useState<ReportChannel[] | null>(null);
  const [detailGroupId, setDetailGroupId] = useState("");

  const reportUrl = useMemo(() => {
    const params = new URLSearchParams({ range });
    if (range === "custom" && from && to) { params.set("sourceDateFrom", from); params.set("sourceDateTo", to); }
    return `/api/org/reporting?${params}`;
  }, [from, range, to]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [nextReport, nextStructure] = await Promise.all([requestJson<Report>(reportUrl), requestJson<Structure>("/api/org/structure")]);
      setReport(nextReport); setStructure(nextStructure);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "总公司数据读取失败"); }
    finally { setLoading(false); }
  }, [reportUrl]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 3500); return () => window.clearTimeout(timer); }, [notice]);

  const companies = structure.companies ?? [];
  const departments = useMemo(() => companies.flatMap((company) => company.departments), [companies]);
  const selectedDepartments = useMemo(() => companyId ? companies.find((company) => company.id === companyId)?.departments ?? [] : departments, [companies, companyId, departments]);
  const selectedGroups = useMemo(() => (departmentId ? departments.find((department) => department.id === departmentId)?.groups ?? [] : selectedDepartments.flatMap((department) => department.groups)).filter((group) => group.groupType === groupTypeFilter), [departmentId, departments, groupTypeFilter, selectedDepartments]);
  const allowedGroupIds = useMemo(() => new Set(selectedGroups.filter((group) => !groupId || group.id === groupId).map((group) => group.id)), [groupId, selectedGroups]);
  const visibleGroups = useMemo(() => (report?.groups ?? []).filter((group) => group.groupType === groupTypeFilter && allowedGroupIds.has(group.id)), [allowedGroupIds, groupTypeFilter, report]);

  useEffect(() => {
    setDepartmentId((current) => selectedDepartments.some((department) => department.id === current) ? current : "");
    setGroupId("");
  }, [companyId]);
  useEffect(() => { setGroupId((current) => selectedGroups.some((group) => group.id === current) ? current : ""); }, [departmentId]);
  useEffect(() => {
    if (mode !== "channel" || !report) { setChannelReport(null); return; }
    const ids = visibleGroups.map((group) => group.id);
    if (ids.length === report.groups.filter((group) => group.groupType === groupTypeFilter).length) { setChannelReport(report.channels.filter((channel) => channel.groupType === groupTypeFilter)); return; }
    let cancelled = false;
    const params = new URLSearchParams({ range });
    if (range === "custom" && from && to) { params.set("sourceDateFrom", from); params.set("sourceDateTo", to); }
    void Promise.all(ids.map((id) => requestJson<Report>(`/api/org/reporting?${params}&groupId=${encodeURIComponent(id)}`)))
      .then((reports) => {
        if (cancelled) return;
        const merged = new Map<string, ReportChannel>();
        for (const item of reports.flatMap((value) => value.channels)) {
          const current = merged.get(item.id);
          merged.set(item.id, current ? { ...current, groupCount: current.groupCount + item.groupCount, totals: sumMetrics([current.totals, item.totals]) } : item);
        }
        setChannelReport([...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-CN")));
      }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "渠道汇总读取失败"); });
    return () => { cancelled = true; };
  }, [from, groupTypeFilter, mode, range, report, to, visibleGroups]);

  const summaryRows = useMemo<TableRow[]>(() => {
    if (!report) return [];
    if (mode === "company") return companies.filter((company) => !companyId || company.id === companyId).map((company) => {
      const rows = report.groups.filter((group) => group.groupType === groupTypeFilter && group.company?.id === company.id && allowedGroupIds.has(group.id));
      return { id: company.id, name: company.name, people: rows.reduce((sum, row) => sum + row.activePeople, 0), totals: sumMetrics(rows.map((row) => row.totals)) };
    });
    if (mode === "department") return selectedDepartments.filter((department) => !departmentId || department.id === departmentId).map((department) => {
      const rows = report.groups.filter((group) => group.groupType === groupTypeFilter && group.department.id === department.id && allowedGroupIds.has(group.id));
      return { id: department.id, name: department.name, sub: companies.find((company) => company.id === department.companyId)?.name, people: rows.reduce((sum, row) => sum + row.activePeople, 0), totals: sumMetrics(rows.map((row) => row.totals)) };
    });
    if (mode === "group") return visibleGroups.map((group) => ({ id: group.id, name: group.name, sub: `${group.company?.name ?? "未归属公司"} · ${group.department.name}`, people: group.activePeople, totals: group.totals }));
    if (mode === "member") return report.members.filter((member) => member.groupType === groupTypeFilter && allowedGroupIds.has(member.groupId)).map((member) => ({ id: `${member.groupId}-${member.id}`, name: member.name, sub: member.groupName, totals: member.totals }));
    if (mode === "channel") return (channelReport ?? []).filter((channel) => channel.groupType === groupTypeFilter).map((channel) => ({ id: channel.id, name: channel.name, sub: `覆盖 ${channel.groupCount} 个小组`, totals: channel.totals }));
    return report.days.map((day) => ({ id: day.date, name: day.date, totals: sumMetrics(day.groups.filter((row) => row.groupType === groupTypeFilter && allowedGroupIds.has(row.groupId)).map((row) => row.totals)) }));
  }, [allowedGroupIds, channelReport, companies, companyId, departmentId, groupTypeFilter, mode, report, selectedDepartments, visibleGroups]);

  const dashboardCompanies = useMemo(() => companies.map((company) => {
    const rows = (report?.groups ?? []).filter((group) => group.groupType === groupTypeFilter && group.company?.id === company.id);
    return { company, groups: rows.length, departments: company.departments.length, people: rows.reduce((sum, group) => sum + group.activePeople, 0), totals: sumMetrics(rows.map((group) => group.totals)) };
  }), [companies, groupTypeFilter, report]);
  const title: Record<View, string> = { dashboard: "总公司工作台", summary: "数据汇总", customers: "客户进度", companies: "公司与部门", groups: "小组管理", admins: "管理员账号", transfer: "人员调动", devices: "设备账号", channels: "渠道与单价", notices: "通知中心" };

  return <WorkspaceShell mark="总" workspaceLabel="总公司管理员" title={title[view]} subtitle="总公司权限 · 所有写操作仍由后端再次核验范围" userName={user.name} userLabel="总公司管理员" onLogout={onLogout} assistant={<AiSmartAssistant open={aiOpen} onOpenChange={setAiOpen} contextLabel={`当前页面 · ${title[view]}`} user={user} />} scope={{ label: "管理范围", value: `全部公司 · ${companies.length} 家` }} navigation={<>
        <NavButton active={view === "dashboard"} label="总公司工作台" icon="dashboard" onClick={() => setView("dashboard")} />
        <NavButton active={view === "summary"} label="数据汇总" icon="summary" onClick={() => setView("summary")} />
        <NavButton active={view === "customers"} label="客户进度" icon="search" onClick={() => setView("customers")} />
        <NavGroup title="组织管理"><NavButton active={view === "companies"} label="公司与部门" icon="organization" onClick={() => setView("companies")} /><NavButton active={view === "groups"} label="小组管理" icon="settings" onClick={() => setView("groups")} /><NavButton active={view === "admins"} label="管理员账号" icon="accounts" onClick={() => setView("admins")} /><NavButton active={view === "transfer"} label="人员调动" icon="transfer" onClick={() => setView("transfer")} /></NavGroup>
        <NavGroup title="资源管理"><NavButton active={view === "devices"} label="设备账号" icon="devices" onClick={() => setView("devices")} /><NavButton active={view === "channels"} label="渠道与单价" icon="channel" onClick={() => setView("channels")} /></NavGroup>
        <NavButton active={view === "notices"} label={<>通知中心<NotificationBadge count={notificationUnread} /></>} icon="notifications" onClick={() => setView("notices")} />
      </>}>
        {notice ? <div className={styles.success}>{notice}</div> : null}{error ? <div className={styles.error}>{error}</div> : null}
        {(view === "dashboard" || view === "summary") ? <SmartDateRangeToolbar range={range} from={from} to={to} currentLabel={report?.range.label} loading={loading} title="总公司统计日期" onRange={setRange} onFrom={setFrom} onTo={setTo} onRefresh={() => void load()} /> : null}
        {(view === "dashboard" || view === "summary") ? <div className={styles.tabs}><button data-active={groupTypeFilter === "HACKER"} onClick={() => { setGroupTypeFilter("HACKER"); setGroupId(""); setDetailGroupId(""); }}>黑客组数据</button><button data-active={groupTypeFilter === "LAWYER"} onClick={() => { setGroupTypeFilter("LAWYER"); setGroupId(""); setDetailGroupId(""); }}>律师组数据</button></div> : null}
        {loading ? <section className={styles.empty}>正在读取全部公司数据…</section> : null}
        {!loading && view === "dashboard" ? <Dashboard groupType={groupTypeFilter} rows={dashboardCompanies} /> : null}
        {!loading && view === "summary" ? <><ScopeFilters groupType={groupTypeFilter} companies={companies} companyId={companyId} departmentId={departmentId} groupId={groupId} setCompanyId={(value) => { setCompanyId(value); setDetailGroupId(""); }} setDepartmentId={(value) => { setDepartmentId(value); setDetailGroupId(""); }} setGroupId={(value) => { setGroupId(value); setDetailGroupId(""); }} /><div className={styles.tabs}>{(["company", "department", "group", "member", "channel", "day"] as SummaryMode[]).map((value) => <button key={value} data-active={mode === value} onClick={() => { setMode(value); setDetailGroupId(""); }}>{{ company: "按公司", department: "按部门", group: "按小组", member: "按归属个人", channel: "按渠道", day: "按日期" }[value]}</button>)}</div><AdaptiveMetricTable groupType={groupTypeFilter} title={`${report?.range.label ?? "当前区间"} · ${titleForMode(mode)}`} rows={summaryRows} onRowClick={mode === "group" ? setDetailGroupId : undefined} />{mode === "group" && detailGroupId ? <OrgGroupMetricMatrix groupId={detailGroupId} groupName={visibleGroups.find((group) => group.id === detailGroupId)?.name ?? "小组"} groupType={visibleGroups.find((group) => group.id === detailGroupId)?.groupType ?? groupTypeFilter} range={range} from={from} to={to} onClose={() => setDetailGroupId("")} /> : null}</> : null}
        {!loading && view === "customers" ? <HeadquartersCustomers companies={companies} /> : null}
        {!loading && view === "companies" ? <CompaniesDepartments companies={companies} reload={load} notify={setNotice} /> : null}
        {!loading && view === "groups" ? <GroupManagement companies={companies} reload={load} notify={setNotice} /> : null}
        {!loading && view === "admins" ? <ManagerAccounts companies={companies} notify={setNotice} /> : null}
        {!loading && view === "transfer" ? <DepartmentPersonnelTransfer /> : null}
        {!loading && view === "devices" ? <DepartmentDeviceAccounts /> : null}
        {!loading && view === "channels" ? <ChannelResources /> : null}
        {!loading && view === "notices" ? <UnifiedNotificationCenter onUnreadChange={setNotificationUnread} /> : null}
  </WorkspaceShell>;
}

export default HeadquartersWorkspace;

function NavButton({ active, label, icon, onClick }: { active: boolean; label: React.ReactNode; icon?: WorkspaceIcon; onClick: () => void }) { return <WorkspaceNavButton active={active} icon={icon} onClick={onClick}>{label}</WorkspaceNavButton>; }
function NavGroup({ title, children }: { title: string; children: React.ReactNode }) { return <WorkspaceNavGroup label={title}>{children}</WorkspaceNavGroup>; }
function titleForMode(mode: SummaryMode) { return ({ company: "公司汇总", department: "部门汇总", group: "小组汇总", member: "个人归属汇总（每人一行）", channel: "渠道汇总", day: "日期汇总" })[mode]; }

function ScopeFilters({ groupType, companies, companyId, departmentId, groupId, setCompanyId, setDepartmentId, setGroupId }: { groupType: "HACKER" | "LAWYER"; companies: CompanyNode[]; companyId: string; departmentId: string; groupId: string; setCompanyId: (value: string) => void; setDepartmentId: (value: string) => void; setGroupId: (value: string) => void }) {
  const departments = companyId ? companies.find((company) => company.id === companyId)?.departments ?? [] : companies.flatMap((company) => company.departments);
  const groups = (departmentId ? departments.find((department) => department.id === departmentId)?.groups ?? [] : departments.flatMap((department) => department.groups)).filter((group) => group.groupType === groupType);
  return <section className={styles.filters}><label>公司<select value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">全部公司</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label>部门<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">全部部门</option>{departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select></label><label>小组<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">全部{groupType === "LAWYER" ? "律师组" : "黑客组"}</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label></section>;
}

function Dashboard({ groupType, rows }: { groupType: "HACKER" | "LAWYER"; rows: Array<{ company: CompanyNode; groups: number; departments: number; people: number; totals: Metrics }> }) {
  const totals = sumMetrics(rows.map((row) => row.totals));
  if (groupType === "LAWYER") {
    return <><section className={styles.kpis}>{[["公司", rows.length], ["接粉", totals.added], ["真实案件", totals.lawyerRealCase ?? 0], ["添加律师", totals.lawyerAdded ?? 0], ["总开单", totals.ordered]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section><LawyerMetricTable title="各公司律师组经营概况" rows={rows.map((row) => ({ id: row.company.id, name: row.company.name, sub: `${row.departments} 个部门 · ${row.groups} 个律师组`, people: row.people, totals: row.totals }))} /></>;
  }
  const totalRates = metricRates(totals);
  return <><section className={styles.kpis}>{[["公司", rows.length], ["有效数据", totals.effective], ["进群", totals.joined], ["开单", totals.ordered], ["净业绩", money(totals.netCents)]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section><section className={styles.card}><div className={styles.cardHead}><div><h2>各公司经营概况</h2><p>公司之间并排列出，不把不同时区的今日口径混为一谈</p></div></div><div className={styles.tableWrap}><table><thead><tr><th>公司</th><th>部门</th><th>小组</th><th>在岗人数</th><th>有效数据</th><th>回复率</th><th>进群率</th><th>异常退群率</th><th>注册率</th><th>开单率</th><th>开单</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th></tr></thead><tbody>{rows.map((row) => { const rates = metricRates(row.totals); return <tr key={row.company.id}><td><strong>{row.company.name}</strong></td><td>{row.departments}</td><td>{row.groups}</td><td>{row.people}</td><td>{row.totals.effective}</td><td>{rates.reply}</td><td>{rates.joined}</td><td>{rates.abnormalLeave}</td><td>{rates.registered}</td><td>{rates.ordered}</td><td>{row.totals.ordered}</td><td>{money(row.totals.initialDepositCents)}</td><td>{money(row.totals.rechargeCents)}</td><td>{money(row.totals.withdrawalCents)}</td><td><strong>{money(row.totals.netCents)}</strong></td></tr>; })}<tr className={styles.total}><td><strong>合计</strong></td><td>{rows.reduce((sum, row) => sum + row.departments, 0)}</td><td>{rows.reduce((sum, row) => sum + row.groups, 0)}</td><td>{rows.reduce((sum, row) => sum + row.people, 0)}</td><td>{totals.effective}</td><td>{totalRates.reply}</td><td>{totalRates.joined}</td><td>{totalRates.abnormalLeave}</td><td>{totalRates.registered}</td><td>{totalRates.ordered}</td><td>{totals.ordered}</td><td>{money(totals.initialDepositCents)}</td><td>{money(totals.rechargeCents)}</td><td>{money(totals.withdrawalCents)}</td><td><strong>{money(totals.netCents)}</strong></td></tr></tbody></table></div></section></>;
}

function AdaptiveMetricTable({ groupType, title, rows, onRowClick }: { groupType: "HACKER" | "LAWYER"; title: string; rows: TableRow[]; onRowClick?: (id: string) => void }) {
  return groupType === "LAWYER" ? <LawyerMetricTable title={title} rows={rows} onRowClick={onRowClick} /> : <MetricTable title={title} rows={rows} onRowClick={onRowClick} />;
}

function LawyerMetricTable({ title, rows, onRowClick }: { title: string; rows: TableRow[]; onRowClick?: (id: string) => void }) {
  const totals = sumMetrics(rows.map((row) => row.totals));
  const people = rows.some((row) => row.people != null) ? rows.reduce((sum, row) => sum + (row.people ?? 0), 0) : undefined;
  const cells = (value: Metrics, rowPeople?: number) => <><td>{rowPeople ?? "—"}</td><td>{value.added ?? 0}</td><td>{value.replied ?? 0}</td><td>{Math.max(0, (value.added ?? 0) - (value.replied ?? 0))}</td><td>{value.lowAmount ?? 0}</td><td>{value.lawyerRealCase ?? 0}</td><td>{rate(value.replied ?? 0, value.added ?? 0)}</td><td>{value.lawyerAdded ?? 0}</td><td>{value.lawyerExpertAdded ?? 0}</td><td>{rate(value.lawyerAdded ?? 0, value.added ?? 0)}</td><td>{rate(value.lawyerExpertAdded ?? 0, value.added ?? 0)}</td><td>{value.customerServicePush ?? 0}</td><td>{value.registered ?? 0}</td><td>{value.ordered ?? 0}</td><td>{money(value.cryptoDepositCents)}</td><td>{money(value.bankDepositCents)}</td><td>{money(value.withdrawalCents)}</td></>;
  return <section className={styles.card}><div className={styles.cardHead}><div><h2>{title}</h2><p>{onRowClick ? "点击小组名称查看合计、渠道和组员矩阵" : "律师组按接粉归属统计；未回复和三个比例由系统自动计算"}</p></div><strong>{rows.length} 行</strong></div><div className={styles.metricTable}><table><thead><tr><th>名称</th><th>人数</th><th>接粉</th><th>回复</th><th>未回复</th><th>接粉小金额</th><th>接粉真实案件</th><th>回复率</th><th>添加律师</th><th>添加专家</th><th>添加律师率</th><th>添加专家率</th><th>总推客服数量</th><th>总注册数量</th><th>总开单数量</th><th>加密货币充值金额</th><th>银行卡充值金额</th><th>出金金额</th></tr></thead><tbody>{rows.map((row) => <tr className={onRowClick ? "metric-clickable-row" : undefined} onClick={() => onRowClick?.(row.id)} key={row.id}><td><strong>{row.name}</strong>{onRowClick ? <button type="button" className="metric-row-drilldown">查看矩阵</button> : null}{row.sub ? <small>{row.sub}</small> : null}</td>{cells(row.totals, row.people)}</tr>)}<tr className={styles.total}><td><strong>合计</strong><small>当前显示 {rows.length} 行</small></td>{cells(totals, people)}</tr></tbody></table></div></section>;
}

function MetricTable({ title, rows, onRowClick }: { title: string; rows: TableRow[]; onRowClick?: (id: string) => void }) {
  const totals = sumMetrics(rows.map((row) => row.totals)); const people = rows.some((row) => row.people != null) ? rows.reduce((sum, row) => sum + (row.people ?? 0), 0) : null;
  const cells = (row: { totals: Metrics; people?: number }) => { const rates = metricRates(row.totals); return <><td>{row.people ?? "—"}</td><td>{row.totals.added}</td><td>{row.totals.collision}</td><td>{row.totals.lowAmount}</td><td>{row.totals.noWs}</td><td>{row.totals.manualInvalid ?? 0}</td><td><strong>{row.totals.effective}</strong></td><td>{row.totals.replied}</td><td>{rates.reply}</td><td>{row.totals.joined}</td><td>{rates.joined}</td><td>{row.totals.leftNormal}</td><td>{row.totals.leftAbnormal}</td><td>{rates.abnormalLeave}</td><td>{row.totals.inGroup}</td><td>{row.totals.pushed}</td><td>{row.totals.registered}</td><td>{rates.registered}</td><td>{row.totals.ordered}</td><td>{rates.ordered}</td><td>{money(row.totals.initialDepositCents)}</td><td>{money(row.totals.rechargeCents)}</td><td>{money(row.totals.withdrawalCents)}</td><td><strong>{money(row.totals.netCents)}</strong></td></>; };
  return <section className={styles.card}><div className={styles.cardHead}><div><h2>{title}</h2><p>{onRowClick ? "点击小组名称查看指标纵向、渠道和组员横向的详细矩阵" : "底部合计只汇总当前公司、部门、小组筛选范围；转化率按统一业务口径重新计算"}</p></div><strong>{rows.length} 行</strong></div><div className={styles.metricTable}><table><thead><tr><th>名称</th><th>人数</th><th>添加</th><th>撞粉</th><th>低金额</th><th>无 WS</th><th>人工无效</th><th>有效</th><th>回复</th><th>回复率</th><th>进群</th><th>进群率</th><th>正常退群</th><th>异常退群</th><th>异常退群率</th><th>在群</th><th>推专家</th><th>注册</th><th>注册率</th><th>开单</th><th>开单率</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th></tr></thead><tbody>{rows.map((row) => <tr className={onRowClick ? "metric-clickable-row" : undefined} onClick={() => onRowClick?.(row.id)} key={row.id}><td><strong>{row.name}</strong>{onRowClick ? <button type="button" className="metric-row-drilldown">查看矩阵</button> : null}{row.sub ? <small>{row.sub}</small> : null}</td>{cells(row)}</tr>)}<tr className={styles.total}><td><strong>合计</strong><small>当前显示 {rows.length} 行</small></td>{cells({ totals, people: people ?? undefined })}</tr></tbody></table></div></section>;
}

function HeadquartersCustomers({ companies }: { companies: CompanyNode[] }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? ""); const company = companies.find((item) => item.id === companyId);
  const [departmentId, setDepartmentId] = useState(company?.departments[0]?.id ?? ""); const department = company?.departments.find((item) => item.id === departmentId);
  const [groupId, setGroupId] = useState(department?.groups[0]?.id ?? "");
  useEffect(() => { const next = companies.find((item) => item.id === companyId)?.departments[0]?.id ?? ""; setDepartmentId(next); setGroupId(""); }, [companies, companyId]);
  useEffect(() => { setGroupId(companies.flatMap((item) => item.departments).find((item) => item.id === departmentId)?.groups[0]?.id ?? ""); }, [companies, departmentId]);
  return <><section className={styles.filters}><label>公司<select value={companyId} onChange={(event) => setCompanyId(event.target.value)}>{companies.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>部门<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>{company?.departments.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>小组<select value={groupId} onChange={(event) => setGroupId(event.target.value)}>{department?.groups.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><span className={styles.readonly}>只读查看</span></section>{groupId ? <DepartmentCustomerProgress groups={department?.groups.filter((group) => group.id === groupId).map(({ id, name }) => ({ id, name })) ?? []} /> : <section className={styles.empty}>请逐级选择公司、部门和小组</section>}</>;
}

function CompaniesDepartments({ companies, reload, notify }: { companies: CompanyNode[]; reload: () => Promise<void>; notify: (value: string) => void }) {
  const [companyName, setCompanyName] = useState(""); const [companyId, setCompanyId] = useState(companies[0]?.id ?? ""); const [departmentName, setDepartmentName] = useState(""); const [timezone, setTimezone] = useState("America/New_York"); const [workStart, setWorkStart] = useState("09:00"); const [workEnd, setWorkEnd] = useState("18:00"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function createCompany(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await requestJson("/api/org/companies", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: companyName }) }); setCompanyName(""); notify("公司已创建"); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "公司创建失败"); } finally { setBusy(false); } }
  async function createDepartment(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); const countryCode = timezone === "Asia/Shanghai" ? "CN" : timezone === "Europe/Berlin" ? "DE" : timezone === "Europe/London" ? "GB" : "US"; const minutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }; try { await requestJson("/api/org/departments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId, name: departmentName, countryCode, timezone, workStartMinutes: minutes(workStart), workEndMinutes: minutes(workEnd) }) }); setDepartmentName(""); notify("部门已创建"); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "部门创建失败"); } finally { setBusy(false); } }
  return <div className={styles.twoColumns}><section className={styles.card}><div className={styles.cardHead}><div><h2>公司与部门结构</h2><p>真实组织层级，共 {companies.length} 家公司</p></div></div>{companies.map((company) => <article className={styles.orgCompany} key={company.id}><header><strong>{company.name}</strong><span>{company.active ? "启用" : "停用"}</span></header>{company.departments.map((department) => <div key={department.id}><strong>{department.name}</strong><small>{department.countryCode} · {department.timezone} · {department.groups.length} 个小组</small></div>)}</article>)}</section><section className={styles.stack}><form className={styles.formCard} onSubmit={createCompany}><h2>第 1 步 · 创建公司</h2><label>公司名称<input value={companyName} onChange={(event) => setCompanyName(event.target.value)} required /></label><button disabled={busy}>确认创建</button></form><form className={styles.formCard} onSubmit={createDepartment}><h2>创建部门（先选择已有公司）</h2><label>所属公司<select value={companyId} onChange={(event) => setCompanyId(event.target.value)} required>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label>部门名称<input value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} required /></label><label>国家/时区<select value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="America/New_York">美国东部</option><option value="Europe/Berlin">德国</option><option value="Europe/London">英国</option><option value="Asia/Shanghai">中国</option></select></label><label>上班时间<input type="time" value={workStart} onChange={(event) => setWorkStart(event.target.value)} required /></label><label>下班时间<input type="time" value={workEnd} onChange={(event) => setWorkEnd(event.target.value)} required /></label><button disabled={busy || !companyId}>确认创建</button></form>{error ? <div className={styles.error}>{error}</div> : null}</section></div>;
}

function GroupManagement({ companies, reload, notify }: { companies: CompanyNode[]; reload: () => Promise<void>; notify: (value: string) => void }) {
  const departments = useMemo(() => companies.flatMap((company) => company.departments.map((department) => ({ ...department, companyName: company.name }))), [companies]);
  const groupsWithoutLead = useMemo(() => departments.flatMap((department) => department.groups.filter((group) => !group.leadId).map((group) => ({ ...group, departmentName: department.name, companyName: department.companyName }))), [departments]);
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? ""); const [name, setName] = useState(""); const [groupType, setGroupType] = useState<"HACKER" | "LAWYER">("HACKER"); const [leadGroupId, setLeadGroupId] = useState(groupsWithoutLead[0]?.id ?? ""); const [leadPassword, setLeadPassword] = useState(temporaryPassword); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (!groupsWithoutLead.some((group) => group.id === leadGroupId)) setLeadGroupId(groupsWithoutLead[0]?.id ?? ""); }, [companies, groupsWithoutLead, leadGroupId]);
  async function create(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await requestJson("/api/org/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ departmentId, name, groupType, leadAccount: null }) }); setName(""); notify("小组已创建，可到管理员账号/组长管理继续配置负责人"); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "小组创建失败"); } finally { setBusy(false); } }
  async function createLead(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError(""); try { await requestJson("/api/org/group-leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: leadGroupId, name: String(data.get("leadName") ?? ""), username: String(data.get("username") ?? ""), password: leadPassword, effectiveOn: String(data.get("effectiveOn") ?? "") }) }); setLeadPassword(temporaryPassword()); form.reset(); notify("组长账号已创建，请立即保存临时密码"); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "组长账号创建失败"); } finally { setBusy(false); } }
  async function toggle(group: GroupNode) { setBusy(true); setError(""); try { await requestJson("/api/org/groups", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: group.id, active: !group.active }) }); notify(`${group.name}已${group.active ? "停用" : "启用"}`); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "小组状态修改失败"); } finally { setBusy(false); } }
  return <><form className={styles.inlineCreate} onSubmit={create}><strong>第 1 步 · 创建小组</strong><label>所属部门<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>{departments.map((department) => <option value={department.id} key={department.id}>{department.companyName} · {department.name}</option>)}</select></label><label>小组名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>小组类型<select value={groupType} onChange={(event) => setGroupType(event.target.value as "HACKER" | "LAWYER")}><option value="HACKER">黑客组</option><option value="LAWYER">律师组</option></select></label><button disabled={busy || !departmentId}>＋ 创建小组</button></form><form className={styles.inlineCreate} onSubmit={createLead}><strong>第 2 步 · 给已有小组创建组长账号</strong><label>无组长小组<select value={leadGroupId} onChange={(event) => setLeadGroupId(event.target.value)} required><option value="">请选择</option>{groupsWithoutLead.map((group) => <option key={group.id} value={group.id}>{group.companyName} · {group.departmentName} · {group.name}</option>)}</select></label><label>组长姓名<input name="leadName" required /></label><label>登录账号<input name="username" required /></label><label>生效日期<input name="effectiveOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>临时密码<div className={styles.password}><input readOnly value={leadPassword} /><button type="button" onClick={() => setLeadPassword(temporaryPassword())}>换一个</button></div></label><button disabled={busy || !leadGroupId}>创建组长账号</button></form>{error ? <div className={styles.error}>{error}</div> : null}<section className={styles.card}><div className={styles.tableWrap}><table><thead><tr><th>公司</th><th>部门</th><th>小组</th><th>类型</th><th>组长</th><th>状态</th><th>操作</th></tr></thead><tbody>{departments.flatMap((department) => department.groups.map((group) => <tr key={group.id}><td>{department.companyName}</td><td>{department.name}</td><td><strong>{group.name}</strong></td><td>{group.groupType === "LAWYER" ? "律师组" : "黑客组"}</td><td>{group.leadName ?? "待任命"}</td><td>{group.active ? "启用" : "停用"}</td><td><button type="button" disabled={busy} onClick={() => void toggle(group)}>{group.active ? "停用" : "启用"}</button></td></tr>))}</tbody></table></div></section></>;
}

function ManagerAccounts({ companies, notify }: { companies: CompanyNode[]; notify: (value: string) => void }) {
  const departments = useMemo(() => companies.flatMap((company) => company.departments.map((department) => ({ ...department, companyName: company.name }))), [companies]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [channels, setChannels] = useState<ChannelCatalogItem[]>([]);
  const [kind, setKind] = useState<"company" | "department" | "resource">("company");
  const [scopeId, setScopeId] = useState(companies[0]?.id ?? "");
  const [resourceType, setResourceType] = useState<"ADS" | "SMS">("ADS");
  const [resourceChannelIds, setResourceChannelIds] = useState<string[]>([]);
  const [name, setName] = useState(""); const [username, setUsername] = useState(""); const [password, setPassword] = useState(temporaryPassword); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [statusBusyId, setStatusBusyId] = useState("");
  const load = useCallback(async () => {
    const [nextAccounts, catalog] = await Promise.all([
      requestJson<Account[]>("/api/org/accounts"),
      requestJson<{ channels: ChannelCatalogItem[] }>("/api/admin/channels"),
    ]);
    setAccounts(nextAccounts); setChannels(catalog.channels);
  }, []);
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "管理员账号读取失败")); }, [load]);
  useEffect(() => { setScopeId(kind === "company" ? companies[0]?.id ?? "" : kind === "department" ? departments[0]?.id ?? "" : ""); }, [companies, departments, kind]);
  useEffect(() => { setResourceChannelIds([]); }, [resourceType]);
  const resourceChannels = channels.filter((channel) => channel.active && channel.channelType === resourceType);
  const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const endpoint = kind === "company" ? "/api/org/company-managers" : kind === "department" ? "/api/org/department-managers" : "/api/org/resource-managers";
      const scope = kind === "company" ? { companyId: scopeId } : kind === "department" ? { departmentId: scopeId } : { resourceChannelIds };
      await requestJson(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...scope, name, username, password }) });
      notify("管理员账号已创建，请立即保存临时密码"); setName(""); setUsername(""); setPassword(temporaryPassword()); setResourceChannelIds([]); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "管理员账号创建失败"); }
    finally { setBusy(false); }
  }
  async function toggleAccount(account: Account) {
    setStatusBusyId(account.id); setError("");
    try { await requestJson("/api/org/accounts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: account.id, active: !account.active }) }); notify(`${account.name}账号已${account.active ? "停用" : "启用"}`); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "账号状态修改失败"); }
    finally { setStatusBusyId(""); }
  }
  const listedAccounts = accounts.filter((account) => account.duty === "COMPANY_MANAGER" || account.duty === "DEPARTMENT_MANAGER" || account.role === "RESOURCE_MANAGER");
  return <>
    <section className={styles.info}><strong>账号开设顺序</strong><span>公司先创建公司，再开公司管理员；资源部先创建渠道，再开对应的投流或短信账号。</span></section>
    <form className={styles.inlineCreate} onSubmit={create}>
      <label>账号类型<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="company">公司管理员</option><option value="department">部门管理员</option><option value="resource">资源部管理员</option></select></label>
      {kind !== "resource" ? <label>管理范围<select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>{(kind === "company" ? companies : departments).map((item) => <option value={item.id} key={item.id}>{"companyName" in item ? `${item.companyName} · ${item.name}` : item.name}</option>)}</select></label> : <>
        <label>资源类型<select value={resourceType} onChange={(event) => setResourceType(event.target.value as typeof resourceType)}><option value="ADS">投流</option><option value="SMS">短信</option></select></label>
        <fieldset className={styles.channelChoices}><legend>授权渠道</legend>{resourceChannels.length ? resourceChannels.map((channel) => <label key={channel.id}><input type="checkbox" checked={resourceChannelIds.includes(channel.id)} onChange={(event) => setResourceChannelIds((current) => event.target.checked ? [...current, channel.id] : current.filter((id) => id !== channel.id))} />{channel.name}</label>) : <span>请先到“渠道与单价”创建{resourceType === "ADS" ? "投流" : "短信"}渠道</span>}</fieldset>
      </>}
      <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>登录账号<input value={username} onChange={(event) => setUsername(event.target.value)} required /></label><label>临时密码<div className={styles.password}><input readOnly value={password} /><button type="button" onClick={() => setPassword(temporaryPassword())}>换一个</button></div></label><button disabled={busy || (kind === "resource" ? !resourceChannelIds.length : !scopeId)}>创建账号</button>
    </form>
    {error ? <div className={styles.error}>{error}</div> : null}
    <section className={styles.card}><div className={styles.cardHead}><div><h2>管理账号</h2><p>资源账号只显示被授权的渠道，不会跨到另一种资源类型</p></div><strong>{listedAccounts.length} 个</strong></div><div className={styles.tableWrap}><table><thead><tr><th>姓名</th><th>登录账号</th><th>身份</th><th>管理范围</th><th>状态</th><th>操作</th></tr></thead><tbody>{listedAccounts.map((account) => <tr key={account.id}><td><strong>{account.name}</strong></td><td>{account.username}</td><td>{account.role === "RESOURCE_MANAGER" ? "资源部管理员" : account.duty === "COMPANY_MANAGER" ? "公司管理员" : "部门管理员"}</td><td>{account.role === "RESOURCE_MANAGER" ? (account.resourceChannelIds ?? []).map((id) => channelNames.get(id) ?? id).join("、") || "未授权渠道" : account.departmentName ?? account.groupName ?? "公司范围"}</td><td>{account.active ? "启用" : "停用"}</td><td><button type="button" disabled={Boolean(statusBusyId)} onClick={() => void toggleAccount(account)}>{statusBusyId === account.id ? "处理中…" : account.active ? "停用" : "启用"}</button></td></tr>)}</tbody></table></div></section>
  </>;
}

function ChannelResources() {
  const [channels, setChannels] = useState<ChannelCatalogItem[]>([]); const [name, setName] = useState(""); const [channelType, setChannelType] = useState<"ADS" | "SMS" | "REBATE">("ADS"); const [reason, setReason] = useState(""); const [currentPassword, setCurrentPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const load = useCallback(() => requestJson<{ channels: ChannelCatalogItem[] }>("/api/admin/channels").then((value) => setChannels(value.channels)), []);
  useEffect(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "渠道读取失败")); }, [load]);
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await requestJson("/api/admin/channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ global: true, name, channelType, highRiskReason: reason, currentPassword }) });
      setName(""); setReason(""); setCurrentPassword(""); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "渠道创建失败"); }
    finally { setBusy(false); }
  }
  return <>
    <section className={styles.info}><strong>第 1 步先建立渠道，第 2 步再到“管理员账号”开资源账号</strong><span>渠道分为投流、短信和底料；新版渠道不保存固定有效粉单价，金额以客户订单和资金明细为准。</span></section>
    <form className={styles.inlineCreate} onSubmit={create}><label>渠道名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：律师底料" required /></label><label>渠道类型<select value={channelType} onChange={(event) => setChannelType(event.target.value as typeof channelType)}><option value="ADS">投流</option><option value="SMS">短信</option><option value="REBATE">底料</option></select></label><label>创建原因<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="至少 4 个字" minLength={4} required /></label><label>当前账号密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><button disabled={busy}>{busy ? "创建中…" : "创建渠道"}</button></form>
    {error ? <div className={styles.error}>{error}</div> : null}
    <section className={styles.card}><div className={styles.cardHead}><div><h2>渠道目录</h2><p>创建后覆盖所有启用小组，再按渠道给资源账号授权</p></div><strong>{channels.length} 个</strong></div><div className={styles.tableWrap}><table><thead><tr><th>渠道</th><th>类型</th><th>覆盖小组</th><th>真实批次</th><th>固定单价</th><th>状态</th></tr></thead><tbody>{channels.map((channel) => <tr key={channel.id}><td><strong>{channel.name}</strong></td><td>{{ SMS: "短信粉", ADS: "投流粉", REBATE: "底料返点" }[channel.channelType]}</td><td>{channel.groupCount}</td><td>{channel.batchCount}</td><td>新版不设固定单价</td><td>{channel.active ? "启用" : "停用"}</td></tr>)}</tbody></table></div></section>
  </>;
}

function OperationalNotices({ companies, report }: { companies: CompanyNode[]; report: Report | null }) {
  const notices = [
    ...companies.filter((company) => !company.departments.length).map((company) => ({ id: `company-${company.id}`, tone: "warn", title: `${company.name} 尚未创建部门`, detail: "组织建好后才能开设小组和录入数据。" })),
    ...companies.flatMap((company) => company.departments.filter((department) => !department.groups.length).map((department) => ({ id: `department-${department.id}`, tone: "warn", title: `${company.name} · ${department.name} 尚未创建小组`, detail: "请到小组管理建立真实业务小组。" }))),
    ...companies.flatMap((company) => company.departments.flatMap((department) => department.groups.filter((group) => !group.leadId).map((group) => ({ id: `group-${group.id}`, tone: "bad", title: `${company.name} · ${department.name} · ${group.name} 没有在职组长`, detail: "该小组需要尽快任命负责人。" })))),
    ...(report?.groups.filter((group) => group.totals.added === 0).map((group) => ({ id: `report-${group.id}`, tone: "mute", title: `${group.name} 在当前区间没有生效数据`, detail: `${group.company?.name ?? "未归属公司"} · ${group.department.name}，请核对是否尚未填写或审核。` })) ?? []),
  ];
  return <section className={styles.card}><div className={styles.cardHead}><div><h2>组织与数据提醒</h2><p>由当前真实组织结构和生效报表自动生成</p></div><strong>{notices.length} 条</strong></div><div className={styles.noticeList}>{notices.map((item) => <article key={item.id} data-tone={item.tone}><i>{item.tone === "bad" ? "!" : item.tone === "warn" ? "△" : "i"}</i><div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}{!notices.length ? <div className={styles.empty}>当前没有需要处理的组织或数据提醒</div> : null}</div></section>;
}
