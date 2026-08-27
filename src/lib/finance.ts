export type FinancialInput = {
  effectiveFans: number;
  rechargeCents: number;
  withdrawalCents: number;
  channelPerformanceCents: number;
  effectiveFanPriceCents: number | null;
  /** SMS、投流、底料返点；旧数据未传时按普通付费渠道计算。 */
  channelType?: "SMS" | "ADS" | "REBATE";
  /** 万分比，3000 就是 30%。仅底料返点渠道使用。 */
  rebateRateBps?: number | null;
};

export type FinancialResult = {
  costCents: number | null;
  netPerformanceCents: number;
  profitCents: number | null;
  priceState: "PRICED" | "PENDING_PRICE";
  /** 底料返点从净业绩中留出的返佣；其他渠道恒为 0。 */
  rebateCents?: number;
  /** 计入业务员和公司业绩的金额。普通渠道等于利润；底料为净业绩的 70%。 */
  creditedPerformanceCents?: number | null;
};

const minimumSafeInteger = BigInt(Number.MIN_SAFE_INTEGER);
const maximumSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

function inputInteger(name: keyof FinancialInput, value: number): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`财务计算输入 ${name} 必须是安全整数`);
  }
  return BigInt(value);
}

function resultInteger(name: "costCents" | "netPerformanceCents" | "profitCents", value: bigint): number {
  if (value < minimumSafeInteger || value > maximumSafeInteger) {
    throw new RangeError(`财务计算结果 ${name} 超出安全整数范围`);
  }
  return Number(value);
}

function roundedShare(value: bigint, rateBps: bigint): bigint {
  const numerator = value * rateBps;
  const denominator = BigInt(10_000);
  const zero = BigInt(0);
  const two = BigInt(2);
  if (numerator >= zero) return (numerator + denominator / two) / denominator;
  return (numerator - denominator / two) / denominator;
}

export function calculateFinancials(input: FinancialInput): FinancialResult {
  const effectiveFans = inputInteger("effectiveFans", input.effectiveFans);
  const rechargeCents = inputInteger("rechargeCents", input.rechargeCents);
  const withdrawalCents = inputInteger("withdrawalCents", input.withdrawalCents);
  const netPerformance = rechargeCents - withdrawalCents;
  const netPerformanceCents = resultInteger("netPerformanceCents", netPerformance);

  if (input.channelType === "REBATE") {
    const rate = input.rebateRateBps ?? 3000;
    if (!Number.isInteger(rate) || rate < 0 || rate > 10_000) {
      throw new RangeError("底料返点比例必须在 0% 到 100% 之间");
    }
    const rebate = roundedShare(netPerformance, BigInt(rate));
    const credited = netPerformance - rebate;
    return {
      costCents: 0,
      netPerformanceCents,
      profitCents: resultInteger("profitCents", credited),
      priceState: "PRICED",
      rebateCents: resultInteger("costCents", rebate),
      creditedPerformanceCents: resultInteger("profitCents", credited),
    };
  }

  if (input.effectiveFanPriceCents === null) {
    return {
      costCents: null,
      netPerformanceCents,
      profitCents: null,
      priceState: "PENDING_PRICE",
    };
  }

  const effectiveFanPriceCents = inputInteger("effectiveFanPriceCents", input.effectiveFanPriceCents);
  const cost = effectiveFans * effectiveFanPriceCents;
  const costCents = resultInteger("costCents", cost);
  const profitCents = resultInteger("profitCents", netPerformance - cost);
  return {
    costCents,
    netPerformanceCents,
    profitCents,
    priceState: "PRICED",
  };
}

export function validateFanBreakdown(input: {
  newFans: number;
  effectiveFans: number;
  noNumber: number;
  duplicateFans: number;
}): { valid: true } | { valid: false; message: string } {
  if (input.effectiveFans + input.noNumber + input.duplicateFans > input.newFans) {
    return { valid: false, message: "有效粉、无 WS 号码和撞粉合计不能大于提交号码" };
  }

  return { valid: true };
}
