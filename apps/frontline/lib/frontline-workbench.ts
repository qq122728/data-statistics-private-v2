export type PersonRef = { id: string; name: string; role?: string };
export type ActivityRef = { id: string; kind: string; occurredOn: string; note: string | null; actor: PersonRef };
export type FinanceEvent = {
  id: string;
  kind: "RECHARGE" | "WITHDRAWAL";
  amountCents: number | null;
  occurredOn: string;
  continuationNumber: number | null;
  depositMethod: "CRYPTO" | "BANK" | null;
};
export type OrderSummary = {
  id: string;
  openedOn: string;
  initialDepositCents: number;
  initialDepositMethod: "CRYPTO" | "BANK" | null;
  rechargeCents: number;
  withdrawalCents: number;
  netDepositCents?: number;
  nextContinuationNumber: number;
  events: FinanceEvent[];
};

export type GroupOperatorStage = "active" | "introduced" | "left";
export type GroupOperatorCustomer = {
  id: string;
  phone: string;
  customerName: string | null;
  customerEmail: string | null;
  lossAmountCents: number | null;
  customerPlatform: string | null;
  notes: string | null;
  stage: GroupOperatorStage;
  groupStatus: "JOINED" | "LEFT";
  repliedOn: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  leftNote: string | null;
  expertIntroducedOn: string | null;
  expertContactedOn: string | null;
  registeredOn: string | null;
  expertWorkflowStage: ExpertStage | null;
  groupDeviceAccountId: string | null;
  groupDeviceAccountNumber: string | null;
  isHistoricalRecord: boolean;
  sourceName: string;
  owner: PersonRef;
  attributionOwner: PersonRef | null;
  expertOwner: PersonRef | null;
  batch: { id: string; sourceDate: string; channel: { id: string; name: string } };
  activities: ActivityRef[];
  latestGroupProgress: ActivityRef | null;
  order: OrderSummary | null;
};
export type GroupOperatorResponse = {
  stage: GroupOperatorStage;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<GroupOperatorStage, number>;
  defaultExpertId: string | null;
  expertAssignees: PersonRef[];
  customers: GroupOperatorCustomer[];
};

export type ExpertStage = "QUEUED" | "MATERIALS" | "TRACKING" | "PENDING_REGISTRATION" | "PENDING_ORDER" | "DECLINED_DEPOSIT" | "ORDERED" | "STALLED";
export type ExpertCustomer = {
  id: string;
  phone: string;
  customerName: string | null;
  customerEmail: string | null;
  lossAmountCents: number | null;
  customerPlatform: string | null;
  notes: string | null;
  stage: ExpertStage;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
  repliedOn: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  expertIntroducedOn: string;
  expertContactedOn: string | null;
  expertContactNote: string | null;
  expertNotes: string | null;
  expertStageChangedAt: string | null;
  expertTrackingStartedAt: string | null;
  registeredOn: string | null;
  nextPlan: string | null;
  nextFollowUpOn: string | null;
  expertDeviceAccountId: string | null;
  expertDeviceAccountNumber: string | null;
  isHistoricalRecord: boolean;
  sourceName: string;
  owner: PersonRef;
  attributionOwner: PersonRef | null;
  groupOperatorOwner: PersonRef | null;
  expertOwner: PersonRef;
  batch: { id: string; sourceDate: string; channel: { id: string; name: string } };
  activities: ActivityRef[];
  order: OrderSummary | null;
};
export type ExpertResponse = {
  stage: ExpertStage | "all";
  page: number;
  pageSize: number;
  total: number;
  counts: Record<ExpertStage, number>;
  customers: ExpertCustomer[];
};

export function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function localToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
