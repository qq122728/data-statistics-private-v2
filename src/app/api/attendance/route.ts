import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { recordAudit } from "../../../lib/audit";
import { attendanceRoles, canUseAttendance, clockInStatus, clockOutStatus, getAttendanceContext } from "../../../lib/attendance";
import { db } from "../../../lib/db";
import { canWriteAttendance, findLivePermissionUser } from "../../../lib/permissions";
import { authorizationDenied, type SecurityEventActor } from "../../../lib/security-events";

type AttendanceAction = "CLOCK_IN" | "CLOCK_OUT" | "REQUEST_LEAVE";

async function getAuthenticatedUser() {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return null;
    throw error;
  }
}

function forbidden(actor: SecurityEventActor, message = "只有一线员工和组长可以使用上下班打卡") {
  return authorizationDenied(actor, message);
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!canUseAttendance(user.role)) return forbidden(user);
  const context = await getAttendanceContext(user);
  if (!context) return forbidden(user, "当前账号没有归属启用中的小组，无法打卡");

  const [record, groupMembers] = await Promise.all([
    db.attendanceRecord.findUnique({
      where: { userId_businessDate: { userId: user.id, businessDate: context.businessDate } },
      select: { clockInAt: true, clockOutAt: true, clockInStatus: true, clockOutStatus: true, leaveType: true, leaveReason: true, leaveAt: true },
    }),
    user.role === "LEAD"
      ? db.user.findMany({
        where: { groupId: context.group.id, active: true, role: { in: [...attendanceRoles] } },
        select: {
          id: true,
          name: true,
          role: true,
          attendanceRecords: {
            where: { businessDate: context.businessDate },
            select: { clockInAt: true, clockOutAt: true, clockInStatus: true, clockOutStatus: true, leaveType: true, leaveReason: true, leaveAt: true },
          },
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({
    businessDate: context.businessDate,
    localTime: context.localTime,
    timezone: context.businessTime.timezone,
    groupName: context.group.name,
    workStartMinutes: context.businessTime.workStartMinutes,
    workEndMinutes: context.businessTime.workEndMinutes,
    record,
    team: groupMembers.map((member) => ({ ...member, record: member.attendanceRecords[0] ?? null, attendanceRecords: undefined })),
  });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!canUseAttendance(user.role)) return forbidden(user);
  let body: { action?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 }); }
  if (body.action !== "CLOCK_IN" && body.action !== "CLOCK_OUT" && body.action !== "REQUEST_LEAVE") return NextResponse.json({ error: "请选择上班打卡、下班打卡或请假" }, { status: 400 });
  const context = await getAttendanceContext(user);
  if (!context) return forbidden(user, "当前账号没有归属启用中的小组，无法打卡");

  const leaveType = body.action === "REQUEST_LEAVE" && (body as { leaveType?: unknown }).leaveType;
  const leaveReason = body.action === "REQUEST_LEAVE" && typeof (body as { leaveReason?: unknown }).leaveReason === "string" ? (body as { leaveReason: string }).leaveReason.trim() : "";
  if (body.action === "REQUEST_LEAVE" && leaveType !== "PERSONAL" && leaveType !== "SICK" && leaveType !== "OTHER") return NextResponse.json({ error: "请选择请假类型" }, { status: 400 });
  if (body.action === "REQUEST_LEAVE" && (leaveReason.length < 2 || leaveReason.length > 300)) return NextResponse.json({ error: "请假原因需填写 2–300 个字" }, { status: 400 });
  const now = new Date();
  const result = await db.$transaction(async (client) => {
    // 会话里的岗位可能已经过期；写入前只信数据库中仍启用的真实账号。
    const actor = await findLivePermissionUser(client, user.id);
    if (!actor || !canWriteAttendance(actor) || actor.groupId !== context.group.id) {
      return { error: "当前账号已停用或岗位/小组已变更，不能继续打卡", status: 403 as const };
    }
    const existing = await client.attendanceRecord.findUnique({
      where: { userId_businessDate: { userId: user.id, businessDate: context.businessDate } },
    });
    if (body.action === "REQUEST_LEAVE") {
      if (existing?.clockInAt) return { error: "已完成上班打卡，不能再申请当天请假", status: 409 as const };
      if (existing?.leaveAt) return { error: "今天已经提交过请假", status: 409 as const };
      const record = await client.attendanceRecord.upsert({
        where: { userId_businessDate: { userId: user.id, businessDate: context.businessDate } },
        update: { leaveType: leaveType as "PERSONAL" | "SICK" | "OTHER", leaveReason, leaveAt: now },
        create: { userId: user.id, groupId: context.group.id, businessDate: context.businessDate, timezone: context.businessTime.timezone, scheduledStartMinutes: context.businessTime.workStartMinutes, scheduledEndMinutes: context.businessTime.workEndMinutes, leaveType: leaveType as "PERSONAL" | "SICK" | "OTHER", leaveReason, leaveAt: now },
      });
      await recordAudit(client, { actorId: user.id, action: "ATTENDANCE_LEAVE_REQUESTED", entityType: "AttendanceRecord", entityId: record.id, summary: { businessDate: context.businessDate, groupId: context.group.id, leaveType } });
      return { record };
    }
    if (existing?.leaveAt) return { error: "今天已请假，不能再打卡", status: 409 as const };
    if (body.action === "CLOCK_IN") {
      if (existing?.clockInAt) return { error: "今天已经完成上班打卡", status: 409 as const };
      const status = clockInStatus(context.businessTime, now);
      const record = await client.attendanceRecord.upsert({
        where: { userId_businessDate: { userId: user.id, businessDate: context.businessDate } },
        update: { clockInAt: now, clockInStatus: status },
        create: {
          userId: user.id,
          groupId: context.group.id,
          businessDate: context.businessDate,
          timezone: context.businessTime.timezone,
          scheduledStartMinutes: context.businessTime.workStartMinutes,
          scheduledEndMinutes: context.businessTime.workEndMinutes,
          clockInAt: now,
          clockInStatus: status,
        },
      });
      await recordAudit(client, { actorId: user.id, action: "ATTENDANCE_CLOCK_IN", entityType: "AttendanceRecord", entityId: record.id, summary: { businessDate: context.businessDate, groupId: context.group.id, status } });
      return { record };
    }
    if (!existing?.clockInAt) return { error: "请先完成上班打卡，再进行下班打卡", status: 400 as const };
    if (existing.clockOutAt) return { error: "今天已经完成下班打卡", status: 409 as const };
    const status = clockOutStatus(context.businessTime, now);
    const record = await client.attendanceRecord.update({
      where: { id: existing.id },
      data: { clockOutAt: now, clockOutStatus: status },
    });
    await recordAudit(client, { actorId: user.id, action: "ATTENDANCE_CLOCK_OUT", entityType: "AttendanceRecord", entityId: record.id, summary: { businessDate: context.businessDate, groupId: context.group.id, status } });
    return { record };
  }, { isolationLevel: "Serializable" });
  if ("error" in result) return result.status === 403 ? authorizationDenied(user, result.error) : NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
