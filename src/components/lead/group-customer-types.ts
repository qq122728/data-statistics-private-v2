import type { GroupCustomerRecord } from "../../lib/customer-queries/types";

export type GroupCustomer = GroupCustomerRecord;

export type GroupCustomerAction =
  | "leaveGroup"
  | "undoLeaveGroup"
  | "undoIntroduceExpert"
  | "undoExpertContacted";
