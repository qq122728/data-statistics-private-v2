export type EntryBatch = {
  id: string;
  sourceDate: string;
  isHistoricalRecord?: boolean;
  channelTypeSnapshot?: "SMS" | "ADS" | "REBATE";
  group: { name: string };
  channel: { id: string; name: string };
};

export type EntryDevice = { id: string; code: string };

export type EntryFinanceEvent = {
  id: string;
  kind: string;
  amountCents: number | null;
  occurredOn: string;
  continuationNumber: number | null;
  voidedAt: string | Date | null;
  voidReason: string | null;
};

export type EntryLead = {
  id: string;
  phone: string;
  /** 历史补录仅保留客户交接与财务结果，不进入接粉流程数量。 */
  isHistoricalRecord: boolean;
  historicalSourceName: string | null;
  invalid: boolean;
  invalidReason: string | null;
  receptionCategory: "PENDING" | "VALID" | "INVALID" | "LOW_AMOUNT" | "NO_WS";
  replyStatus: "NOT_REPLIED" | "REPLIED" | "FOLLOW_UP";
  repliedOn: string | null;
  followUpCount: number;
  lastFollowedUpOn: string | null;
  customerName: string | null;
  customerEmail: string | null;
  lossAmountCents: number | null;
  customerPlatform: string | null;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT";
  joinedOn: string | null;
  leftOn: string | null;
  expertIntroducedOn: string | null;
  expertContactedOn: string | null;
  expertContactNote: string | null;
  expertWorkflowStage: "QUEUED" | "MATERIALS" | "TRACKING" | "PENDING_REGISTRATION" | "PENDING_ORDER" | "DECLINED_DEPOSIT" | "ORDERED" | "STALLED" | null;
  expertStageChangedAt: Date | null;
  expertTrackingStartedAt: Date | null;
  registeredOn: string | null;
  /** 专家填写的独立跟进说明，前台只读查看，不与接粉备注混写。 */
  expertNotes: string | null;
  nextPlan: string | null;
  nextFollowUpOn: string | null;
  notes: string | null;
  receptionChatStatus: "NORMAL_CHAT" | "READY_TO_JOIN";
  receptionStatusChangedAt: Date | null;
  receptionArchivedAt: Date | null;
  receptionArchiveReason: string | null;
  receptionArchiveVisitCount: number | null;
  groupOperatorOwner: { name: string } | null;
  expertOwner: { name: string } | null;
  attributionOwner: { name: string } | null;
  owner: {
    name: string;
    receptionistAssignments: Array<{ groupOperator: { name: string } }>;
  };
  activities: Array<{
    id: string;
    // Prisma returns the database enum's full union even when the query filters it.
    // Keep this permissive at the page boundary; consumers only render the kinds they understand.
    kind: string;
    occurredOn: string;
    note: string | null;
    actor: { name: string };
  }>;
  device: EntryDevice | null;
  batch: EntryBatch;
  customerOrder: null | {
    id: string;
    openedOn: string;
    initialDepositCents: number;
    voidedAt: string | Date | null;
    voidReason: string | null;
    events: EntryFinanceEvent[];
  };
};

export type EntrySummary = {
  added?: number;
  lowAmount?: number;
  noWs?: number;
  joinedToday?: number;
  leftToday?: number;
  contacted?: number;
  valid: number;
  invalid: number;
  replied: number;
  inGroup: number;
  introduced: number;
  registered: number;
  orders: number;
  initialCents: number;
  rechargeCents: number;
  withdrawalCents: number;
  netCents: number;
};

export type EntryException = {
  id: string;
  phone: string;
  kind: "INVALID_FORMAT" | "DUPLICATE_IN_PASTE" | "COLLISION" | "MANUAL_INVALID";
  reason: string | null;
  occurredOn: string;
  actor: { name: string };
  owner: { name: string } | null;
  lead: { customerName: string | null } | null;
  batch: { sourceDate: string; channel: { name: string } } | null;
};

export type GroupJoinLot = {
  id: string;
  occurredOn: string;
  quantity: number;
  remaining: number;
  batch: EntryBatch;
};

export type EntryCustomerOrder = {
  id: string;
  phone: string;
  openedOn: string;
  initialDepositCents: number;
  batch: EntryBatch;
  events: EntryFinanceEvent[];
};
