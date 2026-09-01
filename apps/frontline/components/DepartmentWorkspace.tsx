"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BackendUser } from "@/lib/backend";
import { requestJson } from "@/lib/backend";
import { DepartmentCustomerProgress } from "@/components/DepartmentCustomerProgress";
import DepartmentGroupManagement from "@/components/DepartmentGroupManagement";
import DepartmentPersonnelTransfer from "@/components/DepartmentPersonnelTransfer";
import { NotificationBadge, UnifiedNotificationCenter, useNotificationUnread } from "@/components/UnifiedNotificationCenter";
import { WorkspaceNavButton, WorkspaceShell } from "@/components/WorkspaceShell";
import DepartmentDeviceAccounts from "@/components/DepartmentDeviceAccounts";
import { localCalendarDate, SmartDateRangeToolbar, type SmartDatePreset } from "@/components/SmartDateRangeToolbar";
import { OrgGroupMetricMatrix } from "@/components/MetricMatrixTable";
import { AiSmartAssistant } from "@/components/AiSmartAssistant";

type View = "dashboard" | "summary" | "customers" | "groups" | "transfer" | "devices" | "notifications";
type Metrics = {
  added: number; collision: number; lowAmount: number; noWs: number; manualInvalid?: number;
  lawyerRealCase?: number; lawyerAdded?: number; lawyerExpertAdded?: number; customerServicePush?: number;
  effective: number; replied: number; joined: number; leftNormal: number; leftAbnormal: number;
  inGroup: number; pushed: number; registered: number; ordered: number;
  initialDepositCents?: number; rechargeCents?: number; withdrawalCents: number; netCents: number; cryptoDepositCents?: number; bankDepositCents?: number;
};
type ReportGroup = { id: string; name: string; groupType: "HACKER" | "LAWYER"; activePeople: number; totals: Metrics; rates: { replyRate?: number | null; groupRate?: number | null; abnormalLeaveRate?: number | null } };
type ReportMember = { id: string; name: string; groupId: string; groupName: string; groupType: "HACKER" | "LAWYER"; totals: Metrics };
type ReportChannel = { id: string; name: string; groupType: "HACKER" | "LAWYER"; groupCount: number; totals: Metrics };
type ReportDay = { date: string; groups: Array<{ groupId: string; groupType: "HACKER" | "LAWYER"; totals: Metrics }> };
type ReportPayload = { range: { preset: string; label: string }; groups: ReportGroup[]; members: ReportMember[]; channels: ReportChannel[]; days: ReportDay[] };
type StructureGroup = { id: string; name: string; groupType: "HACKER" | "LAWYER"; active: boolean; leadId: string | null; leadName: string | null };
type StructureDepartment = { id: string; name: string; timezone: string; groups: StructureGroup[] };
type StructurePayload = {
  department?: StructureDepartment | null;
  companies?: Array<{ departments: StructureDepartment[] }>;
  unassignedDepartments?: StructureDepartment[];
};

const money = (cents = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const pct = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;
function addMetricRows(rows: Array<{ totals: Metrics }>): Metrics {
  const output = {} as Metrics;
  const target = output as unknown as Record<string, number>;
  for (const row of rows) for (const [key, value] of Object.entries(row.totals)) target[key] = (target[key] ?? 0) + (Number(value) || 0);
  return output;
}

export default function DepartmentWorkspace({ user, onLogout }: { user: BackendUser; onLogout: () => void }) {
  const [aiOpen, setAiOpen] = useState(false);
  const [notificationUnread, setNotificationUnread] = useNotificationUnread();
  const [view, setView] = useState<View>("dashboard");
  const [range, setRange] = useState<SmartDatePreset>("month");
  const [from, setFrom] = useState(() => `${localCalendarDate().slice(0, 8)}01`);
  const [to, setTo] = useState(localCalendarDate);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [structure, setStructure] = useState<StructureDepartment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summaryMode, setSummaryMode] = useState<"group" | "member" | "channel" | "day">("group");
  const [groupTypeFilter, setGroupTypeFilter] = useState<"HACKER" | "LAWYER">("HACKER");
  const [groupFilter, setGroupFilter] = useState("");
  const [filteredChannelReport, setFilteredChannelReport] = useState<ReportPayload | null>(null);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelError, setChannelError] = useState("");
  const [detailGroupId, setDetailGroupId] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ range });
      if (range === "custom") { query.set("sourceDateFrom", from); query.set("sourceDateTo", to); }
      const [nextReport, nextStructure] = await Promise.all([
        requestJson<ReportPayload>(`/api/org/reporting?${query}`),
        requestJson<StructurePayload>("/api/org/structure"),
      ]);
      setReport(nextReport);
      setStructure(nextStructure.department
        ?? nextStructure.companies?.flatMap((company) => company.departments)[0]
        ?? nextStructure.unassignedDepartments?.[0]
        ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "部门数据读取失败");
    } finally { setLoading(false); }
  }, [from, range, to]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (summaryMode !== "channel" || !groupFilter) {
      setFilteredChannelReport(null);
      setChannelLoading(false);
      setChannelError("");
      return;
    }
    let cancelled = false;
    setChannelLoading(true);
    setChannelError("");
    const query = new URLSearchParams({ range, groupId: groupFilter });
    if (range === "custom") { query.set("sourceDateFrom", from); query.set("sourceDateTo", to); }
    void requestJson<ReportPayload>(`/api/org/reporting?${query}`)
      .then((nextReport) => {
        if (!cancelled) setFilteredChannelReport(nextReport);
      })
      .catch((caught) => {
        if (!cancelled) {
          setFilteredChannelReport(null);
          setChannelError(caught instanceof Error ? caught.message : "小组渠道数据读取失败");
        }
      })
      .finally(() => {
        if (!cancelled) setChannelLoading(false);
      });
    return () => { cancelled = true; };
  }, [from, groupFilter, range, summaryMode, to]);

  const filteredGroups = useMemo(() => (report?.groups ?? []).filter((group) => group.groupType === groupTypeFilter), [groupTypeFilter, report]);
  const departmentTotals = useMemo(() => filteredGroups.reduce<Metrics>((sum, group) => {
    for (const [key, value] of Object.entries(group.totals)) (sum as unknown as Record<string, number>)[key] = ((sum as unknown as Record<string, number>)[key] ?? 0) + (Number(value) || 0);
    return sum;
  }, { added: 0, collision: 0, lowAmount: 0, noWs: 0, manualInvalid: 0, lawyerRealCase: 0, lawyerAdded: 0, lawyerExpertAdded: 0, customerServicePush: 0, effective: 0, replied: 0, joined: 0, leftNormal: 0, leftAbnormal: 0, inGroup: 0, pushed: 0, registered: 0, ordered: 0, initialDepositCents: 0, rechargeCents: 0, withdrawalCents: 0, netCents: 0, cryptoDepositCents: 0, bankDepositCents: 0 }), [filteredGroups]);
  const visibleMembers = (report?.members ?? []).filter((member) => member.groupType === groupTypeFilter && (!groupFilter || member.groupId === groupFilter));
  const selectedGroup = report?.groups.find((group) => group.id === groupFilter);
  const visibleChannels = (groupFilter ? (filteredChannelReport?.channels ?? []) : (report?.channels ?? [])).filter((channel) => channel.groupType === groupTypeFilter);

  const title = view === "dashboard" ? "部门工作台" : view === "summary" ? "数据汇总" : view === "customers" ? "客户进度" : view === "groups" ? "小组管理" : view === "transfer" ? "人员调动" : view === "devices" ? "设备账号" : "通知中心";
  const subtitle = view === "dashboard" ? "先看部门整体，再定位需要处理的小组" : view === "summary" ? "按小组、个人和日期查看真实汇总" : view === "groups" ? "先开设小组，再为已存在的小组单独开设组长账号" : "只查看本部门权限范围内的数据";

  return <WorkspaceShell mark="部" workspaceLabel="部门管理员" title={title} subtitle={subtitle} userName={user.name} userLabel="部门管理员" onLogout={onLogout} assistant={<AiSmartAssistant open={aiOpen} onOpenChange={setAiOpen} contextLabel={`当前页面 · ${title}`} user={user} />} scope={{ label: "部门管理权限", value: structure?.name ?? user.departmentName ?? "所属部门" }} navigation={<>
        <WorkspaceNavButton active={view === "dashboard"} icon="dashboard" onClick={() => setView("dashboard")}>部门工作台</WorkspaceNavButton>
        <WorkspaceNavButton active={view === "summary"} icon="summary" onClick={() => setView("summary")}>数据汇总</WorkspaceNavButton>
        <WorkspaceNavButton active={view === "customers"} icon="search" onClick={() => setView("customers")}>客户进度</WorkspaceNavButton>
        <WorkspaceNavButton active={view === "groups"} icon="settings" onClick={() => setView("groups")}>小组管理</WorkspaceNavButton>
        <WorkspaceNavButton active={view === "transfer"} icon="transfer" onClick={() => setView("transfer")}>人员调动</WorkspaceNavButton>
        <WorkspaceNavButton active={view === "devices"} icon="devices" onClick={() => setView("devices")}>设备账号</WorkspaceNavButton>
        <WorkspaceNavButton active={view === "notifications"} icon="notifications" onClick={() => setView("notifications")}>通知中心<NotificationBadge count={notificationUnread} /></WorkspaceNavButton>
      </>}>
        {(view === "dashboard" || view === "summary") ? <SmartDateRangeToolbar range={range} from={from} to={to} currentLabel={report?.range.label} loading={loading} title="部门统计日期" onRange={setRange} onFrom={setFrom} onTo={setTo} onRefresh={() => void load()} /> : null}
        {(view === "dashboard" || view === "summary") ? <div className="department-tabs"><button data-active={groupTypeFilter === "HACKER"} onClick={() => { setGroupTypeFilter("HACKER"); setGroupFilter(""); setDetailGroupId(""); }}>黑客组数据</button><button data-active={groupTypeFilter === "LAWYER"} onClick={() => { setGroupTypeFilter("LAWYER"); setGroupFilter(""); setDetailGroupId(""); }}>律师组数据</button></div> : null}
        {loading ? <section className="fresh-sheet-card department-empty">正在读取真实部门数据…</section> : null}
        {error ? <section className="fresh-sheet-card department-error">{error}</section> : null}
        {!loading && !error && view === "dashboard" ? <>
          <section className="department-kpis">
            {(groupTypeFilter === "LAWYER"
              ? [["接粉", departmentTotals.added], ["回复", departmentTotals.replied], ["真实案件", departmentTotals.lawyerRealCase ?? 0], ["添加律师", departmentTotals.lawyerAdded ?? 0], ["总开单", departmentTotals.ordered]]
              : [["有效数据", departmentTotals.effective], ["进群", departmentTotals.joined], ["开单", departmentTotals.ordered], ["当前在群", departmentTotals.inGroup], ["净业绩", money(departmentTotals.netCents)]]
            ).map(([label,value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
          </section>
          <DepartmentTable groupType={groupTypeFilter} title="小组经营概况" rows={filteredGroups.map((group) => ({ name: group.name, people: group.activePeople, totals: group.totals }))} />
        </> : null}
        {!loading && !error && view === "summary" ? <>
          <div className="department-tabs"><button data-active={summaryMode === "group"} aria-pressed={summaryMode === "group"} onClick={() => { setSummaryMode("group"); setDetailGroupId(""); }}>按小组</button><button data-active={summaryMode === "member"} aria-pressed={summaryMode === "member"} onClick={() => { setSummaryMode("member"); setDetailGroupId(""); }}>按归属个人</button><button data-active={summaryMode === "channel"} aria-pressed={summaryMode === "channel"} onClick={() => { setSummaryMode("channel"); setDetailGroupId(""); }}>按渠道</button><button data-active={summaryMode === "day"} aria-pressed={summaryMode === "day"} onClick={() => { setSummaryMode("day"); setDetailGroupId(""); }}>按日期</button>{summaryMode === "member" || summaryMode === "channel" ? <select aria-label={summaryMode === "channel" ? "筛选渠道所属小组" : "筛选成员所属小组"} value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="">全部{groupTypeFilter === "LAWYER" ? "律师组" : "黑客组"}</option>{filteredGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select> : null}</div>
          {summaryMode === "group" ? <><DepartmentTable groupType={groupTypeFilter} title="小组数据汇总" rows={filteredGroups.map((group) => ({ id: group.id, name: group.name, people: group.activePeople, totals: group.totals }))} onRowClick={setDetailGroupId} />{detailGroupId ? <OrgGroupMetricMatrix groupId={detailGroupId} groupName={filteredGroups.find((group) => group.id === detailGroupId)?.name ?? "小组"} groupType={filteredGroups.find((group) => group.id === detailGroupId)?.groupType ?? groupTypeFilter} range={range} from={from} to={to} onClose={() => setDetailGroupId("")} /> : null}</> : summaryMode === "member" ? <DepartmentTable groupType={groupTypeFilter} title="个人归属数据汇总（每人一行）" rows={visibleMembers.map((member) => ({ name: member.name, sub: member.groupName, totals: member.totals }))} /> : summaryMode === "channel" ? channelLoading ? <section className="fresh-sheet-card department-empty">正在读取{selectedGroup?.name ?? "小组"}的渠道数据…</section> : channelError ? <section className="fresh-sheet-card department-error">{channelError}</section> : <><DepartmentTable groupType={groupTypeFilter} title={selectedGroup ? `${selectedGroup.name} · 渠道数据对比` : "全部小组 · 渠道数据对比"} rows={visibleChannels.map((channel) => ({ name: channel.name, sub: selectedGroup ? selectedGroup.name : `覆盖 ${channel.groupCount} 个小组`, totals: channel.totals }))} />{groupTypeFilter === "HACKER" ? <ChannelInsights channels={visibleChannels} scopeName={selectedGroup?.name ?? "全部小组"} /> : null}</> : <DepartmentTable groupType={groupTypeFilter} title="每日数据汇总" rows={(report?.days ?? []).map((day) => ({ name: day.date, totals: addMetricRows(day.groups.filter((group) => group.groupType === groupTypeFilter)) }))} />}
        </> : null}
        {!loading && !error && view === "customers" ? <DepartmentCustomerProgress groups={(report?.groups ?? []).map(({ id, name }) => ({ id, name }))} /> : null}
        {!loading && !error && view === "groups" ? <DepartmentGroupManagement /> : null}
        {!loading && !error && view === "transfer" ? <DepartmentPersonnelTransfer /> : null}
        {!loading && !error && view === "devices" ? <DepartmentDeviceAccounts /> : null}
        {!loading && !error && view === "notifications" ? <UnifiedNotificationCenter onUnreadChange={setNotificationUnread} /> : null}
  </WorkspaceShell>;
}

function DepartmentTable({ groupType, title, rows, onRowClick }: { groupType: "HACKER" | "LAWYER"; title: string; rows: Array<{ id?: string; name: string; sub?: string; people?: number; totals: Metrics }>; onRowClick?: (id: string) => void }) {
  const totals = addMetricRows(rows);
  const peopleValues = rows.flatMap((row) => row.people == null ? [] : [row.people]);
  const totalPeople = peopleValues.length > 0 ? peopleValues.reduce((sum, value) => sum + value, 0) : null;
  if (groupType === "LAWYER") {
    const cells = (value: Metrics, people?: number) => <><td>{people ?? "—"}</td><td>{value.added ?? 0}</td><td>{value.replied ?? 0}</td><td>{Math.max(0, (value.added ?? 0) - (value.replied ?? 0))}</td><td>{value.lowAmount ?? 0}</td><td>{value.lawyerRealCase ?? 0}</td><td>{pct(value.added > 0 ? value.replied / value.added : null)}</td><td>{value.lawyerAdded ?? 0}</td><td>{value.lawyerExpertAdded ?? 0}</td><td>{pct(value.added > 0 ? (value.lawyerAdded ?? 0) / value.added : null)}</td><td>{pct(value.added > 0 ? (value.lawyerExpertAdded ?? 0) / value.added : null)}</td><td>{value.customerServicePush ?? 0}</td><td>{value.registered ?? 0}</td><td>{value.ordered ?? 0}</td><td>{money(value.cryptoDepositCents)}</td><td>{money(value.bankDepositCents)}</td><td>{money(value.withdrawalCents)}</td></>;
    return <section className="fresh-sheet-card department-report"><div className="fresh-sheet-title"><div><h2>{title}</h2><p>{onRowClick ? "点击小组名称查看指标纵向矩阵" : "律师组按接粉归属统计；比例由系统自动计算"}</p></div><div><span>共</span><strong>{rows.length} 行</strong></div></div><div className="department-table-wrap"><table><thead><tr><th>名称</th><th>人数</th><th>接粉</th><th>回复</th><th>未回复</th><th>接粉小金额</th><th>接粉真实案件</th><th>回复率</th><th>添加律师</th><th>添加专家</th><th>添加律师率</th><th>添加专家率</th><th>总推客服数量</th><th>总注册数量</th><th>总开单数量</th><th>加密货币充值金额</th><th>银行卡充值金额</th><th>出金金额</th></tr></thead><tbody>{rows.map((row) => <tr className={onRowClick && row.id ? "metric-clickable-row" : undefined} onClick={() => row.id && onRowClick?.(row.id)} key={`${row.name}-${row.sub ?? ""}`}><td><strong>{row.name}</strong>{onRowClick && row.id ? <button type="button" className="metric-row-drilldown">查看矩阵</button> : null}{row.sub ? <small>{row.sub}</small> : null}</td>{cells(row.totals, row.people)}</tr>)}<tr className="department-total-row"><td><strong>合计</strong><small>当前显示 {rows.length} 行</small></td>{cells(totals, totalPeople ?? undefined)}</tr></tbody></table></div></section>;
  }
  const rates = (value: Metrics) => ({
    reply: value.effective > 0 ? value.replied / value.effective : null,
    join: value.effective > 0 ? value.joined / value.effective : null,
    abnormal: value.joined - value.leftNormal > 0 ? value.leftAbnormal / (value.joined - value.leftNormal) : null,
    registration: value.pushed > 0 ? value.registered / value.pushed : null,
    order: value.registered > 0 ? value.ordered / value.registered : null,
  });

  const rateCells = (value: Metrics) => { const valueRates = rates(value); return <><td>{pct(valueRates.reply)}</td><td>{pct(valueRates.join)}</td><td>{pct(valueRates.abnormal)}</td><td>{pct(valueRates.registration)}</td><td>{pct(valueRates.order)}</td></>; };
  return <section className="fresh-sheet-card department-report"><div className="fresh-sheet-title"><div><h2>{title}</h2><p>{onRowClick ? "点击小组名称查看指标纵向、渠道和组员横向的详细矩阵" : "数量、金额和转化率使用同一批正式数据"}</p></div><div><span>共</span><strong>{rows.length} 行</strong></div></div><div className="department-table-wrap"><table><thead><tr><th>名称</th><th>人数</th><th>添加数据</th><th>撞粉</th><th>低金额</th><th>无 WS 号码</th><th>人工无效</th><th>有效数据</th><th>回复</th><th>进群</th><th>正常退群</th><th>异常退群</th><th>当前在群</th><th>推专家</th><th>注册</th><th>开单</th><th>回复率</th><th>进群率</th><th>异常退群率</th><th>注册率</th><th>开单率</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th></tr></thead><tbody>{rows.map((row) => <tr className={onRowClick && row.id ? "metric-clickable-row" : undefined} onClick={() => row.id && onRowClick?.(row.id)} key={`${row.name}-${row.sub ?? ""}`}><td><strong>{row.name}</strong>{onRowClick && row.id ? <button type="button" className="metric-row-drilldown">查看矩阵</button> : null}{row.sub ? <small>{row.sub}</small> : null}</td><td>{row.people ?? "—"}</td><td>{row.totals.added ?? 0}</td><td>{row.totals.collision ?? 0}</td><td>{row.totals.lowAmount ?? 0}</td><td>{row.totals.noWs ?? 0}</td><td>{row.totals.manualInvalid ?? 0}</td><td><strong>{row.totals.effective ?? 0}</strong></td><td>{row.totals.replied ?? 0}</td><td>{row.totals.joined ?? 0}</td><td>{row.totals.leftNormal ?? 0}</td><td>{row.totals.leftAbnormal ?? 0}</td><td>{row.totals.inGroup ?? 0}</td><td>{row.totals.pushed ?? 0}</td><td>{row.totals.registered ?? 0}</td><td>{row.totals.ordered ?? 0}</td>{rateCells(row.totals)}<td>{money(row.totals.initialDepositCents)}</td><td>{money(row.totals.rechargeCents)}</td><td>{money(row.totals.withdrawalCents)}</td><td><strong>{money(row.totals.netCents)}</strong></td></tr>)}<tr className="department-total-row"><td><strong>合计</strong><small>当前显示 {rows.length} 行</small></td><td>{totalPeople ?? "—"}</td><td>{totals.added ?? 0}</td><td>{totals.collision ?? 0}</td><td>{totals.lowAmount ?? 0}</td><td>{totals.noWs ?? 0}</td><td>{totals.manualInvalid ?? 0}</td><td><strong>{totals.effective ?? 0}</strong></td><td>{totals.replied ?? 0}</td><td>{totals.joined ?? 0}</td><td>{totals.leftNormal ?? 0}</td><td>{totals.leftAbnormal ?? 0}</td><td>{totals.inGroup ?? 0}</td><td>{totals.pushed ?? 0}</td><td>{totals.registered ?? 0}</td><td>{totals.ordered ?? 0}</td>{rateCells(totals)}<td>{money(totals.initialDepositCents)}</td><td>{money(totals.rechargeCents)}</td><td>{money(totals.withdrawalCents)}</td><td><strong>{money(totals.netCents)}</strong></td></tr></tbody></table></div></section>;
}

function ChannelInsights({ channels, scopeName }: { channels: ReportChannel[]; scopeName: string }) {
  const active = channels.filter((channel) => channel.totals.added > 0 || channel.totals.ordered > 0 || channel.totals.netCents !== 0);
  if (!active.length) {
    return <section className="analysis-insights"><header><div><h2>渠道智能分析</h2><p>{scopeName} · 只根据已生效数据生成</p></div></header><div><article data-tone="info"><i>i</i><div><strong>当前没有可比较数据</strong><p>继续填写后，系统会自动比较各渠道，不会用全 0 数据乱下结论。</p></div></article></div></section>;
  }
  const byNet = [...active].sort((left, right) => right.totals.netCents - left.totals.netCents);
  const orderRate = (channel: ReportChannel) => channel.totals.effective > 0 ? channel.totals.ordered / channel.totals.effective : null;
  const comparableOrders = active.filter((channel) => orderRate(channel) !== null).sort((left, right) => orderRate(right)! - orderRate(left)!);
  const abnormalRate = (channel: ReportChannel) => {
    const base = channel.totals.joined - channel.totals.leftNormal;
    return base > 0 ? channel.totals.leftAbnormal / base : null;
  };
  const abnormal = active.filter((channel) => abnormalRate(channel) !== null).sort((left, right) => abnormalRate(right)! - abnormalRate(left)!)[0];
  const netHasDifference = byNet.length > 1 && byNet[0].totals.netCents !== byNet.at(-1)!.totals.netCents;
  const orderHasDifference = comparableOrders.length > 1 && orderRate(comparableOrders[0]) !== orderRate(comparableOrders.at(-1)!);
  return <section className="analysis-insights"><header><div><h2>渠道智能分析</h2><p>{scopeName} · 结论可回到上方表格逐项核对</p></div></header><div>
    {netHasDifference ? <><article data-tone="good"><i>✓</i><div><strong>当前净业绩最高：{byNet[0].name}</strong><p>净业绩 {money(byNet[0].totals.netCents)}，开单 {byNet[0].totals.ordered} 个。</p></div></article><article data-tone="warn"><i>!</i><div><strong>当前净业绩最低：{byNet.at(-1)!.name}</strong><p>净业绩 {money(byNet.at(-1)!.totals.netCents)}，与最高渠道相差 {money(byNet[0].totals.netCents - byNet.at(-1)!.totals.netCents)}。</p></div></article></> : <article data-tone="info"><i>i</i><div><strong>各渠道净业绩暂未拉开差距</strong><p>当前可比较渠道的净业绩相同，暂不判定最佳或最低渠道。</p></div></article>}
    {orderHasDifference ? <article data-tone="info"><i>i</i><div><strong>开单转化差距</strong><p>{comparableOrders[0].name} {pct(orderRate(comparableOrders[0]))}，{comparableOrders.at(-1)!.name} {pct(orderRate(comparableOrders.at(-1)!))}。</p></div></article> : null}
    {abnormal && abnormalRate(abnormal)! > 0 ? <article data-tone="warn"><i>!</i><div><strong>异常退群需关注：{abnormal.name}</strong><p>异常退群率 {pct(abnormalRate(abnormal))}，异常退群 {abnormal.totals.leftAbnormal} 人。</p></div></article> : null}
  </div></section>;
}
