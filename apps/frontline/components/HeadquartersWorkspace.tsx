"use client";
import { accountRoleLabel } from "../../../packages/auth/account-role";
import OrgAccountActions, { type OrgManagedAccount } from "../../../packages/accounts/OrgAccountActions";

import { WORKSPACE_LABELS as labels, NAV_GROUPS } from "../../../packages/workspace/navigation";
import { RealHierarchyOverview } from "../../../packages/reporting/RealHierarchyOverview";

import CalendarDateInput from "../../../packages/customer-sheet/CalendarDateInput";
import { Children, Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import { Leaderboard } from "@/components/Leaderboard";

type View = "dashboard" | "summary" | "customers" | "companies" | "groups" | "admins" | "transfer" | "rankings" | "devices" | "channels" | "notices";
type SummaryMode = "company" | "department" | "group" | "member" | "channel" | "day";
type Metrics = {
  added: number; collision: number; lowAmount: number; noWs: number; manualInvalid?: number;
  lawyerRealCase?: number; lawyerAdded?: number; lawyerExpertAdded?: number; customerServicePush?: number;
  effective: number; replied: number; joined: number; leftNormal: number; leftAbnormal: number;
  inGroup: number; pushed: number; registered: number; ordered: number;
  initialDepositCents?: number; rechargeCents?: number; withdrawalCents: number; netCents: number; cryptoDepositCents?: number; bankDepositCents?: number;
};
type ReportGroup = { id: string; name: string; groupType: "HACKER" | "LAWYER"; department: { id: string; name: string }; company: { id: string; name: string } | null; activePeople: number; totals: Metrics };
type ReportGroupChannel = { id: string; groupId: string; groupName: string; groupType: "HACKER" | "LAWYER"; department: { id: string; name: string }; company: { id: string; name: string } | null; channel: { name: string }; activePeople: number; totals: Metrics };
type ReportMember = { id: string; name: string; groupId: string; groupName: string; groupType: "HACKER" | "LAWYER"; totals: Metrics };
type ReportChannel = { id: string; name: string; groupType: "HACKER" | "LAWYER"; groupCount: number; totals: Metrics };
type ReportDay = { date: string; groups: Array<{ groupId: string; groupType: "HACKER" | "LAWYER"; totals: Metrics }> };
type Report = { range: { preset: string; label: string }; groups: ReportGroup[]; groupChannels: ReportGroupChannel[]; members: ReportMember[]; channels: ReportChannel[]; days: ReportDay[] };
type GroupNode = { id: string; name: string; groupType: "HACKER" | "LAWYER"; active: boolean; leadId: string | null; leadName: string | null };
type DepartmentNode = { id: string; name: string; active: boolean; timezone: string; countryCode: string; companyId: string | null; groups: GroupNode[] };
type CompanyNode = { id: string; name: string; active: boolean; departments: DepartmentNode[] };
type Structure = { companies?: CompanyNode[]; unassignedDepartments?: DepartmentNode[] };
type Account = { id: string; name: string; username: string; role: string; duty: string | null; active: boolean; groupName: string | null; departmentName: string | null; resourceChannelIds?: string[]; financeGroupIds?: string[]; financeScopeConfigured?: boolean; secondaryRoles?: string[]; updatedAt?: string };
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

  const dashboardRows = useMemo(() => {
    const groups = (report?.groups ?? []).filter((group) => group.groupType === groupTypeFilter);
    const rows = (report?.groupChannels ?? []).filter((row) => row.groupType === groupTypeFilter);
    const populatedGroupIds = new Set(rows.map((row) => row.groupId));
    return [...rows, ...groups.filter((group) => !populatedGroupIds.has(group.id)).map((group) => ({
      id: `${group.id}-no-channel`, groupId: group.id, groupName: group.name, groupType: group.groupType,
      department: group.department, company: group.company, channel: { name: "暂无渠道数据" }, activePeople: group.activePeople, totals: group.totals,
    }))].sort((left, right) => `${left.company?.name ?? ""}-${left.department.name}-${left.groupName}-${left.channel.name}`.localeCompare(`${right.company?.name ?? ""}-${right.department.name}-${right.groupName}-${right.channel.name}`, "zh-CN"));
  }, [groupTypeFilter, report]);
  const title: Record<View, string> = { dashboard: labels.hqDashboard, summary: labels.summary, customers: labels.customers, companies: labels.companies, groups: labels.groups, admins: labels.personnel, transfer: labels.transfer, rankings: labels.rankings, devices: labels.devices, channels: labels.channels, notices: labels.notifications };

  const roleLabel = user.role === "ADMIN" ? labels.systemAdmin : labels.hqAdmin;
  return <WorkspaceShell mark="总" workspaceLabel={roleLabel} title={title[view]} subtitle="查看全部公司数据，管理组织和人员" userName={user.name} userLabel={accountRoleLabel(user)} onLogout={onLogout} assistant={<AiSmartAssistant open={aiOpen} onOpenChange={setAiOpen} contextLabel={`当前页面 · ${title[view]}`} user={user} />} scope={{ label: "管理范围", value: `全部公司 · ${companies.length} 家` }} navigation={<>
      <WorkspaceNavGroup label={NAV_GROUPS.work}>
        <NavButton active={view === "dashboard"} label={labels.hqDashboard} icon="dashboard" onClick={() => setView("dashboard")} />
        <NavButton active={view === "customers"} label={labels.customers} icon="search" onClick={() => setView("customers")} />
        <NavButton active={view === "notices"} label={<>{labels.notifications}<NotificationBadge count={notificationUnread} /></>} icon="notifications" onClick={() => setView("notices")} />
      </WorkspaceNavGroup>
      <WorkspaceNavGroup label={NAV_GROUPS.data}>
        <NavButton active={view === "summary"} label={labels.summary} icon="summary" onClick={() => setView("summary")} />
        <NavButton active={view === "rankings"} label={labels.rankings} icon="summary" onClick={() => setView("rankings")} />
      </WorkspaceNavGroup>
      <WorkspaceNavGroup label={NAV_GROUPS.organization}>
        <NavButton active={view === "companies"} label={labels.companies} icon="organization" onClick={() => setView("companies")} />
        <NavButton active={view === "groups"} label={labels.groups} icon="settings" onClick={() => setView("groups")} />
        <NavButton active={view === "admins"} label={labels.personnel} icon="accounts" onClick={() => setView("admins")} />
        <NavButton active={view === "transfer"} label={labels.transfer} icon="transfer" onClick={() => setView("transfer")} />
      </WorkspaceNavGroup>
      <WorkspaceNavGroup label={NAV_GROUPS.resources}>
        <NavButton active={view === "devices"} label={labels.devices} icon="devices" onClick={() => setView("devices")} />
        <NavButton active={view === "channels"} label={labels.channels} icon="channel" onClick={() => setView("channels")} />
      </WorkspaceNavGroup>
    </>}>
        {notice ? <div className={styles.success}>{notice}</div> : null}{error ? <div className={styles.error}>{error}</div> : null}
        {(view === "summary") ? <div className={styles.standardDate}><SmartDateRangeToolbar range={range} from={from} to={to} currentLabel={report?.range.label} loading={loading} title="总公司统计日期" onRange={setRange} onFrom={setFrom} onTo={setTo} onRefresh={() => void load()} /></div> : null}
        {(view === "summary") ? <div className={styles.tabs}><button data-active={groupTypeFilter === "HACKER"} onClick={() => { setGroupTypeFilter("HACKER"); setGroupId(""); setDetailGroupId(""); }}>黑客组数据</button><button data-active={groupTypeFilter === "LAWYER"} onClick={() => { setGroupTypeFilter("LAWYER"); setGroupId(""); setDetailGroupId(""); }}>律师组数据</button></div> : null}
        {loading && view !== "dashboard" ? <section className={styles.empty}>正在读取全部公司数据…</section> : null}
        {view === "dashboard" ? <RealHierarchyOverview level="company" title="公司汇总" /> : null}
        {!loading && view === "summary" ? <><ScopeFilters groupType={groupTypeFilter} companies={companies} companyId={companyId} departmentId={departmentId} groupId={groupId} setCompanyId={(value) => { setCompanyId(value); setDetailGroupId(""); }} setDepartmentId={(value) => { setDepartmentId(value); setDetailGroupId(""); }} setGroupId={(value) => { setGroupId(value); setDetailGroupId(""); }} /><div className={styles.tabs}>{(["company", "department", "group", "member", "channel", "day"] as SummaryMode[]).map((value) => <button key={value} data-active={mode === value} onClick={() => { setMode(value); setDetailGroupId(""); }}>{{ company: "按公司", department: "按部门", group: "按小组", member: "按归属个人", channel: "按渠道", day: "按日期" }[value]}</button>)}</div><AdaptiveMetricTable groupType={groupTypeFilter} title={`${report?.range.label ?? "当前区间"} · ${titleForMode(mode)}`} rows={summaryRows} onRowClick={mode === "group" ? setDetailGroupId : undefined} />{mode === "group" && detailGroupId ? <OrgGroupMetricMatrix groupId={detailGroupId} groupName={visibleGroups.find((group) => group.id === detailGroupId)?.name ?? "小组"} groupType={visibleGroups.find((group) => group.id === detailGroupId)?.groupType ?? groupTypeFilter} range={range} from={from} to={to} onClose={() => setDetailGroupId("")} /> : null}</> : null}
        {!loading && view === "customers" ? <HeadquartersCustomers companies={companies} /> : null}
        {!loading && view === "companies" ? <CompaniesDepartments companies={companies} reload={load} notify={setNotice} /> : null}
        {!loading && view === "groups" ? <GroupManagement companies={companies} reload={load} notify={setNotice} /> : null}
        {!loading && view === "admins" ? <ManagerAccounts companies={companies} notify={setNotice} onTransfer={() => setView("transfer")} /> : null}
        {!loading && view === "transfer" ? <DepartmentPersonnelTransfer /> : null}
        {!loading && view === "rankings" ? <Leaderboard /> : null}
        {!loading && view === "devices" ? <DepartmentDeviceAccounts /> : null}
        {!loading && view === "channels" ? <ChannelResources /> : null}
        {!loading && view === "notices" ? <UnifiedNotificationCenter onUnreadChange={setNotificationUnread} /> : null}
  </WorkspaceShell>;
}

export default HeadquartersWorkspace;

function NavButton({ active, label, icon, onClick }: { active: boolean; label: React.ReactNode; icon?: WorkspaceIcon; onClick: () => void }) { return <WorkspaceNavButton active={active} icon={icon} onClick={onClick}>{label}</WorkspaceNavButton>; }
function titleForMode(mode: SummaryMode) { return ({ company: "公司汇总", department: "部门汇总", group: "小组汇总", member: "个人归属汇总（每人一行）", channel: "渠道汇总", day: "日期汇总" })[mode]; }

function ScopeFilters({ groupType, companies, companyId, departmentId, groupId, setCompanyId, setDepartmentId, setGroupId }: { groupType: "HACKER" | "LAWYER"; companies: CompanyNode[]; companyId: string; departmentId: string; groupId: string; setCompanyId: (value: string) => void; setDepartmentId: (value: string) => void; setGroupId: (value: string) => void }) {
  const departments = companyId ? companies.find((company) => company.id === companyId)?.departments ?? [] : companies.flatMap((company) => company.departments);
  const groups = (departmentId ? departments.find((department) => department.id === departmentId)?.groups ?? [] : departments.flatMap((department) => department.groups)).filter((group) => group.groupType === groupType);
  return <section className={styles.filters}><label>公司<select value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="">全部公司</option>{companies.map((company) => <option value={company.id} key={company.id}>{company.name}</option>)}</select></label><label>部门<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}><option value="">全部部门</option>{departments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select></label><label>小组<select value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">全部{groupType === "LAWYER" ? "律师组" : "黑客组"}</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label></section>;
}

function Dashboard({ groupType, rows, groups }: { groupType: "HACKER" | "LAWYER"; rows: ReportGroupChannel[]; groups: ReportGroup[] }) {
  const totals = sumMetrics(groups.map((group) => group.totals));
  const companyCount = new Set(groups.map((group) => group.company?.id).filter(Boolean)).size;
  const channelRows = rows.filter((row) => row.channel.name !== "暂无渠道数据");
  const channelNames = [...new Set(channelRows.map((row) => row.channel.name))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const rowsByGroupAndChannel = new Map(channelRows.map((row) => [`${row.groupId}\u0000${row.channel.name}`, row.totals]));
  const sections = [...new Map(groups.map((group) => {
    const key = `${group.company?.id ?? "unassigned"}\u0000${group.department.id}`;
    return [key, { key, companyId: group.company?.id ?? "unassigned", companyName: group.company?.name ?? "未归属公司", department: group.department }];
  })).values()]
    .map((section) => ({ ...section, groups: groups.filter((group) => group.department.id === section.department.id && (group.company?.id ?? "unassigned") === section.companyId).sort((left, right) => left.name.localeCompare(right.name, "zh-CN")) }))
    .sort((left, right) => `${left.companyName}-${left.department.name}`.localeCompare(`${right.companyName}-${right.department.name}`, "zh-CN"));
  const channelMetrics = (selectedGroups: ReportGroup[], channelName: string) => sumMetrics(selectedGroups.map((group) => rowsByGroupAndChannel.get(`${group.id}\u0000${channelName}`) ?? emptyMetrics()));
  const hasChannel = (selectedGroups: ReportGroup[], channelName: string) => selectedGroups.some((group) => rowsByGroupAndChannel.has(`${group.id}\u0000${channelName}`));
  const kpis = groupType === "LAWYER"
    ? [["公司", companyCount], ["接粉", totals.added], ["真实案件", totals.lawyerRealCase ?? 0], ["添加律师", totals.lawyerAdded ?? 0], ["总开单", totals.ordered]]
    : [["公司", companyCount], ["有效数据", totals.effective], ["进群", totals.joined], ["开单", totals.ordered], ["净业绩", money(totals.netCents)]];

  return <>
    <section className={styles.kpis}>{kpis.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <section className={`${styles.card} ${styles.dashboardCard}`}>
      <div className={styles.cardHead}><div><h2>部门、小组与渠道横向汇总</h2><p>左边按公司、部门和小组排列；上方每个渠道一列，最右侧是全部渠道合计</p></div><strong>{groups.length} 个小组</strong></div>
      <div className={styles.tableWrap}>
        <table className={styles.channelPivotTable}>
          <thead><tr><th>部门 / 小组</th><th>人数</th>{channelNames.map((channelName) => <th key={channelName}><span className={styles.channelName}>{channelName}</span><small>渠道汇总</small></th>)}<th>小组合计</th></tr></thead>
          <tbody>
            {sections.map((section, sectionIndex) => {
              const showCompany = sectionIndex === 0 || sections[sectionIndex - 1]?.companyId !== section.companyId;
              const departmentTotals = sumMetrics(section.groups.map((group) => group.totals));
              return <Fragment key={section.key}>
                {showCompany ? <tr className={styles.companyDivider}><td colSpan={channelNames.length + 3}>{section.companyName}</td></tr> : null}
                <tr className={styles.departmentDivider}><td colSpan={channelNames.length + 3}>{section.department.name}</td></tr>
                {section.groups.map((group) => <tr key={group.id}>
                  <td><strong>{group.name}</strong><small>{section.department.name}</small></td><td>{group.activePeople}</td>
                  {channelNames.map((channelName) => { const value = rowsByGroupAndChannel.get(`${group.id}\u0000${channelName}`); return <td key={channelName}><ChannelSummaryCell groupType={groupType} totals={value} /></td>; })}
                  <td className={styles.allChannelCell}><ChannelSummaryCell groupType={groupType} totals={group.totals} /></td>
                </tr>)}
                <tr className={styles.departmentTotal}><td><strong>{section.department.name}合计</strong></td><td>{section.groups.reduce((sum, group) => sum + group.activePeople, 0)}</td>
                  {channelNames.map((channelName) => <td key={channelName}><ChannelSummaryCell groupType={groupType} totals={channelMetrics(section.groups, channelName)} empty={!hasChannel(section.groups, channelName)} /></td>)}
                  <td><ChannelSummaryCell groupType={groupType} totals={departmentTotals} /></td>
                </tr>
              </Fragment>;
            })}
            <tr className={styles.grandTotal}><td><strong>全部合计</strong></td><td>{groups.reduce((sum, group) => sum + group.activePeople, 0)}</td>
              {channelNames.map((channelName) => <td key={channelName}><ChannelSummaryCell groupType={groupType} totals={channelMetrics(groups, channelName)} empty={!hasChannel(groups, channelName)} /></td>)}
              <td><ChannelSummaryCell groupType={groupType} totals={totals} /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </>;
}

function ChannelSummaryCell({ groupType, totals, empty = false }: { groupType: "HACKER" | "LAWYER"; totals?: Metrics; empty?: boolean }) {
  if (!totals || empty) return <span className={styles.noChannelData}>—</span>;
  const items = groupType === "LAWYER"
    ? [["接粉", totals.added], ["回复", totals.replied], ["真实案件", totals.lawyerRealCase ?? 0], ["加律师", totals.lawyerAdded ?? 0], ["开单", totals.ordered], ["充值", money((totals.cryptoDepositCents ?? 0) + (totals.bankDepositCents ?? 0))]]
    : [["添加", totals.added], ["有效", totals.effective], ["回复", totals.replied], ["进群", totals.joined], ["开单", totals.ordered], ["净业绩", money(totals.netCents)]];
  return <div className={styles.channelSummary}>{items.map(([label, value]) => <span key={label}><small>{label}</small><strong>{value}</strong></span>)}</div>;
}

function AdaptiveMetricTable({ groupType, title, rows, onRowClick }: { groupType: "HACKER" | "LAWYER"; title: string; rows: TableRow[]; onRowClick?: (id: string) => void }) {
  return groupType === "LAWYER" ? <LawyerMetricTable title={title} rows={rows} onRowClick={onRowClick} /> : <MetricTable title={title} rows={rows} onRowClick={onRowClick} />;
}

function LawyerMetricTable({ title, rows, onRowClick }: { title: string; rows: TableRow[]; onRowClick?: (id: string) => void }) {
  const [metricView,setMetricView]=useState("core");
  const labels=["名称", "人数", "接粉", "回复", "未回复", "接粉小金额", "接粉真实案件", "回复率", "添加律师", "添加专家", "添加律师率", "添加专家率", "总推客服数量", "总注册数量", "总开单数量", "加密货币充值金额", "银行卡充值金额", "出金金额"];
  const rateIndexes=[7, 10, 11]; const fundIndexes=[15, 16, 17]; const coreIndexes=[0, 1, 2, 3, 8, 9, 13, 14];
  const visible=(index:number)=>metricView==="all"||index<2||(metricView==="core"?coreIndexes.includes(index):metricView==="rates"?rateIndexes.includes(index):metricView==="funds"?fundIndexes.includes(index):!rateIndexes.includes(index)&&!fundIndexes.includes(index));
  const totals = sumMetrics(rows.map((row) => row.totals));
  const people = rows.some((row) => row.people != null) ? rows.reduce((sum, row) => sum + (row.people ?? 0), 0) : undefined;
  const cells = (value: Metrics, rowPeople?: number) => <><td>{rowPeople ?? "—"}</td><td>{value.added ?? 0}</td><td>{value.replied ?? 0}</td><td>{Math.max(0, (value.added ?? 0) - (value.replied ?? 0))}</td><td>{value.lowAmount ?? 0}</td><td>{value.lawyerRealCase ?? 0}</td><td>{rate(value.replied ?? 0, value.added ?? 0)}</td><td>{value.lawyerAdded ?? 0}</td><td>{value.lawyerExpertAdded ?? 0}</td><td>{rate(value.lawyerAdded ?? 0, value.added ?? 0)}</td><td>{rate(value.lawyerExpertAdded ?? 0, value.added ?? 0)}</td><td>{value.customerServicePush ?? 0}</td><td>{value.registered ?? 0}</td><td>{value.ordered ?? 0}</td><td>{money(value.cryptoDepositCents)}</td><td>{money(value.bankDepositCents)}</td><td>{money(value.withdrawalCents)}</td></>;
  return <section className={styles.card}><div className={styles.cardHead}><div><h2>{title}</h2><p>{onRowClick ? "点击小组名称查看合计、渠道和组员矩阵" : "律师组按接粉归属统计；未回复和三个比例由系统自动计算"}</p></div><strong>{rows.length} 行</strong></div><div className={styles.metricViews} role="group" aria-label="显示指标">{[["core","常用"],["counts","数量"],["rates","比率"],["funds","资金"],["all","全部"]].map(([id,label])=><button key={id} aria-pressed={metricView===id} onClick={()=>setMetricView(id)}>{label}</button>)}</div><div className={styles.metricTable} data-condensed={metricView!=="all"}><table><thead><tr>{labels.map((label,index)=>visible(index)?<th key={label}>{label}</th>:null)}</tr></thead><tbody>{rows.map((row) => <tr className={onRowClick ? "metric-clickable-row" : undefined} onClick={() => onRowClick?.(row.id)} key={row.id}><td><strong>{row.name}</strong>{onRowClick ? <button type="button" className="metric-row-drilldown">查看矩阵</button> : null}{row.sub ? <small>{row.sub}</small> : null}</td>{Children.toArray((cells(row.totals, row.people)).props.children).filter((_,index)=>visible(index+1))}</tr>)}<tr className={styles.total}><td><strong>合计</strong><small>当前显示 {rows.length} 行</small></td>{Children.toArray((cells(totals, people)).props.children).filter((_,index)=>visible(index+1))}</tr></tbody></table></div></section>;
}

function MetricTable({ title, rows, onRowClick }: { title: string; rows: TableRow[]; onRowClick?: (id: string) => void }) {
  const [metricView,setMetricView]=useState("core");
  const labels=["名称", "人数", "添加", "撞粉", "低金额", "无 WS", "人工无效", "有效", "回复", "回复率", "进群", "进群率", "正常退群", "异常退群", "异常退群率", "在群", "推专家", "注册", "注册率", "开单", "开单率", "首充", "续充", "出金", "净业绩"];
  const rateIndexes=[9, 11, 14, 18, 20]; const fundIndexes=[21, 22, 23, 24]; const coreIndexes=[0, 1, 2, 7, 8, 10, 15, 19, 24];
  const visible=(index:number)=>metricView==="all"||index<2||(metricView==="core"?coreIndexes.includes(index):metricView==="rates"?rateIndexes.includes(index):metricView==="funds"?fundIndexes.includes(index):!rateIndexes.includes(index)&&!fundIndexes.includes(index));
  const totals = sumMetrics(rows.map((row) => row.totals)); const people = rows.some((row) => row.people != null) ? rows.reduce((sum, row) => sum + (row.people ?? 0), 0) : null;
  const cells = (row: { totals: Metrics; people?: number }) => { const rates = metricRates(row.totals); return <><td>{row.people ?? "—"}</td><td>{row.totals.added}</td><td>{row.totals.collision}</td><td>{row.totals.lowAmount}</td><td>{row.totals.noWs}</td><td>{row.totals.manualInvalid ?? 0}</td><td><strong>{row.totals.effective}</strong></td><td>{row.totals.replied}</td><td>{rates.reply}</td><td>{row.totals.joined}</td><td>{rates.joined}</td><td>{row.totals.leftNormal}</td><td>{row.totals.leftAbnormal}</td><td>{rates.abnormalLeave}</td><td>{row.totals.inGroup}</td><td>{row.totals.pushed}</td><td>{row.totals.registered}</td><td>{rates.registered}</td><td>{row.totals.ordered}</td><td>{rates.ordered}</td><td>{money(row.totals.initialDepositCents)}</td><td>{money(row.totals.rechargeCents)}</td><td>{money(row.totals.withdrawalCents)}</td><td><strong>{money(row.totals.netCents)}</strong></td></>; };
  return <section className={styles.card}><div className={styles.cardHead}><div><h2>{title}</h2><p>{onRowClick ? "点击小组名称查看指标纵向、渠道和组员横向的详细矩阵" : "底部合计只汇总当前公司、部门、小组筛选范围；转化率按统一业务口径重新计算"}</p></div><strong>{rows.length} 行</strong></div><div className={styles.metricViews} role="group" aria-label="显示指标">{[["core","常用"],["counts","数量"],["rates","比率"],["funds","资金"],["all","全部"]].map(([id,label])=><button key={id} aria-pressed={metricView===id} onClick={()=>setMetricView(id)}>{label}</button>)}</div><div className={styles.metricTable} data-condensed={metricView!=="all"}><table><thead><tr>{labels.map((label,index)=>visible(index)?<th key={label}>{label}</th>:null)}</tr></thead><tbody>{rows.map((row) => <tr className={onRowClick ? "metric-clickable-row" : undefined} onClick={() => onRowClick?.(row.id)} key={row.id}><td><strong>{row.name}</strong>{onRowClick ? <button type="button" className="metric-row-drilldown">查看矩阵</button> : null}{row.sub ? <small>{row.sub}</small> : null}</td>{Children.toArray((cells(row)).props.children).filter((_,index)=>visible(index+1))}</tr>)}<tr className={styles.total}><td><strong>合计</strong><small>当前显示 {rows.length} 行</small></td>{Children.toArray((cells({ totals, people: people ?? undefined })).props.children).filter((_,index)=>visible(index+1))}</tr></tbody></table></div></section>;
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
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? ""); const [name, setName] = useState(""); const [groupType, setGroupType] = useState<"HACKER" | "LAWYER">("HACKER"); const [leadGroupId, setLeadGroupId] = useState(groupsWithoutLead[0]?.id ?? ""); const [leadPassword, setLeadPassword] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { if (!groupsWithoutLead.some((group) => group.id === leadGroupId)) setLeadGroupId(groupsWithoutLead[0]?.id ?? ""); }, [companies, groupsWithoutLead, leadGroupId]);
  async function create(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await requestJson("/api/org/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ departmentId, name, groupType, leadAccount: null }) }); setName(""); notify("小组已创建，可到人员与岗位继续配置负责人"); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "小组创建失败"); } finally { setBusy(false); } }
  async function createLead(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setError(""); try { await requestJson("/api/org/group-leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ groupId: leadGroupId, name: String(data.get("leadName") ?? ""), username: String(data.get("username") ?? ""), password: leadPassword, effectiveOn: String(data.get("effectiveOn") ?? "") }) }); setLeadPassword(""); form.reset(); notify("组长账号已创建，可用设定的密码直接登录"); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "组长账号创建失败"); } finally { setBusy(false); } }
  async function toggle(group: GroupNode) { setBusy(true); setError(""); try { await requestJson("/api/org/groups", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: group.id, active: !group.active }) }); notify(`${group.name}已${group.active ? "停用" : "启用"}`); await reload(); } catch (caught) { setError(caught instanceof Error ? caught.message : "小组状态修改失败"); } finally { setBusy(false); } }
  return <><form className={styles.inlineCreate} onSubmit={create}><strong>第 1 步 · 创建小组</strong><label>所属部门<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>{departments.map((department) => <option value={department.id} key={department.id}>{department.companyName} · {department.name}</option>)}</select></label><label>小组名称<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>小组类型<select value={groupType} onChange={(event) => setGroupType(event.target.value as "HACKER" | "LAWYER")}><option value="HACKER">黑客组</option><option value="LAWYER">律师组</option></select></label><button disabled={busy || !departmentId}>＋ 创建小组</button></form><form className={styles.inlineCreate} onSubmit={createLead}><strong>第 2 步 · 给已有小组创建组长账号</strong><label>无组长小组<select value={leadGroupId} onChange={(event) => setLeadGroupId(event.target.value)} required><option value="">请选择</option>{groupsWithoutLead.map((group) => <option key={group.id} value={group.id}>{group.companyName} · {group.departmentName} · {group.name}</option>)}</select></label><label>组长姓名<input name="leadName" required /></label><label>登录账号<input name="username" required /></label><label>生效日期<CalendarDateInput name="effectiveOn"  defaultValue={new Date().toISOString().slice(0, 10)} required /></label><label>登录密码<div className={styles.password}><input type="password" autoComplete="new-password" value={leadPassword} onChange={(event) => setLeadPassword(event.target.value)} required minLength={6} maxLength={256} placeholder="手动设置，至少 6 位" /></div></label><button disabled={busy || !leadGroupId}>创建组长账号</button></form>{error ? <div className={styles.error}>{error}</div> : null}<section className={styles.card}><div className={styles.tableWrap}><table><thead><tr><th>公司</th><th>部门</th><th>小组</th><th>类型</th><th>组长</th><th>状态</th><th>操作</th></tr></thead><tbody>{departments.flatMap((department) => department.groups.map((group) => <tr key={group.id}><td>{department.companyName}</td><td>{department.name}</td><td><strong>{group.name}</strong></td><td>{group.groupType === "LAWYER" ? "律师组" : "黑客组"}</td><td>{group.leadName ?? "待任命"}</td><td>{group.active ? "启用" : "停用"}</td><td><button type="button" disabled={busy} onClick={() => void toggle(group)}>{group.active ? "停用" : "启用"}</button></td></tr>))}</tbody></table></div></section></>;
}

function ManagerAccounts({ companies, notify, onTransfer }: { companies: CompanyNode[]; notify: (value: string) => void; onTransfer: () => void }) {
  const departments = useMemo(() => companies.flatMap((company) => company.departments.map((department) => ({ ...department, companyName: company.name }))), [companies]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [channels, setChannels] = useState<ChannelCatalogItem[]>([]);
  const [kind, setKind] = useState<"company" | "department" | "resource" | "finance">("company");
  const [scopeId, setScopeId] = useState(companies[0]?.id ?? "");
  const [resourceType, setResourceType] = useState<"ADS" | "SMS">("ADS");
  const [resourceChannelIds, setResourceChannelIds] = useState<string[]>([]);
  const [financeGroupIds, setFinanceGroupIds] = useState<string[]>([]);
  const [name, setName] = useState(""); const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [accountSearch, setAccountSearch] = useState(""); const [accountRole, setAccountRole] = useState(""); const [accountStatus, setAccountStatus] = useState("active");
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
  const financeGroups = useMemo(() => companies.filter((company) => company.active).flatMap((company) => company.departments.filter((department) => department.active).flatMap((department) => department.groups.filter((group) => group.active).map((group) => ({ id: group.id, label: `${company.name} · ${department.name} · ${group.name}` })))), [companies]);
  useEffect(() => { setFinanceGroupIds((current) => current.filter((id) => financeGroups.some((group) => group.id === id))); }, [financeGroups]);
  const channelNames = new Map(channels.map((channel) => [channel.id, channel.name]));
  async function create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const endpoint = kind === "company" ? "/api/org/company-managers" : kind === "department" ? "/api/org/department-managers" : kind === "resource" ? "/api/org/resource-managers" : "/api/org/finance-accounts";
      const scope = kind === "company" ? { companyId: scopeId } : kind === "department" ? { departmentId: scopeId } : kind === "resource" ? { resourceChannelIds } : { financeGroupIds };
      await requestJson(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...scope, name, username, password }) });
      notify(`${kind === "finance" ? "财务" : "管理员"}账号已创建，可用设定的密码直接登录`); setName(""); setUsername(""); setPassword(""); setResourceChannelIds([]); setFinanceGroupIds([]); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "管理员账号创建失败"); }
    finally { setBusy(false); }
  }
  const roleLabel = (account: Account) => account.duty === "COMPANY_MANAGER" ? "公司管理员" : account.duty === "DEPARTMENT_MANAGER" ? "部门管理员" : account.duty === "HQ_MANAGER" ? "总公司管理员" : account.role === "RESOURCE_MANAGER" ? "资源部" : account.role === "FINANCE" ? "财务" : account.role === "RECEPTION" ? "接粉" : account.role === "GROUP_OPERATOR" ? "炒群" : account.role === "EXPERT" ? "专家" : account.role === "LEAD" ? "组长" : account.role;
  const secondaryRoleLabel = (role: string) => ({ RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家", LEAD: "组长" } as Record<string, string>)[role] ?? role;
  const listedAccounts = accounts.filter((account) => {
    const keyword = `${account.name} ${account.username} ${account.groupName ?? ""} ${account.departmentName ?? ""} ${roleLabel(account)}`.toLowerCase();
    return (!accountSearch.trim() || keyword.includes(accountSearch.trim().toLowerCase()))
      && (!accountRole || account.role === accountRole || account.secondaryRoles?.includes(accountRole))
      && (accountStatus === "all" || (accountStatus === "active" ? account.active : !account.active));
  });
  return <>
    <section className={styles.info}><strong>账号开设顺序</strong><span>公司先创建公司，再开公司管理员；资源部先创建渠道，再开对应的投流或短信账号。</span></section>
    <form className={styles.inlineCreate} onSubmit={create}>
      <label>账号类型<select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="company">公司管理员</option><option value="department">部门管理员</option><option value="resource">资源部管理员</option><option value="finance">财务</option></select></label>
      {(kind === "company" || kind === "department") ? <label>管理范围<select value={scopeId} onChange={(event) => setScopeId(event.target.value)}>{(kind === "company" ? companies : departments).map((item) => <option value={item.id} key={item.id}>{"companyName" in item ? `${item.companyName} · ${item.name}` : item.name}</option>)}</select></label> : kind === "resource" ? <>
        <label>资源类型<select value={resourceType} onChange={(event) => setResourceType(event.target.value as typeof resourceType)}><option value="ADS">投流</option><option value="SMS">短信</option></select></label>
        <fieldset className={styles.channelChoices}><legend>授权渠道</legend>{resourceChannels.length ? resourceChannels.map((channel) => <label key={channel.id}><input type="checkbox" checked={resourceChannelIds.includes(channel.id)} onChange={(event) => setResourceChannelIds((current) => event.target.checked ? [...current, channel.id] : current.filter((id) => id !== channel.id))} />{channel.name}</label>) : <span>请先到“渠道管理”创建{resourceType === "ADS" ? "投流" : "短信"}渠道</span>}</fieldset>
      </> : <fieldset className={styles.channelChoices}><legend>财务可见小组（至少选 1 个）</legend>{financeGroups.length ? financeGroups.map((group) => <label key={group.id}><input type="checkbox" checked={financeGroupIds.includes(group.id)} onChange={(event) => setFinanceGroupIds((current) => event.target.checked ? [...current, group.id] : current.filter((id) => id !== group.id))} />{group.label}</label>) : <span>请先创建启用中的小组</span>}</fieldset>}
      <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>登录账号<input value={username} onChange={(event) => setUsername(event.target.value)} required /></label><label>登录密码<div className={styles.password}><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} maxLength={256} placeholder="手动设置，至少 6 位" /></div></label><button disabled={busy || (kind === "resource" ? !resourceChannelIds.length : kind === "finance" ? !financeGroupIds.length : !scopeId)}>创建账号</button>
    </form>
    {error ? <div className={styles.error}>{error}</div> : null}
    <section className={styles.card}><div className={styles.cardHead}><div><h2>全公司人员与岗位</h2><p>停用只会禁止登录和修改，历史客户、业绩和操作记录全部保留</p></div><strong>{listedAccounts.length} 人</strong></div><div className={styles.accountFilters}><input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="搜索姓名、账号、小组或部门" /><select value={accountRole} onChange={(event) => setAccountRole(event.target.value)}><option value="">全部岗位</option><option value="RECEPTION">接粉</option><option value="GROUP_OPERATOR">炒群</option><option value="EXPERT">专家</option><option value="LEAD">组长</option><option value="RESOURCE_MANAGER">资源部</option><option value="FINANCE">财务</option><option value="COMPANY_MANAGER">管理人员</option></select><select value={accountStatus} onChange={(event) => setAccountStatus(event.target.value)}><option value="active">在职账号</option><option value="inactive">已停用</option><option value="all">全部状态</option></select></div><div className={styles.tableWrap}><table><thead><tr><th>姓名 / 账号</th><th>组织范围</th><th>主岗位</th><th>兼职岗位</th><th>状态</th><th>最后变更</th><th>操作</th></tr></thead><tbody>{listedAccounts.map((account) => <tr key={account.id}><td><strong>{account.name}</strong><small className={styles.accountSub}>{account.username}</small></td><td>{account.role === "RESOURCE_MANAGER" ? (account.resourceChannelIds ?? []).map((id) => channelNames.get(id) ?? id).join("、") || "未授权渠道" : account.role === "FINANCE" ? (account.financeScopeConfigured ? `授权 ${account.financeGroupIds?.length ?? 0} 个小组` : "全部小组（旧账号）") : account.groupName ?? account.departmentName ?? "公司范围"}</td><td>{roleLabel(account)}</td><td>{account.secondaryRoles?.length ? account.secondaryRoles.map(secondaryRoleLabel).join("、") : "—"}</td><td><span className={styles.accountState} data-active={account.active}>{account.active ? "在职" : "已停用"}</span></td><td>{account.updatedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short" }).format(new Date(account.updatedAt)) : "—"}</td><td><OrgAccountActions account={account} className={styles.accountActions} transferAction={account.groupName ? <button type="button" onClick={onTransfer}>调整岗位</button> : <span className={styles.accountFixedRole}>组织岗位</span>} onChanged={(updated: OrgManagedAccount) => setAccounts((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item))} notify={notify} /></td></tr>)}{!listedAccounts.length ? <tr><td colSpan={7}>当前筛选范围没有人员</td></tr> : null}</tbody></table></div></section>
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
    <section className={styles.info}><strong>第 1 步先建立渠道，第 2 步再到“人员与岗位”开资源账号</strong><span>渠道分为投流、短信和底料；新版渠道不保存固定有效粉单价，金额以客户订单和资金明细为准。</span></section>
    <form className={styles.inlineCreate} onSubmit={create}><label>渠道名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：律师底料" required /></label><label>渠道类型<select value={channelType} onChange={(event) => setChannelType(event.target.value as typeof channelType)}><option value="ADS">投流</option><option value="SMS">短信</option><option value="REBATE">底料</option></select></label><label>创建原因<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="至少 4 个字" minLength={4} required /></label><label>当前账号密码<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label><button disabled={busy}>{busy ? "创建中…" : "创建渠道"}</button></form>
    {error ? <div className={styles.error}>{error}</div> : null}
    <section className={styles.card}><div className={styles.cardHead}><div><h2>渠道目录</h2><p>创建后覆盖所有启用小组，再按渠道给资源账号授权</p></div><strong>{channels.length} 个</strong></div><div className={styles.tableWrap}><table><thead><tr><th>渠道</th><th>类型</th><th>覆盖小组</th><th title="旧版来源批次数，不包含新版按号码导入的客户">旧版批次</th><th>状态</th></tr></thead><tbody>{channels.map((channel) => <tr key={channel.id}><td><strong>{channel.name}</strong></td><td>{{ SMS: "短信粉", ADS: "投流粉", REBATE: "底料返点" }[channel.channelType]}</td><td>{channel.groupCount}</td><td>{channel.batchCount}</td><td>{channel.active ? "启用" : "停用"}</td></tr>)}</tbody></table></div></section>
  </>;
}
