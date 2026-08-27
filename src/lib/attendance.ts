import type { User } from "@prisma/client";
import { db } from "./db";
import { attendanceWriteRoles } from "./permissions";
import { businessWorkStatus, localClockMinutes, resolveGroupBusinessTime, type BusinessTimeConfig } from "./business-time";

export const attendanceRoles = attendanceWriteRoles;
export type AttendanceRole = (typeof attendanceRoles)[number];

export function canUseAttendance(role: User["role"]): role is AttendanceRole {
  return attendanceRoles.includes(role as AttendanceRole);
}

export type AttendanceContext = {
  group: { id: string; name: string };
  businessTime: BusinessTimeConfig;
  businessDate: string;
  localTime: string;
};

export async function getAttendanceContext(user: Pick<User, "groupId">): Promise<AttendanceContext | null> {
  if (!user.groupId) return null;
  const group = await db.teamGroup.findFirst({
    where: { id: user.groupId, active: true },
    select: {
      id: true,
      name: true,
      countryCode: true,
      timezone: true,
      workStartMinutes: true,
      workEndMinutes: true,
      department: { select: { countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
    },
  });
  if (!group) return null;
  const businessTime = resolveGroupBusinessTime(group);
  const status = businessWorkStatus(businessTime);
  return { group: { id: group.id, name: group.name }, businessTime, businessDate: status.businessDate, localTime: status.localTime };
}

export function clockInStatus(config: BusinessTimeConfig, now = new Date()) {
  return localClockMinutes(now, config.timezone) > config.workStartMinutes ? "LATE" as const : "NORMAL" as const;
}

export function clockOutStatus(config: BusinessTimeConfig, now = new Date()) {
  return localClockMinutes(now, config.timezone) < config.workEndMinutes ? "EARLY" as const : "NORMAL" as const;
}

export function attendanceStatusLabel(status: "NORMAL" | "LATE" | "EARLY" | null | undefined) {
  if (status === "LATE") return "迟到";
  if (status === "EARLY") return "早退";
  if (status === "NORMAL") return "正常";
  return "—";
}
