import { redirect } from "next/navigation";
import { ArrowsClockwise, DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { getSystemSettings } from "../../../lib/settings";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { EmploymentSourcePanel } from "../../../components/finance/EmploymentSourcePanel";
import { FinanceDailyReportToolbar } from "../../../components/finance/FinanceDailyReportToolbar";
import { resolveReadableReportGroups } from "../../../lib/report-scope";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : "";
const monthOnly = /^\d{4}-\d{2}$/;

function monthRange(month: string) {
  const [year, value] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
  return { from: `${month}-01`, to: lastDay };
}

export default async function FinanceReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/finance-reports"); throw error; }
  if (!["ADMIN", "COMPANY_MANAGER", "FINANCE", "LEAD"].includes(user.role)) redirect("/dashboard");
  const [raw, settings, groups, employmentMembers] = await Promise.all([
    searchParams,
    getSystemSettings(),
    db.teamGroup.findMany({
      select: { id: true, name: true, departmentId: true, countryCode: true, timezone: true, department: { select: { countryCode: true, companyId: true, timezone: true } } }, orderBy: { name: "asc" },
    }),
    ["ADMIN", "FINANCE"].includes(user.role)
      ? db.user.findMany({
        where: { active: true, groupId: { not: null }, role: { in: ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] } },
        select: { id: true, name: true, role: true, hireDate: true, recruitmentSource: true, referrerName: true, group: { select: { name: true, department: { select: { name: true } } } } },
        orderBy: [{ group: { department: { name: "asc" } } }, { group: { name: "asc" } }, { name: "asc" }],
      })
      : Promise.resolve([]),
  ]);
  const readableGroups = resolveReadableReportGroups(user, groups);
  const groupId = first(raw.groupId);
  const selectedGroupId = readableGroups.some((group) => group.id === groupId) ? groupId : "";
  const accountTimezone = await resolveUserBusinessTimezone(user, settings.timezone);
  const readableTimezones = [...new Set(readableGroups.map((group) => group.timezone ?? group.department.timezone))];
  const defaultReportTimezone = readableTimezones.length === 1 ? readableTimezones[0] : accountTimezone;
  const selectedTimezone = readableGroups.find((group) => group.id === selectedGroupId)?.timezone
    ?? readableGroups.find((group) => group.id === selectedGroupId)?.department.timezone
    ?? defaultReportTimezone;
  const today = localDateYYYYMMDD(new Date(), selectedTimezone);
  const selectedMonth = monthOnly.test(first(raw.month)) ? first(raw.month) : today.slice(0, 7);
  const range = monthRange(selectedMonth);
  const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(first(raw.date)) ? first(raw.date) : today;
  const exportUrl = new URLSearchParams({ from: range.from, to: range.to, ...(selectedGroupId ? { groupId: selectedGroupId } : {}) });
  const dailyGroups = readableGroups.map((group) => ({ id: group.id, name: group.name, timezone: group.timezone ?? group.department.timezone }));
  return <main className="page-shell workflow-wide-page data-center-page space-y-2">
    <div className="page-heading"><div><h1 className="page-title">数据报表</h1><p className="page-description">组长只能导出本组；财务、公司管理员和总公司管理员可按权限筛选小组。</p></div></div>
    <section className="rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="m-0 text-base font-bold text-slate-900">每日数据报表</h2><p className="mb-0 mt-1 text-sm text-slate-600">选择小组后自动切换到该小组当地今天；流程和资金统一按小组时区归档。</p></div><FinanceDailyReportToolbar groups={dailyGroups} initialGroupId={selectedGroupId} initialDate={selectedDate} fallbackTimezone={defaultReportTimezone} canSelectGroup={user.role !== "LEAD"} /></div></section>
    <div className="mt-5 border-t border-slate-200 pt-4"><h2 className="m-0 text-base font-bold text-slate-900">月度业绩报表</h2><p className="mb-3 mt-1 text-sm text-slate-600">导出当月小组汇总和每位成员的每日明细。</p></div>
    <form className="toolbar" action="/finance-reports">
      <label className="field-label">统计月份<input className="control" name="month" type="month" defaultValue={selectedMonth} /></label>
      {user.role !== "LEAD" && <label className="field-label">小组<select className="control min-w-40" name="groupId" defaultValue={selectedGroupId}><option value="">全部小组</option>{readableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
      <div className="finance-report-actions">
        <button className="report-toolbar-button finance-report-refresh" type="submit"><ArrowsClockwise size={16} weight="bold" aria-hidden="true" />更新范围</button>
        <a className="report-toolbar-button report-toolbar-primary finance-report-export" href={`/api/exports/member-performance?${exportUrl.toString()}`}><DownloadSimple size={17} weight="bold" aria-hidden="true" />导出 Excel</a>
      </div>
    </form>
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600"><strong className="text-slate-900">导出内容：</strong>日报和月报的第 1 张表均含小组汇总、来源业绩汇总和成员汇总；后面每位成员各有一张明细表。文件可直接用 Excel 打开。</section>
    {["ADMIN", "FINANCE"].includes(user.role) && <EmploymentSourcePanel members={employmentMembers.flatMap((member) => member.group ? [{ id: member.id, name: member.name, roleLabel: member.role === "LEAD" ? "组长" : member.role === "RECEPTION" ? "前台接粉" : member.role === "GROUP_OPERATOR" ? "前台炒群" : "前台专家", departmentName: member.group.department.name, groupName: member.group.name, hireDate: member.hireDate, recruitmentSource: member.recruitmentSource, referrerName: member.referrerName }] : [])} />}
  </main>;
}
