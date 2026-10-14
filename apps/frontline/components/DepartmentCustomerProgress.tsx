"use client";
import type { BackendUser } from "@/lib/backend";
import CustomerSheet from "../../../packages/customer-sheet/CustomerSheet";
export type DepartmentCustomerGroup = { id: string; name: string };
export function DepartmentCustomerProgress({groups,member}:{groups?:DepartmentCustomerGroup[];member?:BackendUser}) {
 const roles = member?.roles ?? [];
 const initialView = roles.includes("LEAD") ? "group" : roles.includes("EXPERT") ? "expert" : roles.includes("RECEPTION") ? "pending" : "group";
 const initialResponsibility = initialView === "expert" ? "expert" : roles.includes("GROUP_OPERATOR") && !roles.includes("RECEPTION") ? "operator" : "owner";
 return <CustomerSheet groups={groups} initialGroupId={member?.groupId??undefined} initialView={initialView} initialResponsibility={initialResponsibility} initialMine={!!member && !roles.includes("LEAD")} preferenceKey={member?.id}/>;
}
