import { redirect } from "next/navigation";
import { AttendancePanel } from "../../../components/attendance/AttendancePanel";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { attendanceRoles, canUseAttendance, getAttendanceContext } from "../../../lib/attendance";
import { db } from "../../../lib/db";
import { minutesToTime } from "../../../lib/business-time";
import { AttendanceManagementPanel } from "../../../components/attendance/AttendanceManagementPanel";
import { resolveReadableReportGroups } from "../../../lib/report-scope";
import { resolveGroupBusinessTime } from "../../../lib/business-time";
import { getSystemSettings } from "../../../lib/settings";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { resolveUserBusinessTimezone } from "../../../lib/business-time";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;

export default async function AttendancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/attendance"); throw error; }
  const canManage = user.role === "ADMIN" || user.role === "COMPANY_MANAGER" || user.role === "FINANCE" || user.role === "HR";
  if (!canUseAttendance(user.role) && !canManage) redirect("/dashboard");
  if (canManage) {
    const [raw, settings, allGroups, departments] = await Promise.all([
      searchParams, getSystemSettings(),
      db.teamGroup.findMany({ where: { active: true }, select: { id: true, name: true, departmentId: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, department: { select: { countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, name: true, companyId: true } } }, orderBy: [{ department: { name: "asc" } }, { name: "asc" }] }),
      db.department.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);
    // 行政只使用考勤与人员档案，不继承任何经营报表权限；考勤范围在这里单独放行。
    const readableGroups = user.role === "HR" ? allGroups : resolveReadableReportGroups(user, allGroups);
    const date = first(raw.date) && /^\d{4}-\d{2}-\d{2}$/.test(first(raw.date)!) ? first(raw.date)! : localDateYYYYMMDD(new Date(), await resolveUserBusinessTimezone(user, settings.timezone));
    const selectedDepartmentId = user.role === "ADMIN" || user.role === "FINANCE" || user.role === "HR" ? first(raw.departmentId) ?? "" : user.departmentId ?? "";
    const groupsInDepartment = selectedDepartmentId ? readableGroups.filter((group) => group.departmentId === selectedDepartmentId) : readableGroups;
    const requestedGroupId = first(raw.groupId) ?? "";
    const groupIds = requestedGroupId && groupsInDepartment.some((group) => group.id === requestedGroupId) ? [requestedGroupId] : groupsInDepartment.map((group) => group.id);
    const [members, records] = await Promise.all([
      db.user.findMany({ where: { active: true, groupId: { in: groupIds }, role: { in: [...attendanceRoles] } }, select: { id: true, name: true, role: true, groupId: true }, orderBy: [{ groupId: "asc" }, { role: "asc" }, { name: "asc" }] }),
      db.attendanceRecord.findMany({ where: { groupId: { in: groupIds }, businessDate: date }, select: { userId: true, clockInAt: true, clockOutAt: true, clockInStatus: true, clockOutStatus: true, leaveType: true, leaveReason: true, leaveAt: true } }),
    ]);
    const groupsById = new Map(readableGroups.map((group) => [group.id, group]));
    const recordsByUserId = new Map(records.map((record) => [record.userId, record]));
    const rows = members.flatMap((member) => {
      const group = member.groupId ? groupsById.get(member.groupId) : undefined;
      if (!group) return [];
      return [{ id: member.id, name: member.name, role: member.role as typeof attendanceRoles[number], groupName: group.name, departmentName: group.department.name, timezone: resolveGroupBusinessTime(group).timezone, record: recordsByUserId.get(member.id) ?? null }];
    });
    return <AttendanceManagementPanel rows={rows} groups={readableGroups.map((group) => ({ id: group.id, name: group.name, departmentId: group.departmentId, departmentName: group.department.name }))} departments={departments} role={user.role as "ADMIN" | "COMPANY_MANAGER" | "FINANCE" | "HR"} selectedDate={date} selectedGroupId={groupIds.length === 1 ? groupIds[0] : ""} selectedDepartmentId={selectedDepartmentId} />;
  }
  const context = await getAttendanceContext(user);
  if (!context) return <main className="page-shell"><section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900"><h1 className="m-0 text-lg font-bold">暂时无法打卡</h1><p className="mb-0 mt-1 text-sm">当前账号没有归属启用中的小组，请联系组长或公司管理员处理。</p></section></main>;
  const [record, members] = await Promise.all([
    db.attendanceRecord.findUnique({ where: { userId_businessDate: { userId: user.id, businessDate: context.businessDate } }, select: { clockInAt: true, clockOutAt: true, clockInStatus: true, clockOutStatus: true, leaveType: true, leaveReason: true, leaveAt: true } }),
    user.role === "LEAD" ? db.user.findMany({ where: { groupId: context.group.id, active: true, role: { in: [...attendanceRoles] } }, select: { id: true, name: true, role: true, attendanceRecords: { where: { businessDate: context.businessDate }, select: { clockInAt: true, clockOutAt: true, clockInStatus: true, clockOutStatus: true, leaveType: true, leaveReason: true, leaveAt: true } } }, orderBy: [{ role: "asc" }, { name: "asc" }] }) : Promise.resolve([]),
  ]);
  return <main className="page-shell"><AttendancePanel businessDate={context.businessDate} localTime={context.localTime} timezone={context.businessTime.timezone} groupName={context.group.name} scheduleLabel={`${minutesToTime(context.businessTime.workStartMinutes)}–${minutesToTime(context.businessTime.workEndMinutes)}`} initialRecord={record} isLead={user.role === "LEAD"} team={members.map((member) => ({ id: member.id, name: member.name, role: member.role as typeof attendanceRoles[number], record: member.attendanceRecords[0] ?? null }))} /></main>;
}
