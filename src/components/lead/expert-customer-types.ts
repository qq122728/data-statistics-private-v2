import type { ExpertCustomerRecord } from "../../lib/customer-queries/types";

export type ExpertCustomer = ExpertCustomerRecord;

export type ExpertAssigneeOption = { id: string; name: string; label: string };
export type ExpertOrderDraft = { date: string; amount: string; depositMethod: "CRYPTO" | "BANK" };
export type ExpertProgressCorrection = "undoRegister";
export type ExpertFinancialEvent = NonNullable<ExpertCustomer["order"]>["events"][number];
