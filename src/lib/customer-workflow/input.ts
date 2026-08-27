import { z } from "zod";
import { customerWorkflowActions } from "./actions";
import { isCalendarDate } from "../dates";
import { API_LIMITS } from "../request-limits";

const date = z.string().refine(isCalendarDate, "日期必须是实际存在的 YYYY-MM-DD").optional();

export const expertStallReasons = ["NO_RESPONSE", "NO_BUDGET", "NO_TRUST", "REFUSED", "OTHER"] as const;

export const customerWorkflowInputSchema = z.object({
  action: z.enum(customerWorkflowActions),
  occurredOn: date,
  deviceId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
  deviceAccountId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
  deviceCode: z.string().trim().min(1, "请输入设备号").max(50, "设备号不能超过 50 个字").optional(),
  reason: z.string().trim().max(300, "原因不能超过 300 个字").optional(),
  leaveNote: z.string().trim().max(300, "退群备注不能超过 300 个字").optional(),
  notes: z.string().trim().max(300).optional(),
  expertNotes: z.string().trim().max(300, "专家情况不能超过 300 个字").optional(),
  customerName: z.string().trim().max(80, "客户姓名不能超过 80 个字").optional(),
  customerEmail: z.string().trim().max(160, "邮箱不能超过 160 个字").refine((value) => !value || z.string().email().safeParse(value).success, "邮箱格式不正确").optional(),
  lossAmountCents: z.number().int().min(0, "损失金额不能小于 0").nullable().optional(),
  customerPlatform: z.string().trim().max(80, "客户平台不能超过 80 个字").optional(),
  receptionCategory: z.enum(["VALID", "LOW_AMOUNT", "NO_WS"]).optional(),
  receptionChatStatus: z.enum(["NORMAL_CHAT", "READY_TO_JOIN"]).optional(),
  archiveVisitCount: z.number().int("回访次数必须是整数").min(0, "回访次数不能小于 0").max(999, "回访次数不能超过 999").optional(),
  phone: z.string().trim().min(1, "请输入手机号").max(80, "客户号码不能超过 80 个字").optional(),
  nextPlan: z.string().trim().max(300, "下一步计划不能超过 300 个字").optional(),
  nextFollowUpOn: z.string().refine(isCalendarDate, "计划日期必须是实际存在的 YYYY-MM-DD").nullable().optional(),
  expertOwnerId: z.string().min(1, "请选择专家或组长").max(API_LIMITS.identifierCharacters).optional(),
  expertDeviceAccountId: z.string().min(1, "请选择专家设备号").max(API_LIMITS.identifierCharacters).optional(),
  expertDeviceAccountNumber: z.string().trim().min(1, "请输入专家设备号").max(50, "专家设备号不能超过 50 个字").optional(),
  contactNote: z.string().trim().max(300, "联系备注不能超过 300 个字").optional(),
  stalledReason: z.enum(expertStallReasons).optional(),
  stalledNote: z.string().trim().max(300, "杀不动说明不能超过 300 个字").optional(),
  noInitialDepositReason: z.enum(expertStallReasons).optional(),
  noInitialDepositNote: z.string().trim().max(300, "不首充说明不能超过 300 个字").optional(),
  progressNote: z.string().trim().min(1, "请填写今日进度").max(500, "每日进度不能超过 500 个字").optional(),
}).strict().superRefine((input, context) => {
  if (input.deviceId && input.deviceCode) {
    context.addIssue({ code: "custom", path: ["deviceId"], message: "设备号请选择设备库或手动填写其中一种" });
  }
  if (input.expertDeviceAccountId && input.expertDeviceAccountNumber) {
    context.addIssue({ code: "custom", path: ["expertDeviceAccountId"], message: "专家设备号请选择已绑定号码或手动填写其中一种" });
  }
  if (input.action === "updateReceptionChatStatus" && !input.receptionChatStatus) {
    context.addIssue({ code: "custom", path: ["receptionChatStatus"], message: "请选择正常聊天或准备拉群" });
  }
  if (input.action === "archiveRepliedCustomer") {
    if (!input.reason?.trim()) context.addIssue({ code: "custom", path: ["reason"], message: "请填写归档原因" });
    if (input.archiveVisitCount === undefined) context.addIssue({ code: "custom", path: ["archiveVisitCount"], message: "请填写回访次数" });
  }
});

export type CustomerWorkflowInput = z.infer<typeof customerWorkflowInputSchema>;
