import type { User } from "@prisma/client";
import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireRole, type SessionUser } from "../../../lib/auth";
import { hasAssignedRole } from "../../../lib/role-access";
import { canWriteAdminSettings, canWriteChannelManagement } from "../../../lib/permissions";
import { authorizationErrorResponse } from "../../../lib/security-events";

export async function requireAdminRequest(): Promise<{ actor: User } | { response: NextResponse }> {
  try {
    const actor = await requireRole("ADMIN");
    if (!canWriteAdminSettings(actor)) throw new AuthorizationError(undefined, actor);
    return { actor };
  } catch (error) {
    if (!(error instanceof AuthenticationError) && !(error instanceof AuthorizationError)) throw error;
    return { response: error instanceof AuthorizationError
      ? authorizationErrorResponse(error)
      : NextResponse.json({ error: "请先登录" }, { status: 401 }) };
  }
}

export async function requireChannelManagerRequest(): Promise<{ actor: SessionUser } | { response: NextResponse }> {
  try {
    const actor = await requireRole("ADMIN", "RESOURCE_MANAGER", "COMPANY_MANAGER");
    if (!canWriteChannelManagement(actor)) throw new AuthorizationError(undefined, actor);
    if (actor.role === "COMPANY_MANAGER" && actor.managementCountryCode) throw new AuthorizationError(undefined, actor);
    return { actor };
  } catch (error) {
    if (!(error instanceof AuthenticationError) && !(error instanceof AuthorizationError)) throw error;
    return { response: error instanceof AuthorizationError
      ? authorizationErrorResponse(error, "只有总公司管理员、资源部管理员或公司管理员可以管理渠道")
      : NextResponse.json({ error: "请先登录" }, { status: 401 }) };
  }
}

export async function requirePersonnelTransferRequest(): Promise<{ actor: SessionUser } | { response: NextResponse }> {
  try {
    const actor = await requireRole("ADMIN", "COMPANY_MANAGER", "LEAD");
    const allowed = actor.role === "ADMIN"
      || actor.role === "COMPANY_MANAGER"
      || actor.duty === "HQ_MANAGER"
      || actor.duty === "COMPANY_MANAGER"
      || actor.duty === "DEPARTMENT_MANAGER"
      || hasAssignedRole(actor, "LEAD");
    if (!allowed) throw new AuthorizationError(undefined, actor);
    return { actor };
  } catch (error) {
    if (!(error instanceof AuthenticationError) && !(error instanceof AuthorizationError)) throw error;
    return { response: error instanceof AuthorizationError
      ? authorizationErrorResponse(error, "只有组长、部门管理员、公司管理员或总公司管理员可以办理人员调动")
      : NextResponse.json({ error: "请先登录" }, { status: 401 }) };
  }
}
