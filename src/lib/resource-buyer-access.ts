import { NextResponse } from "next/server";
import { AuthenticationError, requireUser } from "./auth";
import { db } from "./db";
import { hasAssignedRole } from "./role-access";
import { authorizationDenied } from "./security-events";
export type BuyerAccess = { actorId: string; canWrite: boolean; channelIds: string[]; channels: Array<{ id: string; name: string; channelType: string; groups: Array<{ id: string; name: string }> }> };

export async function buyerAccess(): Promise<BuyerAccess | NextResponse> {
  let actor;
  try { actor = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  const live = await db.user.findUnique({ where: { id: actor.id }, select: {
    active: true, role: true, duty: true, roleAssignments: { select: { role: true } }, resourceChannelAccess: { select: { channelId: true } },
  } });
  if (!live?.active || !(live.role === "ADMIN" || live.duty === "HQ_MANAGER" || hasAssignedRole(live, "RESOURCE_MANAGER")))
    return authorizationDenied(actor, "只有总公司管理员和资源部账号可以查看投手号码");
  const all = live.role === "ADMIN" || live.duty === "HQ_MANAGER";
  const copies = await db.channel.findMany({ where: {
    active: true, channelType: { in: ["ADS", "SMS"] }, group: { active: true },
    ...(all ? {} : { id: { in: live.resourceChannelAccess.map(item => item.channelId) } }),
  }, select: { id: true, name: true, channelType: true, group: { select: { id: true, name: true } } }, orderBy: { name: "asc" } });
  const byId = new Map<string, BuyerAccess["channels"][number]>();
  for (const copy of copies) {
    const existing = byId.get(copy.id);
    if (existing) existing.groups.push(copy.group);
    else byId.set(copy.id, { id: copy.id, name: copy.name, channelType: copy.channelType, groups: [copy.group] });
  }
  return { actorId: actor.id, canWrite: !all && hasAssignedRole(live, "RESOURCE_MANAGER"), channelIds: [...byId.keys()], channels: [...byId.values()] };
}
