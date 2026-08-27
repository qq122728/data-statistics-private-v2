import type { User } from "@prisma/client";
import { db } from "./db";
import { resolveGroupBusinessTime } from "./business-time-config";

export * from "./business-time-config";

export async function resolveUserBusinessTimezone(user: Pick<User, "groupId" | "departmentId">, fallbackTimezone: string): Promise<string> {
  if (user.groupId) {
    if (typeof db?.teamGroup?.findUnique !== "function") return fallbackTimezone;
    const group = await db.teamGroup.findUnique({
      where: { id: user.groupId },
      select: { countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true, department: { select: { countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } } },
    });
    if (group) return resolveGroupBusinessTime(group).timezone;
  }
  if (user.departmentId) {
    if (typeof db?.department?.findUnique !== "function") return fallbackTimezone;
    const department = await db.department.findUnique({ where: { id: user.departmentId }, select: { timezone: true } });
    if (department) return department.timezone;
  }
  return fallbackTimezone;
}
