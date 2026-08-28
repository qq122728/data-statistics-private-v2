import { z } from "zod";
import type { MetricKind } from "./metrics";
import { API_LIMITS } from "./request-limits";

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

const PRISMA_INT_MAX = 2_147_483_647;
const nonNegativeInteger = z.coerce.number().int().nonnegative().max(PRISMA_INT_MAX);
const positiveInteger = z.coerce.number().int().positive().max(PRISMA_INT_MAX);
const date = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Expected a real calendar date");

const newFansInputSchema = z.object({
  groupId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
  channelId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
  channelName: z.string().trim().min(1, "请输入渠道名称").max(100, "渠道名称不能超过 100 个字").optional(),
  sourceDate: date,
  quantity: nonNegativeInteger,
  invalidFans: nonNegativeInteger.optional(),
  effectiveFans: nonNegativeInteger.optional(),
  noNumber: nonNegativeInteger.optional(),
  duplicateFans: nonNegativeInteger.optional(),
}).superRefine((input, context) => {
  const count = Number(Boolean(input.channelId)) + Number(Boolean(input.channelName));
  if (count !== 1) {
    context.addIssue({
      code: "custom",
      path: [input.channelId ? "channelName" : "channelId"],
      message: "请选择已有渠道，或输入一个新渠道名称",
    });
  }
  const usesSimpleBreakdown = input.invalidFans !== undefined;
  const legacyFields = [input.effectiveFans, input.noNumber, input.duplicateFans];
  if (usesSimpleBreakdown && legacyFields.some((value) => value !== undefined)) {
    context.addIssue({ code: "custom", path: ["invalidFans"], message: "无效粉不能和旧分类同时填写" });
    return;
  }
  if (!usesSimpleBreakdown && legacyFields.some((value) => value === undefined)) {
    context.addIssue({ code: "custom", path: ["invalidFans"], message: "请输入无效粉数量" });
    return;
  }
  const breakdown = usesSimpleBreakdown
    ? validateFanBreakdown({ newFans: input.quantity, effectiveFans: input.quantity - input.invalidFans!, noNumber: input.invalidFans!, duplicateFans: 0 })
    : validateFanBreakdown({
      newFans: input.quantity,
      effectiveFans: input.effectiveFans!,
      noNumber: input.noNumber!,
      duplicateFans: input.duplicateFans!,
    });
  if (!breakdown.valid) {
    context.addIssue({
      code: "custom",
      path: [usesSimpleBreakdown ? "invalidFans" : "effectiveFans"],
      message: breakdown.message,
    });
  }
}).transform((input) => {
  if (input.invalidFans !== undefined) {
    return {
      channelId: input.channelId,
      channelName: input.channelName,
      sourceDate: input.sourceDate,
      quantity: input.quantity,
      invalidFans: input.invalidFans,
      effectiveFans: input.quantity - input.invalidFans,
      noNumber: input.invalidFans,
      duplicateFans: 0,
    };
  }
  return {
    channelId: input.channelId,
    channelName: input.channelName,
    sourceDate: input.sourceDate,
    quantity: input.quantity,
    invalidFans: input.noNumber! + input.duplicateFans!,
    effectiveFans: input.effectiveFans!,
    noNumber: input.noNumber!,
    duplicateFans: input.duplicateFans!,
  };
});

const quantityKinds = [
  "REPLIES",
  "GROUP_JOIN",
  "GROUP_LEAVE",
  "EXPERT_INTRO",
  "REGISTRATION",
  "ORDER",
] as const satisfies readonly Exclude<MetricKind, "NEW_FANS" | "ABNORMAL_GROUP_LEAVE" | "RECHARGE" | "WITHDRAWAL" | "CHANNEL_PERFORMANCE">[];

const amountKinds = ["RECHARGE", "WITHDRAWAL", "CHANNEL_PERFORMANCE"] as const;

const metricInputSchema = z
  .object({
    batchId: z.string().min(1).max(API_LIMITS.identifierCharacters),
    occurredOn: date,
    kind: z.enum([...quantityKinds, ...amountKinds]),
    quantity: nonNegativeInteger.optional(),
    amountCents: nonNegativeInteger.optional(),
    parentEventId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
  })
  .superRefine((input, context) => {
    if (input.parentEventId !== undefined && input.kind !== "GROUP_LEAVE") {
      context.addIssue({
        code: "custom",
        path: ["parentEventId"],
        message: "只有退群记录可以关联原入群记录",
      });
    }
    if ((amountKinds as readonly string[]).includes(input.kind)) {
      if (input.amountCents === undefined) {
        context.addIssue({
          code: "custom",
          path: ["amountCents"],
          message: "Amount events require amountCents",
        });
      }
      if (input.quantity !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["quantity"],
          message: "Amount events cannot include quantity",
        });
      }
      return;
    }

    if (input.quantity === undefined) {
      context.addIssue({
        code: "custom",
        path: ["quantity"],
        message: "Quantity events require quantity",
      });
    }
    if (input.amountCents !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["amountCents"],
        message: "Quantity events cannot include amountCents",
      });
    }
  });

const historyGroupMetricsSchema = z.object({
  newFans: nonNegativeInteger,
  effectiveFans: nonNegativeInteger,
  noNumber: nonNegativeInteger,
  duplicateFans: nonNegativeInteger,
  replies: nonNegativeInteger,
  groupJoin: nonNegativeInteger,
  groupLeave: nonNegativeInteger,
  expertIntro: nonNegativeInteger,
  registration: nonNegativeInteger,
  order: nonNegativeInteger,
  rechargeCents: nonNegativeInteger,
  withdrawalCents: nonNegativeInteger,
  channelPerformanceCents: nonNegativeInteger,
}).strict().superRefine((metrics, context) => {
  const breakdown = validateFanBreakdown(metrics);
  if (!breakdown.valid) {
    context.addIssue({
      code: "custom",
      path: ["effectiveFans"],
      message: breakdown.message,
    });
  }
});

export const historyGroupUpdateSchema = z.object({
  eventIds: z.array(z.string().min(1).max(API_LIMITS.identifierCharacters)).min(1).max(API_LIMITS.historyEventIds, `一次最多修改 ${API_LIMITS.historyEventIds} 条历史事件`).refine(
    (eventIds) => new Set(eventIds).size === eventIds.length,
    "Event IDs must be unique",
  ),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  occurredOn: date,
  batchId: z.string().min(1).max(API_LIMITS.identifierCharacters),
  metrics: historyGroupMetricsSchema,
}).strict();

const customerOrderInputSchema = z.object({
  batchId: z.string().min(1).max(API_LIMITS.identifierCharacters),
  leadId: z.string().min(1, "请从已注册客户中选择开单号码").max(API_LIMITS.identifierCharacters),
  openedOn: date,
  phone: z.string().trim().min(1, "请输入开单号码").max(80, "客户编号不能超过 80 个字符"),
  initialDepositCents: positiveInteger,
  initialDepositMethod: z.enum(["CRYPTO", "BANK"], { message: "请选择首充入金方式" }),
}).strict();

const customerFinanceInputSchema = z.object({
  customerOrderId: z.string().min(1).max(API_LIMITS.identifierCharacters),
  occurredOn: date,
  kind: z.enum(["RECHARGE", "WITHDRAWAL"]),
  amountCents: positiveInteger,
  depositMethod: z.enum(["CRYPTO", "BANK"], { message: "请选择入金方式" }).optional(),
  continuationNumber: positiveInteger.optional(),
}).strict().superRefine((input, context) => {
  if (input.kind === "RECHARGE" && input.continuationNumber === undefined) {
    context.addIssue({ code: "custom", path: ["continuationNumber"], message: "续充必须选择第几次续充" });
  }
  if (input.kind === "WITHDRAWAL" && input.continuationNumber !== undefined) {
    context.addIssue({ code: "custom", path: ["continuationNumber"], message: "出金不填写续充次数" });
  }
  if (input.kind === "RECHARGE" && input.depositMethod === undefined) {
    context.addIssue({ code: "custom", path: ["depositMethod"], message: "续充必须选择加密货币或银行卡入金" });
  }
  if (input.kind === "WITHDRAWAL" && input.depositMethod !== undefined) {
    context.addIssue({ code: "custom", path: ["depositMethod"], message: "出金不选择入金方式" });
  }
});

export type NewFansInput = z.infer<typeof newFansInputSchema>;
export type MetricInput =
  | {
      batchId: string;
      occurredOn: string;
      kind: (typeof quantityKinds)[number];
      quantity: number;
      amountCents?: never;
      parentEventId?: string;
    }
  | {
      batchId: string;
      occurredOn: string;
      kind: (typeof amountKinds)[number];
      quantity?: never;
      amountCents: number;
      parentEventId?: never;
  };

export type HistoryGroupUpdateInput = z.infer<typeof historyGroupUpdateSchema>;
export type CustomerOrderInput = z.infer<typeof customerOrderInputSchema>;
export type CustomerFinanceInput = z.infer<typeof customerFinanceInputSchema>;

export function parseNewFansInput(input: unknown): NewFansInput {
  return newFansInputSchema.parse(input);
}

export function parseMetricInput(input: unknown): MetricInput {
  return metricInputSchema.parse(input) as MetricInput;
}

export function parseHistoryGroupUpdate(input: unknown): HistoryGroupUpdateInput {
  return historyGroupUpdateSchema.parse(input);
}

export function parseCustomerOrderInput(input: unknown): CustomerOrderInput {
  return customerOrderInputSchema.parse(input);
}

export function parseCustomerFinanceInput(input: unknown): CustomerFinanceInput {
  return customerFinanceInputSchema.parse(input);
}
