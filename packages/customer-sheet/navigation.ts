import { isExpertCustomer, isPendingCustomer, type SheetData } from "./schema";

export const customerPageSize = 50;
export const finderPageSize = 20;
export type CustomerStage = "pending" | "group" | "expert";
export const customerStageNames: Record<CustomerStage, string> = { pending: "添加数据", group: "在群跟进", expert: "专家跟进" };

export function customerStage(data: SheetData): CustomerStage {
  return isExpertCustomer(data) ? "expert" : isPendingCustomer(data) ? "pending" : "group";
}

// Group follow-up also contains expert customers; preserve the existing view membership.
export function inCustomerView(data: SheetData, stage: string | null, deleted: boolean) {
  if (Boolean(data.__deletedAt) !== deleted) return false;
  return deleted || (stage !== "pending" || isPendingCustomer(data))
    && (stage !== "group" || !isPendingCustomer(data))
    && (stage !== "expert" || isExpertCustomer(data));
}

export type CustomerFocus = { id: string; ownerId: string; stage: CustomerStage; deleted: boolean; date: string };
export type CustomerLocation = CustomerFocus & { phone: string; code: string; ownerName: string; status: string; page: number; pages: number; total: number };
export type CustomerFinderPayload = { matches: CustomerLocation[]; total: number; page: number; pages: number };
