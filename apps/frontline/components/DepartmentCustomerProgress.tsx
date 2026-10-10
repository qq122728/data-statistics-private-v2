"use client";
import type { BackendUser } from "@/lib/backend";
import CustomerSheet from "../../../packages/customer-sheet/CustomerSheet";
export type DepartmentCustomerGroup = { id: string; name: string };
export function DepartmentCustomerProgress({groups,member}:{groups?:DepartmentCustomerGroup[];member?:BackendUser}) {
 return <CustomerSheet groups={groups} initialGroupId={member?.groupId??undefined} initialView={member?.roles.includes("LEAD")?"group":member?.roles.includes("EXPERT")?"expert":member?.roles.includes("RECEPTION")?"pending":"group"} initialMine={!!member} preferenceKey={member?.id}/>;
}
