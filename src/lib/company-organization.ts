import type { Prisma, PrismaClient, User } from "@prisma/client";
import { NextResponse } from "next/server";
import { AuthenticationError, AuthorizationError, requireRole } from "./auth";
import { db } from "./db";
import { authorizationDenied, authorizationErrorResponse } from "./security-events";

type CompanyClient = Pick<PrismaClient, "user" | "department" | "teamGroup"> | Prisma.TransactionClient;

export type ActiveCompanyScope = { id: string; name: string; countryCode: string; timezone: string; workStartMinutes: number; workEndMinutes: number; managementScopeName: string | null; managementCountryCode: string | null };

export function companyManagedGroupWhere(company: ActiveCompanyScope) {
  return { departmentId: company.id, ...(company.managementCountryCode ? { OR: [{ countryCode: company.managementCountryCode }, { countryCode: null, department: { countryCode: company.managementCountryCode } }] } : {}) };
}

export const safeCompanyLeadSelect = {
  id: true,
  username: true,
  name: true,
  role: true,
  groupId: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  group: { select: { id: true, name: true, active: true } },
} as const;

export async function getActiveCompanyScope(actorId: string, client: CompanyClient = db): Promise<ActiveCompanyScope | null> {
  const actor = await client.user.findFirst({
    where: { id: actorId, role: "COMPANY_MANAGER", active: true, departmentId: { not: null } },
    select: { departmentId: true, managementScopeName: true, managementCountryCode: true },
  });
  if (!actor?.departmentId) return null;
  const company = await client.department.findFirst({ where: { id: actor.departmentId, active: true }, select: { id: true, name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } });
  return company ? { ...company, managementScopeName: actor.managementScopeName, managementCountryCode: actor.managementCountryCode } : null;
}

export async function requireCompanyManagerRequest(): Promise<{ actor: User; company: ActiveCompanyScope } | { response: NextResponse }> {
  try {
    const actor = await requireRole("COMPANY_MANAGER");
    const company = await getActiveCompanyScope(actor.id);
    if (!company) return { response: authorizationDenied(actor, "公司管理员必须绑定启用中的下属公司") };
    return { actor, company };
  } catch (error) {
    if (!(error instanceof AuthenticationError) && !(error instanceof AuthorizationError)) throw error;
    return {
      response: error instanceof AuthorizationError
        ? authorizationErrorResponse(error)
        : NextResponse.json({ error: "请先登录" }, { status: 401 }),
    };
  }
}
