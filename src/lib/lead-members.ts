import type { Prisma, PrismaClient, User } from "@prisma/client";
import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireRole } from "./auth";
import { db } from "./db";
import { authorizationDenied, authorizationErrorResponse, type SecurityEventActor } from "./security-events";

type LeadGroupClient =
  Pick<PrismaClient, "teamGroup" | "user"> | Prisma.TransactionClient;

export const safeLeadMemberSelect = {
  id: true,
  username: true,
  name: true,
  role: true,
  roleAssignments: { select: { role: true }, orderBy: { role: "asc" } },
  groupId: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  group: { select: { name: true } },
} as const;

export type ActiveLeadGroup = {
  id: string;
  name: string;
  groupType?: "HACKER" | "LAWYER";
};

export type LeadRequestAccess = {
  actor: User;
  group: ActiveLeadGroup;
};

export const leadGroupAccessError = (actor: SecurityEventActor) =>
  authorizationDenied(actor, "组长必须归属启用中的小组");

export async function getActiveLeadGroup(
  actorId: string,
  client: LeadGroupClient = db,
): Promise<ActiveLeadGroup | null> {
  const actor = await client.user.findFirst({
    where: { id: actorId, role: "LEAD", active: true, groupId: { not: null } },
    select: { groupId: true },
  });
  if (!actor?.groupId) {
    return null;
  }

  return client.teamGroup.findFirst({
    where: { id: actor.groupId, active: true },
    select: { id: true, name: true, groupType: true },
  });
}

export async function requireLeadRequest(): Promise<
  LeadRequestAccess | { response: NextResponse }
> {
  try {
    const actor = await requireRole("LEAD");
    const group = await getActiveLeadGroup(actor.id);
    if (!group) {
      return { response: leadGroupAccessError(actor) };
    }
    return { actor, group };
  } catch (error) {
    if (
      !(error instanceof AuthenticationError) &&
      !(error instanceof AuthorizationError)
    ) {
      throw error;
    }
    return {
      response: error instanceof AuthorizationError
        ? authorizationErrorResponse(error)
        : NextResponse.json({ error: "请先登录" }, { status: 401 }),
    };
  }
}
