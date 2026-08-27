export type GroupCustomerRecord = {
  id: string;
  phone: string;
  customerName: string | null;
  /** 历史补录仍可查看和交接，但不进入粉数、进群或流程数量。 */
  isHistoricalRecord?: boolean;
  historicalSourceName?: string | null;
  /** 仍可在炒群页记录进度，但不计入常规转化与业绩。 */
  invalid?: boolean;
  groupStatus: "JOINED" | "LEFT";
  /** 这条粉所属的代理线／业绩归属人；没有选择时兼容为实际接粉人。 */
  attributionOwnerName?: string;
  ownerName: string;
  expertOwnerName: string | null;
  sourceDate: string;
  groupName?: string;
  channelName: string;
  deviceCode: string | null;
  /** 接粉导入时填写的客户基础资料，供炒群和管理端核对。 */
  customerEmail?: string | null;
  lossAmountCents?: number | null;
  customerPlatform?: string | null;
  groupDeviceAccountId?: string | null;
  groupDeviceAccountNumber?: string | null;
  expertDeviceAccountId?: string | null;
  expertDeviceAccountNumber?: string | null;
  repliedOn: string | null;
  followUpCount: number;
  lastFollowedUpOn: string | null;
  joinedOn: string | null;
  leftOn: string | null;
  leftWithOrder: boolean;
  leftNote?: string | null;
  leftAutomatically?: boolean;
  expertIntroducedOn: string | null;
  expertContactedOn: string | null;
  expertContactNote: string | null;
  expertWorkflowStage?: "QUEUED" | "MATERIALS" | "TRACKING" | "PENDING_REGISTRATION" | "PENDING_ORDER" | "DECLINED_DEPOSIT" | "ORDERED" | "STALLED" | null;
  expertStageChangedAt?: Date | null;
  expertTrackingStartedAt?: Date | null;
  expertNotes?: string | null;
  expertStalledOn?: string | null;
  expertStalledReason?: string | null;
  expertStalledNote?: string | null;
  noInitialDepositOn?: string | null;
  noInitialDepositReason?: string | null;
  noInitialDepositNote?: string | null;
  registeredOn: string | null;
  notes: string | null;
  nextPlan?: string | null;
  groupProgress: Array<{ id: string; occurredOn: string; note: string; actorName: string }>;
  order: null | {
    openedOn: string;
    initialDepositCents: number;
    initialDepositMethod?: "CRYPTO" | "BANK" | null;
    voided: boolean;
    rechargeCents: number;
    withdrawalCents: number;
  };
};

export type ExpertCustomerRecord = {
  id: string;
  batchId: string;
  phone: string;
  customerName: string | null;
  /** 历史补录仍可处理开单与资金，但不进入流程数量。 */
  isHistoricalRecord?: boolean;
  historicalSourceName?: string | null;
  /** 这条粉所属的代理线／业绩归属人；没有选择时兼容为实际接粉人。 */
  attributionOwnerName?: string;
  ownerName: string;
  groupName?: string;
  expertOwnerId: string | null;
  expertOwnerName: string | null;
  source: string;
  groupStatus?: "JOINED" | "LEFT" | "NOT_JOINED";
  joinedOn?: string | null;
  leftOn?: string | null;
  leftNote?: string | null;
  leftAutomatically?: boolean;
  /** 接粉员最初联系客户使用的号码。 */
  deviceCode?: string | null;
  /** 接粉导入时填写的客户基础资料，供专家接待前核对。 */
  lossAmountCents?: number | null;
  customerPlatform?: string | null;
  /** 接粉阶段的交接信息，供专家只读核对。 */
  repliedOn: string | null;
  followUpCount: number;
  lastFollowedUpOn: string | null;
  expertIntroducedOn: string | null;
  expertContactedOn: string | null;
  expertContactNote: string | null;
  expertWorkflowStage?: "QUEUED" | "MATERIALS" | "TRACKING" | "PENDING_REGISTRATION" | "PENDING_ORDER" | "DECLINED_DEPOSIT" | "ORDERED" | "STALLED" | null;
  expertStageChangedAt?: Date | null;
  expertTrackingStartedAt?: Date | null;
  /** 炒群、专家各自的号码快照，互不覆盖。 */
  groupDeviceAccountId?: string | null;
  groupDeviceAccountNumber?: string | null;
  expertDeviceAccountId?: string | null;
  expertDeviceAccountNumber?: string | null;
  expertNotes?: string | null;
  expertStalledOn?: string | null;
  expertStalledReason?: string | null;
  expertStalledNote?: string | null;
  noInitialDepositOn?: string | null;
  noInitialDepositReason?: string | null;
  noInitialDepositNote?: string | null;
  registeredOn: string | null;
  notes: string | null;
  nextPlan: string | null;
  nextFollowUpOn: string | null;
  /** 专家只读，用于了解炒群员最后一次记录的情况。 */
  groupProgress?: Array<{ id: string; occurredOn: string; note: string; actorName: string }>;
  lastActivity: null | { occurredOn: string; note: string | null; actorName: string };
  order: null | {
    id: string;
    openedOn: string;
    initialDepositCents: number;
    initialDepositMethod?: "CRYPTO" | "BANK" | null;
    voided: boolean;
    rechargeCents: number;
    withdrawalCents: number;
    latestFinancialOn: string | null;
    events: Array<{
      id: string;
      kind: "RECHARGE" | "WITHDRAWAL";
      amountCents: number;
      occurredOn: string;
      continuationNumber: number | null;
      depositMethod?: "CRYPTO" | "BANK" | null;
    }>;
  };
};
