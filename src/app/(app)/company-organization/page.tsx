import type { Duty } from "@prisma/client";
import { redirect } from "next/navigation";
import { CompanyOrganizationManager } from "../../../components/company/CompanyOrganizationManager";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { recordSecurityEvent } from "../../../lib/security-events";

const organizationManagerDuties = new Set<Duty>(["DEPARTMENT_MANAGER", "COMPANY_MANAGER", "HQ_MANAGER"]);

export default async function CompanyOrganizationPage() {
  let user;
  try { user = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) redirect("/login?next=/company-organization");
    throw error;
  }
  if (!user.duty || !organizationManagerDuties.has(user.duty)) {
    recordSecurityEvent({ event: "AUTHORIZATION_DENIED", userId: user.id, teamId: user.groupId, result: "denied" });
    redirect("/dashboard");
  }
  return <CompanyOrganizationManager duty={user.duty as Extract<Duty, "DEPARTMENT_MANAGER" | "COMPANY_MANAGER" | "HQ_MANAGER">} />;
}
