const PRISMA_INT_MAX = 2_147_483_647;

function assertLedgerInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > PRISMA_INT_MAX) {
    throw new RangeError(`${label}必须是有效的非负整数`);
  }
}

export function calculateEffectiveFans(receivedFans: number, invalidFans: number): number {
  assertLedgerInteger(receivedFans, "当日接粉数量");
  assertLedgerInteger(invalidFans, "无效粉数量");
  if (invalidFans > receivedFans) throw new RangeError("无效粉数量不能大于当日接粉数量");
  return receivedFans - invalidFans;
}

export function normalizeCustomerPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits.length) throw new RangeError("客户号码必须包含数字");
  if (digits.length < 6) throw new RangeError("客户号码至少需要 6 位数字");
  return digits.slice(-6);
}

export function getNextContinuationNumber(usedNumbers: readonly number[]): number {
  const used = new Set(usedNumbers.filter((value) => Number.isInteger(value) && value > 0));
  let next = 1;
  while (used.has(next)) next += 1;
  return next;
}

export type DailyFinancialSummaryInput = {
  initialDepositCents: number;
  continuationDepositCents: number;
  withdrawalCents: number;
};

export type DailyFinancialSummary = DailyFinancialSummaryInput & {
  totalDepositCents: number;
  netPerformanceCents: number;
};

export function calculateDailyFinancialSummary(input: DailyFinancialSummaryInput): DailyFinancialSummary {
  assertLedgerInteger(input.initialDepositCents, "首充金额");
  assertLedgerInteger(input.continuationDepositCents, "续充金额");
  assertLedgerInteger(input.withdrawalCents, "出金金额");
  const totalDepositCents = input.initialDepositCents + input.continuationDepositCents;
  if (!Number.isSafeInteger(totalDepositCents)) throw new RangeError("总入金金额超出安全范围");
  const netPerformanceCents = totalDepositCents - input.withdrawalCents;
  if (!Number.isSafeInteger(netPerformanceCents)) throw new RangeError("当日净业绩超出安全范围");
  return { ...input, totalDepositCents, netPerformanceCents };
}
