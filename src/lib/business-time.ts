import type { User } from "@prisma/client";
import { db } from "./db";
import { resolveGroupBusinessTime } from "./business-time-config";
import { statisticsDate } from "./statistics-date";

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

type BusinessTimeClient = Pick<typeof db, "teamGroup">;

/** 管理操作和跨组报表必须按目标小组取时区，不能按操作人所在地取日期。 */
export async function resolveGroupBusinessTimezone(
  groupId: string | null | undefined,
  fallbackTimezone: string,
  client: BusinessTimeClient = db,
): Promise<string> {
  if (!groupId) return fallbackTimezone;
  const group = await client.teamGroup.findUnique({
    where: { id: groupId },
    select: {
      countryCode: true,
      timezone: true,
      workStartMinutes: true,
      workEndMinutes: true,
      department: { select: { countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
    },
  });
  return group ? resolveGroupBusinessTime(group).timezone : fallbackTimezone;
}

export async function resolveGroupBusinessDate(
  groupId: string | null | undefined,
  fallbackTimezone: string,
  now = new Date(),
  client: BusinessTimeClient = db,
): Promise<string> {
  void groupId;
  void fallbackTimezone;
  void client;
  return statisticsDate(now);
}
