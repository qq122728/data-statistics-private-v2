import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { attendanceRoles } from "../../../../lib/attendance";
import { db } from "../../../../lib/db";
import { buildAttendanceWorkbook } from "../../../../lib/attendance-report-xlsx";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { resolveReadableReportGroups } from "../../../../lib/report-scope";

const monthOnly = /^\d{4}-\d{2}$/;
export const runtime = "nodejs";

function bounds(month: string) {
  const [year, monthValue] = month.split("-").map(Number);
  return { from: `${month}-01`, to: new Date(Date.UTC(year, monthValue, 0)).toISOString().slice(0, 10) };
}

export async function GET(request: Request) {
  let user;
  try { user = await requireUser(); }
  catch (error) { return NextResponse.json({ error: error instanceof AuthenticationError ? "请先登录" : "无法确认账号" }, { status: 401 }); }
  if (!(new Set<string>(["ADMIN", "COMPANY_MANAGER", "FINANCE", "HR", "LEAD"])).has(user.role)) return authorizationDenied(user, "没有导出考勤的权限");
  const url = new URL(request.url);
  if (hasOversizedQueryValue(url.searchParams)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const month = url.searchParams.get("month") ?? "";
  if (!monthOnly.test(month)) return NextResponse.json({ error: "请选择正确的统计月份" }, { status: 400 });
  const requestedDepartmentId = url.searchParams.get("departmentId") ?? "";
  const requestedGroupId = url.searchParams.get("groupId") ?? "";
  const allGroups = await db.teamGroup.findMany({
    where: requestedDepartmentId && user.role !== "COMPANY_MANAGER" && user.role !== "LEAD" ? { departmentId: requestedDepartmentId } : {},
    select: { id: true, departmentId: true, countryCode: true, department: { select: { countryCode: true, companyId: true } } },
  });
  const groups = user.role === "HR" ? allGroups : resolveReadableReportGroups(user, allGroups);
  const groupIds = requestedGroupId ? groups.some((group) => group.id === requestedGroupId) ? [requestedGroupId] : [] : groups.map((group) => group.id);
  if (!groupIds.length) return NextResponse.json({ error: "当前筛选范围没有可导出的员工" }, { status: 400 });
  const range = bounds(month);
  const [members, records] = await Promise.all([
    db.user.findMany({ where: { active: true, groupId: { in: groupIds }, role: { in: [...attendanceRoles] } }, select: { id: true, name: true, role: true, hireDate: true, recruitmentSource: true, referrerName: true, group: { select: { name: true, department: { select: { name: true } } } }, }, orderBy: [{ group: { department: { name: "asc" } } }, { group: { name: "asc" } }, { name: "asc" }] }),
    db.attendanceRecord.findMany({ where: { groupId: { in: groupIds }, businessDate: { gte: range.from, lte: range.to } }, select: { userId: true, businessDate: true, clockInAt: true, clockInStatus: true, clockOutStatus: true, leaveAt: true } }),
  ]);
  const workbook = await buildAttendanceWorkbook({
    month,
    members: members.flatMap((member) => member.group ? [{ id: member.id, name: member.name, role: member.role as typeof attendanceRoles[number], groupName: member.group.name, departmentName: member.group.department.name, hireDate: member.hireDate, recruitmentSource: member.recruitmentSource, referrerName: member.referrerName }] : []),
    records,
  });
  const bytes = await workbook.xlsx.writeBuffer();
  const fileName = `月度考勤报表-${month}.xlsx`;
  return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`, "Cache-Control": "no-store" } });
}
