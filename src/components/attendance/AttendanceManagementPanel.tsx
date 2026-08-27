import { attendanceStatusLabel } from "../../lib/attendance";
import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

type Row = {
  id: string;
  name: string;
  role: "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
  groupName: string;
  departmentName: string;
  timezone: string;
  record: { clockInAt: Date | null; clockOutAt: Date | null; clockInStatus: "NORMAL" | "LATE" | "EARLY" | null; clockOutStatus: "NORMAL" | "LATE" | "EARLY" | null; leaveType: "PERSONAL" | "SICK" | "OTHER" | null; leaveReason: string | null; leaveAt: Date | null } | null;
};

const roleNames = { LEAD: "组长", RECEPTION: "前台接粉", GROUP_OPERATOR: "前台炒群", EXPERT: "前台专家" } as const;
const leaveNames = { PERSONAL: "事假", SICK: "病假", OTHER: "其他请假" } as const;
function clock(value: Date | null, timezone: string) {
  return value ? new Intl.DateTimeFormat("zh-CN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(value) : "—";
}
function hours(row: Row) {
  if (!row.record?.clockInAt || !row.record.clockOutAt) return "—";
  const minutes = Math.max(0, Math.round((row.record.clockOutAt.getTime() - row.record.clockInAt.getTime()) / 60000));
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}
function Status({ value }: { value: "NORMAL" | "LATE" | "EARLY" | null }) {
  const warning = value === "LATE" || value === "EARLY";
  return <span className={warning ? "font-semibold text-amber-700" : value ? "font-semibold text-emerald-700" : "text-slate-400"}>{attendanceStatusLabel(value)}</span>;
}

export function AttendanceManagementPanel({ rows, groups, departments, role, selectedDate, selectedGroupId, selectedDepartmentId }: { rows: Row[]; groups: { id: string; name: string; departmentId: string; departmentName: string }[]; departments: { id: string; name: string }[]; role: "ADMIN" | "COMPANY_MANAGER" | "FINANCE" | "HR"; selectedDate: string; selectedGroupId: string; selectedDepartmentId: string }) {
  const clockedIn = rows.filter((row) => row.record?.clockInAt).length;
  const leaveCount = rows.filter((row) => row.record?.leaveAt).length;
  const late = rows.filter((row) => row.record?.clockInStatus === "LATE").length;
  const early = rows.filter((row) => row.record?.clockOutStatus === "EARLY").length;
  const globalViewer = role === "ADMIN" || role === "FINANCE" || role === "HR";
  const filteredGroups = globalViewer && selectedDepartmentId ? groups.filter((group) => group.departmentId === selectedDepartmentId) : groups;
  const monthlyExport = new URLSearchParams({ month: selectedDate.slice(0, 7), ...(selectedDepartmentId ? { departmentId: selectedDepartmentId } : {}), ...(selectedGroupId ? { groupId: selectedGroupId } : {}) });
  return <main className="page-shell workflow-wide-page space-y-3"><div className="page-heading"><div><h1 className="page-title">考勤管理</h1><p className="page-description">只读查看员工上下班打卡。{globalViewer ? "可查看全部公司。" : "只显示本公司的小组与员工。"}</p></div></div><form className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"><label className="field-label">日期<input name="date" type="date" defaultValue={selectedDate} className="control mt-1" /></label>{globalViewer ? <label className="field-label">下属公司<select name="departmentId" defaultValue={selectedDepartmentId} className="control mt-1"><option value="">全部公司</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label> : null}<label className="field-label">小组<select name="groupId" defaultValue={selectedGroupId} className="control mt-1"><option value="">全部小组</option>{filteredGroups.map((group) => <option key={group.id} value={group.id}>{globalViewer ? `${group.departmentName} / ` : ""}{group.name}</option>)}</select></label><div className="report-toolbar-actions"><button className="report-toolbar-button report-toolbar-primary"><MagnifyingGlass size={16} weight="bold" aria-hidden="true" />查询</button><a className="report-toolbar-button report-toolbar-export" href={`/api/exports/attendance?${monthlyExport.toString()}`}><DownloadSimple size={17} weight="bold" aria-hidden="true" />导出月度考勤</a></div></form><section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="grid divide-x divide-slate-100 sm:grid-cols-6"><Stat label="应上班" value={rows.length} /><Stat label="已上班" value={clockedIn} /><Stat label="已请假" value={leaveCount} /><Stat label="未打卡" value={rows.length - clockedIn - leaveCount} tone={rows.length - clockedIn - leaveCount ? "red" : undefined} /><Stat label="迟到" value={late} tone={late ? "amber" : undefined} /><Stat label="早退" value={early} tone={early ? "amber" : undefined} /></div></section><section className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h2 className="m-0 text-base font-bold text-slate-900">员工打卡明细</h2><p className="mb-0 mt-1 text-xs text-slate-500">工作时长按实际上、下班时间计算；跨时区的小组分别按当地时间展示。</p></div><div className="data-table-wrap"><table className="data-table min-w-[970px]"><thead><tr><th>公司 / 小组</th><th>姓名</th><th>岗位</th><th>上班时间</th><th>上班状态</th><th>下班时间</th><th>下班状态</th><th>工作时长</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><span className="font-medium text-slate-800">{row.groupName}</span>{globalViewer ? <span className="mt-0.5 block text-xs text-slate-500">{row.departmentName}</span> : null}</td><td className="font-semibold text-slate-900">{row.name}</td><td>{roleNames[row.role]}</td><td>{row.record?.leaveAt ? "已请假" : clock(row.record?.clockInAt ?? null, row.timezone)}</td><td>{row.record?.leaveAt ? <span className="font-semibold text-violet-700">{leaveNames[row.record.leaveType as keyof typeof leaveNames]}</span> : <Status value={row.record?.clockInStatus ?? null} />}</td><td>{clock(row.record?.clockOutAt ?? null, row.timezone)}</td><td><Status value={row.record?.clockOutStatus ?? null} /></td><td>{hours(row)}</td></tr>)}{!rows.length ? <tr><td colSpan={8} className="empty-state">当前筛选范围内没有启用中的员工</td></tr> : null}</tbody></table></div></section></main>;
}
function Stat({ label, value, tone }: { label: string; value: number; tone?: "red" | "amber" }) { return <div className="px-4 py-3"><p className="m-0 text-xs text-slate-500">{label}</p><p className={tone === "red" ? "mb-0 mt-1 text-xl font-bold text-red-600" : tone === "amber" ? "mb-0 mt-1 text-xl font-bold text-amber-700" : "mb-0 mt-1 text-xl font-bold text-slate-900"}>{value}</p></div>; }
