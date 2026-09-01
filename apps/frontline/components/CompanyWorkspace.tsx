"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { BackendUser } from "@/lib/backend";
import { requestJson } from "@/lib/backend";
import { DepartmentCustomerProgress } from "@/components/DepartmentCustomerProgress";
import DepartmentPersonnelTransfer from "@/components/DepartmentPersonnelTransfer";
import { NotificationBadge, UnifiedNotificationCenter, useNotificationUnread } from "@/components/UnifiedNotificationCenter";
import { WorkspaceNavButton, WorkspaceShell, type WorkspaceIcon } from "@/components/WorkspaceShell";
import styles from "./CompanyWorkspace.module.css";
import flow from "./CompanyOrganizationFlow.module.css";
import { localCalendarDate, SmartDateRangeToolbar, type SmartDatePreset } from "@/components/SmartDateRangeToolbar";
import { OrgGroupMetricMatrix } from "@/components/MetricMatrixTable";
import { AiSmartAssistant } from "@/components/AiSmartAssistant";

type View = "dashboard" | "summary" | "customers" | "organization" | "resources" | "notifications";
type SummaryMode = "department" | "group" | "member" | "channel" | "day";
type OrganizationMode = "structure" | "accounts" | "transfer";
type ResourceMode = "devices" | "channels";
type Metrics = { added: number; collision: number; lowAmount: number; noWs: number; manualInvalid?: number; lawyerRealCase?: number; lawyerAdded?: number; lawyerExpertAdded?: number; customerServicePush?: number; effective: number; replied: number; joined: number; leftNormal: number; leftAbnormal: number; inGroup: number; pushed: number; registered: number; ordered: number; initialDepositCents?: number; rechargeCents?: number; withdrawalCents: number; netCents: number; cryptoDepositCents?: number; bankDepositCents?: number };
type ReportGroup = { id: string; name: string; groupType: "HACKER" | "LAWYER"; department: { id: string; name: string }; activePeople: number; totals: Metrics };
type ReportMember = { id: string; name: string; groupId: string; groupName: string; groupType: "HACKER" | "LAWYER"; totals: Metrics };
type ReportChannel = { id: string; name: string; groupType: "HACKER" | "LAWYER"; groupCount: number; totals: Metrics };
type ReportDay = { date: string; groups: Array<{ groupId: string; groupType: "HACKER" | "LAWYER"; totals: Metrics }> };
type Report = { range: { preset: string; label: string }; groups: ReportGroup[]; members: ReportMember[]; channels: ReportChannel[]; days: ReportDay[] };
type Group = { id: string; name: string; groupType: "HACKER" | "LAWYER"; active: boolean; leadId: string | null; leadName: string | null };
type Department = { id: string; name: string; active: boolean; timezone: string; countryCode: string; workStartMinutes: number; workEndMinutes: number; groups: Group[] };
type Company = { id: string; name: string; active: boolean; departments: Department[] };
type Structure = { company?: Company | null };
type Account = { id: string; name: string; username: string; role: string; duty: string | null; active: boolean; groupName: string | null; departmentName: string | null };
type AssetGroup = { id: string; name: string; departmentId: string; department: { id: string; name: string }; members: Array<{ id: string; name: string; role: string }> };
type Assets = {
  groups: AssetGroup[];
  devices: Array<{ id: string; code: string; active: boolean; group: { id: string; name: string }; member: { id: string; name: string } | null }>;
  accounts: Array<{ id: string; accountType: string; provider: string; accountNumber: string; renewalDate: string | null; purpose: string | null; situation: string | null; phoneCode: string | null; group: { id: string; name: string }; owner: { id: string; name: string; role: string } }>;
  channels: Array<{ id: string; name: string; active: boolean; channelType: string; fanCostMode: string; effectiveFanPriceCents: number | null; groupCount: number }>;
  deviceMaintenance: "READ_ONLY" | "DEPARTMENT_MANAGER";
};

const EMPTY: Metrics = { added: 0, collision: 0, lowAmount: 0, noWs: 0, manualInvalid: 0, lawyerRealCase: 0, lawyerAdded: 0, lawyerExpertAdded: 0, customerServicePush: 0, effective: 0, replied: 0, joined: 0, leftNormal: 0, leftAbnormal: 0, inGroup: 0, pushed: 0, registered: 0, ordered: 0, initialDepositCents: 0, rechargeCents: 0, withdrawalCents: 0, netCents: 0, cryptoDepositCents: 0, bankDepositCents: 0 };
const money = (cents = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const percent = (numerator: number, denominator: number) => denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : "—";
const today = () => new Date().toISOString().slice(0, 10);
const timezoneOptions = [
  ["CN", "Asia/Shanghai", "中国 · 北京"], ["HK", "Asia/Hong_Kong", "中国香港"], ["SG", "Asia/Singapore", "新加坡"],
  ["MY", "Asia/Kuala_Lumpur", "马来西亚 · 吉隆坡"], ["PH", "Asia/Manila", "菲律宾 · 马尼拉"], ["TH", "Asia/Bangkok", "泰国 · 曼谷"],
  ["VN", "Asia/Ho_Chi_Minh", "越南 · 胡志明市"], ["ID", "Asia/Jakarta", "印度尼西亚 · 雅加达"], ["JP", "Asia/Tokyo", "日本 · 东京"],
  ["KR", "Asia/Seoul", "韩国 · 首尔"], ["IN", "Asia/Kolkata", "印度 · 加尔各答"], ["AE", "Asia/Dubai", "阿联酋 · 迪拜"],
  ["DE", "Europe/Berlin", "德国 · 柏林"], ["GB", "Europe/London", "英国 · 伦敦"], ["US", "America/New_York", "美国 · 纽约"],
  ["US", "America/Chicago", "美国 · 芝加哥"], ["US", "America/Denver", "美国 · 丹佛"], ["US", "America/Los_Angeles", "美国 · 洛杉矶"],
  ["CA", "America/Toronto", "加拿大 · 多伦多"], ["CA", "America/Vancouver", "加拿大 · 温哥华"], ["AU", "Australia/Sydney", "澳大利亚 · 悉尼"],
  ["NZ", "Pacific/Auckland", "新西兰 · 奥克兰"],
] as const;
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const timeMinutes = (value: string) => { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; };
function password() { const values = new Uint32Array(3); crypto.getRandomValues(values); return `Org@${[...values].map((value) => value.toString(36)).join("").slice(0, 12)}9`; }
function sum(rows: Array<{ totals: Metrics }>): Metrics { const result = { ...EMPTY }; const values = result as unknown as Record<string, number>; for (const row of rows) for (const [key, value] of Object.entries(row.totals)) values[key] = (values[key] ?? 0) + (Number(value) || 0); return result; }

export default function CompanyWorkspace({ user, onLogout }: { user: BackendUser; onLogout: () => void }) {
  const [aiOpen, setAiOpen] = useState(false);
  const [notificationUnread, setNotificationUnread] = useNotificationUnread();
  const [view, setView] = useState<View>("dashboard");
  const [range, setRange] = useState<SmartDatePreset>("month");
  const [from, setFrom] = useState(() => `${localCalendarDate().slice(0, 8)}01`);
  const [to, setTo] = useState(localCalendarDate);
  const [summaryMode, setSummaryMode] = useState<SummaryMode>("department");
  const [groupTypeFilter, setGroupTypeFilter] = useState<"HACKER" | "LAWYER">("HACKER");
  const [organizationMode, setOrganizationMode] = useState<OrganizationMode>("structure");
  const [resourceMode, setResourceMode] = useState<ResourceMode>("devices");
  const [departmentId, setDepartmentId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [assets, setAssets] = useState<Assets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [detailGroupId, setDetailGroupId] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ range });
      if (range === "custom") { query.set("sourceDateFrom", from); query.set("sourceDateTo", to); }
      const [nextReport, structure, nextAccounts, nextAssets] = await Promise.all([
        requestJson<Report>(`/api/org/reporting?${query}`), requestJson<Structure>("/api/org/structure"),
        requestJson<Account[]>("/api/org/accounts"), requestJson<Assets>("/api/org/department-assets"),
      ]);
      setReport(nextReport); setCompany(structure.company ?? null); setAccounts(nextAccounts); setAssets(nextAssets);
      setDepartmentId((current) => structure.company?.departments.some((item) => item.id === current) ? current : structure.company?.departments[0]?.id ?? "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "公司数据读取失败"); }
    finally { setLoading(false); }
  }, [from, range, to]);
  useEffect(() => { void load(); }, [load]);

  const departments = company?.departments ?? [];
  const selectedDepartment = departments.find((item) => item.id === departmentId) ?? null;
  const filteredGroups = useMemo(() => (report?.groups ?? []).filter((group) => group.groupType === groupTypeFilter), [groupTypeFilter, report]);
  const companyTotals = useMemo(() => sum(filteredGroups), [filteredGroups]);
  const departmentRows = useMemo(() => departments.map((department) => { const rows = filteredGroups.filter((group) => group.department.id === department.id); return { name: department.name, sub: `${rows.length} 个${groupTypeFilter === "LAWYER" ? "律师组" : "黑客组"}`, people: rows.reduce((value, group) => value + group.activePeople, 0), totals: sum(rows) }; }), [departments, filteredGroups, groupTypeFilter]);
  const groupDepartment = useMemo(() => new Map((report?.groups ?? []).map((group) => [group.id, group.department.name])), [report]);
  const summaryRows = summaryMode === "department" ? departmentRows
    : summaryMode === "group" ? filteredGroups.map((group) => ({ id: group.id, name: group.name, sub: group.department.name, people: group.activePeople, totals: group.totals }))
      : summaryMode === "member" ? (report?.members ?? []).filter((member) => member.groupType === groupTypeFilter).map((member) => ({ name: member.name, sub: `${groupDepartment.get(member.groupId) ?? "未知部门"} · ${member.groupName}`, totals: member.totals }))
        : summaryMode === "channel" ? (report?.channels ?? []).filter((channel) => channel.groupType === groupTypeFilter).map((channel) => ({ name: channel.name, sub: `覆盖 ${channel.groupCount} 个小组`, totals: channel.totals }))
          : (report?.days ?? []).map((day) => ({ name: day.date, totals: sum(day.groups.filter((group) => group.groupType === groupTypeFilter)) }));

  const title = view === "dashboard" ? "公司工作台" : view === "summary" ? "数据汇总" : view === "customers" ? "客户进度" : view === "organization" ? "组织管理" : view === "resources" ? "资源管理" : "通知中心";
  return <WorkspaceShell mark="司" workspaceLabel="公司管理员" title={title} subtitle="只显示当前公司范围内的真实数据" userName={user.name} userLabel="公司管理员" onLogout={onLogout} assistant={<AiSmartAssistant open={aiOpen} onOpenChange={setAiOpen} contextLabel={`当前页面 · ${title}`} user={user} />} scope={{ label: "公司管理范围", value: company?.name ?? user.companyName ?? "所属公司" }} navigation={<>
      <Nav active={view === "dashboard"} icon="dashboard" label="公司工作台" onClick={() => setView("dashboard")} />
      <Nav active={view === "summary"} icon="summary" label="数据汇总" onClick={() => setView("summary")} />
      <Nav active={view === "customers"} icon="search" label="客户进度" onClick={() => setView("customers")} />
      <Nav active={view === "organization"} icon="organization" label="组织管理" onClick={() => setView("organization")} />
      <Nav active={view === "resources"} icon="devices" label="资源管理" onClick={() => setView("resources")} />
      <Nav active={view === "notifications"} icon="notifications" label={<>通知中心<NotificationBadge count={notificationUnread} /></>} onClick={() => setView("notifications")} />
    </>}>
        {(view === "dashboard" || view === "summary") ? <SmartDateRangeToolbar range={range} from={from} to={to} currentLabel={report?.range.label} loading={loading} title="公司统计日期" onRange={setRange} onFrom={setFrom} onTo={setTo} onRefresh={() => void load()} /> : null}
        {(view === "dashboard" || view === "summary") ? <div className={styles.tabs}><button data-active={groupTypeFilter === "HACKER"} onClick={() => { setGroupTypeFilter("HACKER"); setDetailGroupId(""); }}>黑客组数据</button><button data-active={groupTypeFilter === "LAWYER"} onClick={() => { setGroupTypeFilter("LAWYER"); setDetailGroupId(""); }}>律师组数据</button></div> : null}
        {notice ? <div className={styles.notice}>{notice}</div> : null}{error ? <div className={styles.error}>{error}</div> : null}
        {loading ? <section className={`fresh-sheet-card ${styles.empty}`}>正在读取公司真实数据…</section> : null}
        {!loading && view === "dashboard" ? <><section className={styles.kpis}>{(groupTypeFilter === "LAWYER" ? [["部门", departments.length], ["律师组", filteredGroups.length], ["接粉", companyTotals.added], ["真实案件", companyTotals.lawyerRealCase ?? 0], ["添加律师", companyTotals.lawyerAdded ?? 0], ["总开单", companyTotals.ordered]] : [["部门", departments.length], ["黑客组", filteredGroups.length], ["有效数据", companyTotals.effective], ["进群", companyTotals.joined], ["开单", companyTotals.ordered], ["净业绩", money(companyTotals.netCents)]]).map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section><AdaptiveMetricTable groupType={groupTypeFilter} title="部门经营概况" rows={departmentRows} /></> : null}
        {!loading && view === "summary" ? <><Tabs values={[["department", "按部门"], ["group", "按小组"], ["member", "按归属个人"], ["channel", "按渠道"], ["day", "按日期"]]} active={summaryMode} onChange={(value) => { setSummaryMode(value as SummaryMode); setDetailGroupId(""); }} /><AdaptiveMetricTable groupType={groupTypeFilter} title={`${summaryMode === "member" ? "个人归属数据汇总（每人一行）" : "公司数据汇总"} · ${report?.range.label ?? ""}`} rows={summaryRows} onRowClick={summaryMode === "group" ? setDetailGroupId : undefined} />{summaryMode === "group" && detailGroupId ? <OrgGroupMetricMatrix groupId={detailGroupId} groupName={filteredGroups.find((group) => group.id === detailGroupId)?.name ?? "小组"} groupType={filteredGroups.find((group) => group.id === detailGroupId)?.groupType ?? groupTypeFilter} range={range} from={from} to={to} onClose={() => setDetailGroupId("")} /> : null}</> : null}
        {!loading && view === "customers" ? <><div className={styles.selector}><div><strong>客户所属部门</strong><span>先选部门，再在共享表内选小组</span></div><select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></div><DepartmentCustomerProgress groups={(selectedDepartment?.groups ?? []).map(({ id, name }) => ({ id, name }))} /></> : null}
        {!loading && view === "organization" ? <><Tabs values={[["structure", "部门与小组"], ["accounts", "管理员账号"], ["transfer", "人员调动"]]} active={organizationMode} onChange={(value) => setOrganizationMode(value as OrganizationMode)} />{organizationMode === "structure" ? <StructurePanel company={company} onDone={(message) => { setNotice(message); void load(); }} /> : organizationMode === "accounts" ? <ManagerPanel departments={departments} accounts={accounts} onDone={(message) => { setNotice(message); void load(); }} /> : <DepartmentPersonnelTransfer />}</> : null}
        {!loading && view === "resources" ? <><Tabs values={[["devices", "设备账号"], ["channels", "渠道与单价"]]} active={resourceMode} onChange={(value) => setResourceMode(value as ResourceMode)} />{resourceMode === "devices" ? <AssetsPanel assets={assets} /> : <ChannelPanel assets={assets} />}</> : null}
        {!loading && view === "notifications" ? <UnifiedNotificationCenter onUnreadChange={setNotificationUnread} /> : null}
  </WorkspaceShell>;
}

function Nav({ active, icon, label, onClick }: { active: boolean; icon: WorkspaceIcon; label: React.ReactNode; onClick: () => void }) { return <WorkspaceNavButton active={active} icon={icon} onClick={onClick}>{label}</WorkspaceNavButton>; }
function Tabs({ values, active, onChange }: { values: string[][]; active: string; onChange: (value: string) => void }) { return <div className={styles.tabs}>{values.map(([value, label]) => <button key={value} data-active={active === value} aria-pressed={active === value} onClick={() => onChange(value)}>{label}</button>)}</div>; }

type MetricRow = { id?: string; name: string; sub?: string; people?: number; totals: Metrics };
function AdaptiveMetricTable({ groupType, title, rows, onRowClick }: { groupType: "HACKER" | "LAWYER"; title: string; rows: MetricRow[]; onRowClick?: (id: string) => void }) {
  return groupType === "LAWYER" ? <LawyerMetricTable title={title} rows={rows} onRowClick={onRowClick} /> : <MetricTable title={title} rows={rows} onRowClick={onRowClick} />;
}
function LawyerMetricTable({ title, rows, onRowClick }: { title: string; rows: MetricRow[]; onRowClick?: (id: string) => void }) {
  const total = sum(rows); const hasPeople = rows.some((row) => row.people != null); const people = hasPeople ? rows.reduce((value, row) => value + (row.people ?? 0), 0) : undefined;
  const cells = (row: MetricRow) => <><td>{row.people ?? "—"}</td><td>{row.totals.added ?? 0}</td><td>{row.totals.replied ?? 0}</td><td>{Math.max(0, (row.totals.added ?? 0) - (row.totals.replied ?? 0))}</td><td>{row.totals.lowAmount ?? 0}</td><td>{row.totals.lawyerRealCase ?? 0}</td><td>{percent(row.totals.replied, row.totals.added)}</td><td>{row.totals.lawyerAdded ?? 0}</td><td>{row.totals.lawyerExpertAdded ?? 0}</td><td>{percent(row.totals.lawyerAdded ?? 0, row.totals.added)}</td><td>{percent(row.totals.lawyerExpertAdded ?? 0, row.totals.added)}</td><td>{row.totals.customerServicePush ?? 0}</td><td>{row.totals.registered ?? 0}</td><td>{row.totals.ordered ?? 0}</td><td>{money(row.totals.cryptoDepositCents)}</td><td>{money(row.totals.bankDepositCents)}</td><td>{money(row.totals.withdrawalCents)}</td></>;
  return <section className="fresh-sheet-card"><div className="fresh-sheet-title"><div><h2>{title} · 律师组</h2><p>{onRowClick ? "点击小组名称查看指标纵向矩阵" : "回复率和添加率都以接粉数为分母"}</p></div><div><span>共</span><strong>{rows.length} 行</strong></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>名称</th><th>人数</th><th>接粉</th><th>回复</th><th>未回复</th><th>接粉小金额</th><th>真实案件</th><th>回复率</th><th>添加律师</th><th>添加专家</th><th>添加律师率</th><th>添加专家率</th><th>总推客服</th><th>总注册</th><th>总开单</th><th>加密货币充值</th><th>银行卡充值</th><th>出金</th></tr></thead><tbody>{rows.map((row) => <tr className={onRowClick && row.id ? "metric-clickable-row" : undefined} onClick={() => row.id && onRowClick?.(row.id)} key={`${row.name}-${row.sub ?? ""}`}><td><strong>{row.name}</strong>{onRowClick && row.id ? <button type="button" className="metric-row-drilldown">查看矩阵</button> : null}{row.sub ? <small>{row.sub}</small> : null}</td>{cells(row)}</tr>)}<tr className={styles.total}><td><strong>合计</strong><small>当前 {rows.length} 行</small></td>{cells({ name: "合计", people, totals: total })}</tr></tbody></table></div></section>;
}
function MetricTable({ title, rows, onRowClick }: { title: string; rows: MetricRow[]; onRowClick?: (id: string) => void }) { const total = sum(rows); const hasPeople = rows.some((row) => row.people != null); const people = hasPeople ? rows.reduce((value, row) => value + (row.people ?? 0), 0) : undefined; const cells = (row: MetricRow) => { const base = Math.max(0, row.totals.joined - row.totals.leftNormal); return <><td>{row.people ?? "—"}</td><td>{row.totals.added ?? 0}</td><td>{row.totals.collision ?? 0}</td><td>{row.totals.lowAmount ?? 0}</td><td>{row.totals.noWs ?? 0}</td><td>{row.totals.manualInvalid ?? 0}</td><td>{row.totals.effective ?? 0}</td><td>{row.totals.replied ?? 0}</td><td>{percent(row.totals.replied, row.totals.effective)}</td><td>{row.totals.joined ?? 0}</td><td>{percent(row.totals.joined, row.totals.effective)}</td><td>{row.totals.leftNormal ?? 0}</td><td>{row.totals.leftAbnormal ?? 0}</td><td>{percent(row.totals.leftAbnormal, base)}</td><td>{row.totals.inGroup ?? 0}</td><td>{row.totals.pushed ?? 0}</td><td>{row.totals.registered ?? 0}</td><td>{percent(row.totals.registered, row.totals.pushed)}</td><td>{row.totals.ordered ?? 0}</td><td>{percent(row.totals.ordered, row.totals.registered)}</td><td>{money(row.totals.initialDepositCents)}</td><td>{money(row.totals.rechargeCents)}</td><td>{money(row.totals.withdrawalCents)}</td><td><strong>{money(row.totals.netCents)}</strong></td></>; }; return <section className="fresh-sheet-card"><div className="fresh-sheet-title"><div><h2>{title}</h2><p>{onRowClick ? "点击小组名称查看指标纵向、渠道和组员横向的详细矩阵" : "表底合计与当前显示行一致；转化率按合计分子、分母重新计算"}</p></div><div><span>共</span><strong>{rows.length} 行</strong></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>名称</th><th>人数</th><th>添加</th><th>撞粉</th><th>低金额</th><th>无 WS</th><th>人工无效</th><th>有效</th><th>回复</th><th>回复率</th><th>进群</th><th>进群率</th><th>正常退群</th><th>异常退群</th><th>异常退群率</th><th>当前在群</th><th>推专家</th><th>注册</th><th>注册率</th><th>开单</th><th>开单率</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th></tr></thead><tbody>{rows.map((row) => <tr className={onRowClick && row.id ? "metric-clickable-row" : undefined} onClick={() => row.id && onRowClick?.(row.id)} key={`${row.name}-${row.sub ?? ""}`}><td><strong>{row.name}</strong>{onRowClick && row.id ? <button type="button" className="metric-row-drilldown">查看矩阵</button> : null}{row.sub ? <small>{row.sub}</small> : null}</td>{cells(row)}</tr>)}<tr className={styles.total}><td><strong>合计</strong><small>当前 {rows.length} 行</small></td>{cells({ name: "合计", people, totals: total })}</tr></tbody></table></div></section>; }

function StructurePanel({ company, onDone }: { company: Company | null; onDone: (message: string) => void }) {
  const [departmentId, setDepartmentId] = useState(company?.departments[0]?.id ?? "");
  const [countryCode, setCountryCode] = useState("CN"); const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [departmentBusy, setDepartmentBusy] = useState(false); const [departmentError, setDepartmentError] = useState("");
  const [secret, setSecret] = useState(password); const [groupBusy, setGroupBusy] = useState(false); const [groupError, setGroupError] = useState("");
  const [leadGroupId, setLeadGroupId] = useState(""); const [leadBusy, setLeadBusy] = useState(false); const [leadError, setLeadError] = useState("");
  const countryOptions = [...new Map(timezoneOptions.map(([code, , label]) => [code, label.split(" · ")[0]])).entries()];
  const matchingTimezones = timezoneOptions.filter(([code]) => code === countryCode);
  const groups = company?.departments.flatMap((department) => department.groups.map((group) => ({ ...group, departmentName: department.name }))) ?? [];
  const groupsWithoutLead = groups.filter((group) => !group.leadId);
  useEffect(() => {
    setDepartmentId((current) => company?.departments.some((department) => department.id === current) ? current : company?.departments[0]?.id ?? "");
    setLeadGroupId((current) => groupsWithoutLead.some((group) => group.id === current) ? current : groupsWithoutLead[0]?.id ?? "");
  }, [company]);
  async function createDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!company) return; const form = event.currentTarget; const data = new FormData(form); setDepartmentBusy(true); setDepartmentError("");
    try {
      await requestJson("/api/org/departments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companyId: company.id, name: String(data.get("name") ?? "").trim(), countryCode, timezone, workStartMinutes: timeMinutes(String(data.get("workStart") ?? "10:00")), workEndMinutes: timeMinutes(String(data.get("workEnd") ?? "22:00")) }) });
      form.reset(); onDone("部门已创建。现在可进入“管理员账号”为该部门开设负责人账号。");
    } catch (caught) { setDepartmentError(caught instanceof Error ? caught.message : "开部门失败"); } finally { setDepartmentBusy(false); }
  }
  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setGroupBusy(true); setGroupError("");
    try { await requestJson("/api/org/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ departmentId, name: String(data.get("name") ?? "").trim(), groupType: data.get("groupType") }) }); onDone("小组已创建。现在可以在下方为该小组开设组长账号。"); form.reset(); } catch (caught) { setGroupError(caught instanceof Error ? caught.message : "开组失败"); } finally { setGroupBusy(false); }
  }
  async function createLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setLeadBusy(true); setLeadError("");
    try { const username = String(data.get("username") ?? ""); await requestJson("/api/org/group-leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: leadGroupId, name: data.get("name"), username, password: secret, effectiveOn: data.get("effectiveOn") }) }); onDone(`组长账号 ${username} 已创建，临时密码为 ${secret}`); setSecret(password()); form.reset(); } catch (caught) { setLeadError(caught instanceof Error ? caught.message : "组长账号创建失败"); } finally { setLeadBusy(false); }
  }
  return <div className={styles.stack}>
    <section className={flow.steps}><article data-active="true"><b>1</b><div><strong>先开部门</strong><span>填写部门名称、国家、时区和工作时间</span></div></article><i>→</i><article><b>2</b><div><strong>再开管理员账号</strong><span>只能选择本公司已经存在的部门</span></div></article></section>
    <form className={`fresh-sheet-card ${styles.form}`} onSubmit={createDepartment}><h2>第 1 步 · 开设部门</h2><input name="name" placeholder="部门名称" required maxLength={100} /><select aria-label="部门国家" value={countryCode} onChange={(event) => { const code = event.target.value; setCountryCode(code); setTimezone(timezoneOptions.find(([value]) => value === code)?.[1] ?? ""); }}>{countryOptions.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select><select aria-label="部门时区" value={timezone} onChange={(event) => setTimezone(event.target.value)}>{matchingTimezones.map(([, value, label]) => <option key={value} value={value}>{label}</option>)}</select><label className={flow.timeField}><span>上班</span><input name="workStart" type="time" defaultValue="10:00" required /></label><label className={flow.timeField}><span>下班</span><input name="workEnd" type="time" defaultValue="22:00" required /></label>{departmentError ? <p className={styles.formError}>{departmentError}</p> : null}<button className="fresh-primary" disabled={departmentBusy || !company}>{departmentBusy ? "创建中…" : "确认开部门"}</button></form>
    <section className={`fresh-sheet-card ${styles.structure}`}><div className="fresh-sheet-title"><div><h2>{company?.name ?? "本公司"} · 部门与小组</h2><p>真实组织结构</p></div></div>{company?.departments.map((department) => <article key={department.id}><header><strong>{department.name}</strong><span>{department.countryCode} · {department.timezone} · {clock(department.workStartMinutes)}–{clock(department.workEndMinutes)}</span></header><div>{department.groups.map((group) => <span key={group.id}>{group.name}<small>{group.leadName ?? "待任命组长"}</small></span>)}{!department.groups.length ? <small>暂未开设小组</small> : null}</div></article>)}{!company?.departments.length ? <div className={styles.empty}>请先完成第 1 步，创建本公司的第一个部门</div> : null}</section>
    <form className={`fresh-sheet-card ${styles.form}`} onSubmit={createGroup}><h2>小组流程 · 第 1 步：在已有部门下开设小组</h2><select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} required><option value="">请选择本公司部门</option>{company?.departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select><input name="name" placeholder="小组名称" required /><select name="groupType" defaultValue="HACKER" aria-label="小组类型"><option value="HACKER">黑客组（现有统计表）</option><option value="LAWYER">律师组（律师统计表）</option></select>{groupError ? <p className={styles.formError}>{groupError}</p> : null}<button className="fresh-primary" disabled={groupBusy || !departmentId}>{groupBusy ? "开设中…" : "确认开组"}</button></form>
    {groupsWithoutLead.length ? <form className={`fresh-sheet-card ${styles.form}`} onSubmit={createLead}><h2>小组流程 · 第 2 步：为已存在的小组开设组长账号</h2><select value={leadGroupId} onChange={(event) => setLeadGroupId(event.target.value)} required><option value="">请选择暂无组长的小组</option>{groupsWithoutLead.map((group) => <option key={group.id} value={group.id}>{group.departmentName} · {group.name}</option>)}</select><input name="name" placeholder="组长姓名" required /><input name="username" placeholder="登录账号" required /><input name="effectiveOn" type="date" defaultValue={today()} required /><div className={styles.secret}><input value={secret} readOnly /><button type="button" onClick={() => setSecret(password())}>重新生成密码</button></div>{leadError ? <p className={styles.formError}>{leadError}</p> : null}<button className="fresh-primary" disabled={leadBusy || !leadGroupId}>{leadBusy ? "创建中…" : "创建组长账号"}</button></form> : null}
  </div>;
}

function ManagerPanel({ departments, accounts, onDone }: { departments: Department[]; accounts: Account[]; onDone: (message: string) => void }) { const [secret, setSecret] = useState(password); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError(""); try { const username = String(data.get("username") ?? ""); await requestJson("/api/org/department-managers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ departmentId: data.get("departmentId"), name: data.get("name"), username, password: secret }) }); onDone(`部门管理员账号 ${username} 已创建，临时密码为 ${secret}`); setSecret(password()); form.reset(); } catch (caught) { setError(caught instanceof Error ? caught.message : "账号创建失败"); } finally { setBusy(false); } } const managers = accounts.filter((account) => account.duty === "DEPARTMENT_MANAGER"); return <div className={styles.stack}><section className={flow.steps}><article><b>1</b><div><strong>部门已建好</strong><span>当前有 {departments.length} 个本公司部门</span></div></article><i>→</i><article data-active="true"><b>2</b><div><strong>开管理员账号</strong><span>账号必须绑定到下面选择的真实部门</span></div></article></section>{departments.length ? <form className={`fresh-sheet-card ${styles.form}`} onSubmit={create}><h2>第 2 步 · 开设部门管理员账号</h2><select name="departmentId" required defaultValue=""><option value="" disabled>请选择本公司已存在的部门</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select><input name="name" placeholder="管理员姓名" required /><input name="username" placeholder="登录账号" required /><div className={styles.secret}><input value={secret} readOnly /><button type="button" onClick={() => setSecret(password())}>重新生成密码</button></div>{error ? <p className={styles.formError}>{error}</p> : null}<button className="fresh-primary" disabled={busy}>{busy ? "创建中…" : "创建账号"}</button></form> : <section className={`fresh-sheet-card ${styles.empty}`}>请先到“部门与小组”完成第 1 步，创建部门后才能开管理员账号。</section>}<SimpleTable title="本公司部门管理员" headers={["姓名", "登录账号", "所属部门", "状态"]} rows={managers.map((account) => [account.name, account.username, account.departmentName ?? "—", account.active ? "启用" : "停用"])} /></div>; }
function AssetsPanel({ assets }: { assets: Assets | null }) { return <div className={styles.stack}><section className={styles.info}><strong>公司级只读资产视图</strong><p>设备的新增、分配和收回由各部门管理员办理；公司管理员可查看全公司真实资产。</p></section><SimpleTable title="实体设备" headers={["小组", "设备号", "当前使用人", "状态"]} rows={(assets?.devices ?? []).map((item) => [item.group.name, item.code, item.member?.name ?? "空闲", item.active ? "启用" : "停用"])} /><SimpleTable title="聊天账号" headers={["小组", "平台/号商", "号码", "归属人", "机号", "用途", "当前情况", "续费日期"]} rows={(assets?.accounts ?? []).map((item) => [item.group.name, item.provider, item.accountNumber, item.owner.name, item.phoneCode ?? "—", item.purpose ?? "—", item.situation ?? "—", item.renewalDate ?? "—"])} /></div>; }
function ChannelPanel({ assets }: { assets: Assets | null }) { const kind: Record<string, string> = { SMS: "短信粉", ADS: "投流粉", REBATE: "底料返点" }; return <div className={styles.stack}><section className={styles.info}><strong>渠道和单价是真实配置快照</strong><p>当前业务报表不依赖旧版单价字段；未启用时明确显示“未启用”，不会伪造价格。</p></section><SimpleTable title="本公司渠道与单价" headers={["渠道", "类型", "覆盖小组", "单价模式", "有效粉单价", "状态"]} rows={(assets?.channels ?? []).map((item) => [item.name, kind[item.channelType] ?? item.channelType, String(item.groupCount), item.fanCostMode === "FREE" ? "未启用" : item.fanCostMode, item.effectiveFanPriceCents == null ? "—" : money(item.effectiveFanPriceCents), item.active ? "启用" : "停用"])} /></div>; }
function SimpleTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) { return <section className="fresh-sheet-card"><div className="fresh-sheet-title"><div><h2>{title}</h2><p>共 {rows.length} 行真实数据</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.join("-")}-${index}`}>{row.map((value, cell) => <td key={`${cell}-${value}`}>{value}</td>)}</tr>)}{!rows.length ? <tr><td colSpan={headers.length} className={styles.empty}>暂无数据</td></tr> : null}</tbody></table></div></section>; }
