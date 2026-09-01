"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle, ChatCircleDots, MagicWand, Minus, PaperPlaneTilt, X } from "@phosphor-icons/react";
import { requestJson } from "@/lib/backend";
import styles from "./AiSmartAssistant.module.css";

type Values = {
  dispatchCount: number;
  duplicateCount: number;
  lowAmountCount: number;
  noWsCount: number;
  manualInvalidCount: number;
  lawyerRealCaseCount: number;
  lawyerAddedCount: number;
  lawyerExpertAddedCount: number;
  customerServicePushCount: number;
  effectiveCount: number;
  replyCount: number;
  joinCount: number;
  operatorReceivedCount: number;
  normalLeaveCount: number;
  abnormalLeaveCount: number;
  currentInGroupCount: number;
  expertIntroCount: number;
  expertReceivedCount: number;
  expertContactedCount: number;
  registrationCount: number;
  orderCount: number;
  cryptoInitialDepositCents: number;
  bankInitialDepositCents: number;
  cryptoRechargeCents: number;
  bankRechargeCents: number;
  withdrawalCents: number;
};

type DailyContext = {
  groupType: "HACKER" | "LAWYER";
  today: string;
  rolloverLabel: string;
  channels: Array<{ id: string; name: string; channelType: string }>;
  unifiedEntries: Array<{
    entryId: string | null;
    businessDate: string;
    channel: { id: string; name: string };
    values: Values;
  }>;
};

type Message = { id: number; role: "assistant" | "user"; text: string };
type Phase = "idle" | "template" | "loading" | "channel" | "metrics" | "preview" | "edit-select" | "editing" | "saving" | "done"
  | "customer-loading" | "customer-mode" | "customer-phone" | "customer-name" | "customer-channel" | "customer-operator" | "customer-device" | "customer-preview" | "customer-saving" | "customer-done"
  | "customer-batch-input" | "customer-batch-preview" | "customer-batch-saving" | "customer-batch-done"
  | "progress-loading" | "progress-phone" | "progress-action" | "progress-text" | "progress-person" | "progress-amount" | "progress-method" | "progress-preview" | "progress-saving" | "progress-done"
  | "legacy-loading" | "legacy-scenario" | "legacy-source-date" | "legacy-phone" | "legacy-name" | "legacy-channel" | "legacy-reception" | "legacy-device" | "legacy-baseline-date" | "legacy-operator" | "legacy-expert" | "legacy-occurred-date" | "legacy-amount" | "legacy-method" | "legacy-preview" | "legacy-saving" | "legacy-done";
type Field = {
  key: string;
  label: string;
  question: string;
  money?: boolean;
  read: (values: Values) => number;
  write: (values: Values, value: number) => Values;
};

const EMPTY_VALUES: Values = {
  dispatchCount: 0, duplicateCount: 0, lowAmountCount: 0, noWsCount: 0, manualInvalidCount: 0,
  lawyerRealCaseCount: 0, lawyerAddedCount: 0, lawyerExpertAddedCount: 0, customerServicePushCount: 0,
  effectiveCount: 0, replyCount: 0, joinCount: 0, operatorReceivedCount: 0, normalLeaveCount: 0,
  abnormalLeaveCount: 0, currentInGroupCount: 0, expertIntroCount: 0, expertReceivedCount: 0,
  expertContactedCount: 0, registrationCount: 0, orderCount: 0, cryptoInitialDepositCents: 0,
  bankInitialDepositCents: 0, cryptoRechargeCents: 0, bankRechargeCents: 0, withdrawalCents: 0,
};

const countField = (key: keyof Values, label: string, question = `今天${label}是多少？`): Field => ({
  key,
  label,
  question,
  read: (values) => values[key],
  write: (values, value) => ({ ...values, [key]: Math.round(value) }),
});

const HACKER_FIELDS: Field[] = [
  countField("dispatchCount", "添加数据"),
  countField("duplicateCount", "撞粉"),
  countField("lowAmountCount", "低金额"),
  countField("noWsCount", "无 WS 号码"),
  countField("manualInvalidCount", "人工无效"),
  countField("replyCount", "回复"),
  countField("joinCount", "进群"),
  countField("normalLeaveCount", "正常退群"),
  countField("abnormalLeaveCount", "异常退群"),
  countField("expertIntroCount", "推专家"),
  countField("registrationCount", "注册"),
  countField("orderCount", "开单"),
  { key: "initialDeposit", label: "首充金额", question: "今天首充金额是多少？", money: true,
    read: (values) => values.cryptoInitialDepositCents + values.bankInitialDepositCents,
    write: (values, value) => ({ ...values, cryptoInitialDepositCents: Math.round(value * 100), bankInitialDepositCents: 0 }) },
  { key: "recharge", label: "续充金额", question: "今天续充金额是多少？", money: true,
    read: (values) => values.cryptoRechargeCents + values.bankRechargeCents,
    write: (values, value) => ({ ...values, cryptoRechargeCents: Math.round(value * 100), bankRechargeCents: 0 }) },
  { key: "withdrawal", label: "出金金额", question: "今天出金金额是多少？", money: true,
    read: (values) => values.withdrawalCents,
    write: (values, value) => ({ ...values, withdrawalCents: Math.round(value * 100) }) },
];

const LAWYER_FIELDS: Field[] = [
  countField("dispatchCount", "接粉"),
  countField("replyCount", "回复"),
  countField("lowAmountCount", "接粉小金额"),
  countField("lawyerRealCaseCount", "接粉真实案件"),
  countField("lawyerAddedCount", "添加律师"),
  countField("lawyerExpertAddedCount", "添加专家"),
  countField("customerServicePushCount", "总推客服数量"),
  countField("registrationCount", "总注册数量"),
  countField("orderCount", "总开单数量"),
  { key: "cryptoDeposits", label: "加密货币充值金额", question: "今天加密货币充值金额是多少？", money: true,
    read: (values) => values.cryptoInitialDepositCents + values.cryptoRechargeCents,
    write: (values, value) => ({ ...values, cryptoInitialDepositCents: Math.round(value * 100), cryptoRechargeCents: 0 }) },
  { key: "bankDeposits", label: "银行卡充值金额", question: "今天银行卡充值金额是多少？", money: true,
    read: (values) => values.bankInitialDepositCents + values.bankRechargeCents,
    write: (values, value) => ({ ...values, bankInitialDepositCents: Math.round(value * 100), bankRechargeCents: 0 }) },
  { key: "withdrawal", label: "出金金额", question: "今天出金金额是多少？", money: true,
    read: (values) => values.withdrawalCents,
    write: (values, value) => ({ ...values, withdrawalCents: Math.round(value * 100) }) },
];

const quickActions = ["添加今日数据", "新增客户", "录入老客户进度", "更新客户进度", "查询或纠正数据"];
type NaturalIntent = "DAILY" | "CUSTOMER" | "LEGACY" | "PROGRESS";
const NATURAL_TEMPLATES: Record<NaturalIntent, Array<{ label: string; text: string }>> = {
  DAILY: [
    { label: "今日数据", text: "今天 FB-M：添加20，撞粉1，低金额2，无WS0，人工无效0，回复8，进群3，正常退群0，异常退群0，推专家2，注册1，开单1，首充1000，续充0，出金0" },
  ],
  CUSTOMER: [
    { label: "新增一个客户", text: "新增客户112233，姓名张三，渠道FB-M，炒群吴天，设备B22" },
  ],
  LEGACY: [
    { label: "老粉今天进群", text: "老客户112233，8月20日接粉，渠道FB-M，归属演示接粉，今天进群，炒群吴天，设备B22" },
    { label: "老粉今天开单", text: "老客户112233，8月20日接粉，渠道FB-M，归属演示接粉，今天开单，专家西瓜，炒群吴天，首充1000，加密货币" },
    { label: "老粉今天续充", text: "老客户112233，8月20日接粉，渠道FB-M，归属演示接粉，历史已开单，今天续充500，银行卡，专家西瓜，炒群吴天" },
  ],
  PROGRESS: [
    { label: "登记注册", text: "客户112233今天注册" },
    { label: "登记开单", text: "客户112233今天开单，首充1000，加密货币" },
    { label: "新增续充", text: "客户112233今天续充500，银行卡" },
    { label: "登记出金", text: "客户112233今天出金100" },
  ],
};

type CustomerContext = {
  actorId?: string;
  today: string;
  channelOptions: Array<{ id: string; name: string }>;
  memberOptions: Array<{ id: string; name: string }>;
};

type CustomerDraft = { phone: string; customerName: string; channelId: string; joinedOn: string; groupOperatorOwnerId: string; deviceCode: string };
type CustomerBatchPreview = { validPhones: string[]; duplicates: string[]; invalid: string[]; totalInput: number };
const EMPTY_CUSTOMER: CustomerDraft = { phone: "", customerName: "", channelId: "", joinedOn: "", groupOperatorOwnerId: "", deviceCode: "" };

type ProgressCustomer = {
  id: string; phone: string; customerName: string | null; joinedOn: string | null; groupStatus: string;
  registeredOn: string | null;
  groupOperatorOwner: { id: string; name: string } | null; expertOwner: { id: string; name: string } | null;
  device: { id: string; code: string } | null; batch: { id: string; channel: { name: string } };
  order: { id: string; nextContinuationNumber: number } | null;
};
type ProgressContext = CustomerContext & { customers: ProgressCustomer[]; expertOptions: Array<{ id: string; name: string }> };
type ProgressAction = "groupNote" | "assignOperator" | "device" | "assignExpert" | "expertNote" | "register" | "normalLeave" | "abnormalLeave" | "initial" | "recharge" | "withdrawal";
type ProgressDraft = { action: ProgressAction | null; text: string; userId: string; amountCents: number; depositMethod: "CRYPTO" | "BANK" };
const EMPTY_PROGRESS: ProgressDraft = { action: null, text: "", userId: "", amountCents: 0, depositMethod: "CRYPTO" };
const PROGRESS_LABELS: Record<ProgressAction, string> = {
  groupNote: "更新炒群情况", assignOperator: "更换炒群负责人", device: "更换设备账号", assignExpert: "推专家",
  expertNote: "更新专家情况", register: "登记注册", normalLeave: "正常退群", abnormalLeave: "异常退群",
  initial: "登记首充", recharge: "新增续充", withdrawal: "登记出金",
};

type LegacyScenario = "JOIN" | "ORDER" | "RECHARGE";
type LegacyContext = CustomerContext & { actorId: string; expertOptions: Array<{ id: string; name: string }> };
type LegacyDraft = {
  scenario: LegacyScenario | null; phone: string; customerName: string; sourceDate: string; channelId: string;
  receptionOwnerId: string; deviceCode: string; baselineOn: string; groupOperatorOwnerId: string;
  expertOwnerId: string; occurredOn: string; amountCents: number; depositMethod: "CRYPTO" | "BANK";
};
const EMPTY_LEGACY: LegacyDraft = { scenario: null, phone: "", customerName: "", sourceDate: "", channelId: "", receptionOwnerId: "", deviceCode: "", baselineOn: "", groupOperatorOwnerId: "", expertOwnerId: "", occurredOn: "", amountCents: 0, depositMethod: "CRYPTO" };
const LEGACY_SCENARIOS: Record<LegacyScenario, { label: string; note: string; baselineStage: "REPLIED" | "REGISTERED" | "ORDERED"; currentEvent: "JOINED" | "ORDERED" | "RECHARGE" }> = {
  JOIN: { label: "老粉今天进群", note: "历史接粉不重算，只增加本次进群", baselineStage: "REPLIED", currentEvent: "JOINED" },
  ORDER: { label: "老粉今天开单", note: "历史进度不重算，只增加本次开单和首充", baselineStage: "REGISTERED", currentEvent: "ORDERED" },
  RECHARGE: { label: "已开单老粉今天续充", note: "历史开单不重算，只增加本次续充", baselineStage: "ORDERED", currentEvent: "RECHARGE" },
};

function amount(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value / 100);
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? `${(numerator / denominator * 100).toFixed(1)}%` : "0.0%";
}

function calculated(values: Values, lawyer: boolean) {
  if (lawyer) {
    const deposits = values.cryptoInitialDepositCents + values.bankInitialDepositCents + values.cryptoRechargeCents + values.bankRechargeCents;
    return {
      effective: values.lawyerRealCaseCount,
      replyRate: percent(values.replyCount, values.dispatchCount),
      joinRate: "—",
      abnormalRate: "—",
      current: "—",
      registrationRate: percent(values.lawyerAddedCount, values.dispatchCount),
      orderRate: percent(values.lawyerExpertAddedCount, values.dispatchCount),
      net: deposits - values.withdrawalCents,
    };
  }
  const effective = Math.max(0, values.dispatchCount - values.duplicateCount - values.lowAmountCount - values.noWsCount - values.manualInvalidCount);
  return {
    effective,
    replyRate: percent(values.replyCount, effective),
    joinRate: percent(values.joinCount, effective),
    abnormalRate: percent(values.abnormalLeaveCount, Math.max(0, values.joinCount - values.normalLeaveCount)),
    current: Math.max(0, values.joinCount - values.normalLeaveCount - values.abnormalLeaveCount),
    registrationRate: percent(values.registrationCount, values.expertIntroCount),
    orderRate: percent(values.orderCount, values.registrationCount),
    net: values.cryptoInitialDepositCents + values.bankInitialDepositCents + values.cryptoRechargeCents + values.bankRechargeCents - values.withdrawalCents,
  };
}

function validate(values: Values, lawyer: boolean) {
  if (lawyer) {
    if (values.replyCount > values.dispatchCount) return "回复数量不能超过接粉数量";
    if (values.lowAmountCount > values.dispatchCount) return "接粉小金额不能超过接粉数量";
    if (values.lawyerRealCaseCount > values.dispatchCount) return "接粉真实案件不能超过接粉数量";
    if (values.lawyerAddedCount > values.dispatchCount) return "添加律师不能超过接粉数量";
    if (values.lawyerExpertAddedCount > values.dispatchCount) return "添加专家不能超过接粉数量";
    return "";
  }
  const result = calculated(values, false);
  if (values.duplicateCount + values.lowAmountCount + values.noWsCount + values.manualInvalidCount > values.dispatchCount)
    return "撞粉、低金额、无 WS 和人工无效的合计不能超过添加数据";
  if (values.replyCount > result.effective) return "回复数量不能超过有效数据";
  if (values.joinCount > result.effective) return "进群数量不能超过有效数据";
  return "";
}

function parseAnswer(raw: string, money = false) {
  const matched = raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!matched) return { error: money ? "请输入金额，例如 1000 或 1000.50" : "请输入数量，例如 10" };
  const value = Number(matched[0]);
  if (!Number.isFinite(value) || value < 0) return { error: "数字不能小于 0" };
  if (!money && !Number.isInteger(value)) return { error: "数量必须填写整数" };
  if (money && !/^\d+(?:\.\d{1,2})?$/.test(matched[0])) return { error: "金额最多保留两位小数" };
  return { value };
}

type AiSmartAssistantProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextLabel: string;
};

export function AiSmartAssistant({ open, onOpenChange, contextLabel }: AiSmartAssistantProps) {
  const [input, setInput] = useState("");
  const [naturalIntent, setNaturalIntent] = useState<NaturalIntent | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [context, setContext] = useState<DailyContext | null>(null);
  const [channelId, setChannelId] = useState("");
  const [entryId, setEntryId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Values>({ ...EMPTY_VALUES });
  const [fieldIndex, setFieldIndex] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [validationError, setValidationError] = useState("");
  const [customerContext, setCustomerContext] = useState<CustomerContext | null>(null);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>({ ...EMPTY_CUSTOMER });
  const [customerMode, setCustomerMode] = useState<"single" | "batch" | null>(null);
  const [customerBatchText, setCustomerBatchText] = useState("");
  const [customerBatchPreview, setCustomerBatchPreview] = useState<CustomerBatchPreview | null>(null);
  const [customerBatchCreated, setCustomerBatchCreated] = useState(0);
  const [progressContext, setProgressContext] = useState<ProgressContext | null>(null);
  const [progressCustomer, setProgressCustomer] = useState<ProgressCustomer | null>(null);
  const [progressDraft, setProgressDraft] = useState<ProgressDraft>({ ...EMPTY_PROGRESS });
  const [legacyContext, setLegacyContext] = useState<LegacyContext | null>(null);
  const [legacyDraft, setLegacyDraft] = useState<LegacyDraft>({ ...EMPTY_LEGACY });
  const messageIdRef = useRef(1);
  const conversationRef = useRef<HTMLDivElement>(null);

  const lawyer = context?.groupType === "LAWYER";
  const fields = lawyer ? LAWYER_FIELDS : HACKER_FIELDS;
  const selectedChannel = context?.channels.find((channel) => channel.id === channelId) ?? null;
  const selectedCustomerChannel = customerContext?.channelOptions.find((channel) => channel.id === customerDraft.channelId) ?? null;
  const selectedCustomerOperator = customerContext?.memberOptions.find((member) => member.id === customerDraft.groupOperatorOwnerId) ?? null;
  const selectedLegacyChannel = legacyContext?.channelOptions.find((item) => item.id === legacyDraft.channelId) ?? null;
  const selectedLegacyReception = legacyContext?.memberOptions.find((item) => item.id === legacyDraft.receptionOwnerId) ?? null;
  const selectedLegacyOperator = legacyContext?.memberOptions.find((item) => item.id === legacyDraft.groupOperatorOwnerId) ?? null;
  const selectedLegacyExpert = legacyContext?.expertOptions.find((item) => item.id === legacyDraft.expertOwnerId) ?? null;
  const summary = useMemo(() => calculated(draft, Boolean(lawyer)), [draft, lawyer]);
  const displayedNaturalTemplates = useMemo(() => {
    if (!naturalIntent) return [];
    if (naturalIntent === "DAILY" && context?.channels.length) {
      const base = context.groupType === "LAWYER"
        ? "今天 CHANNEL：接粉20，回复8，接粉小金额1，接粉真实案件10，添加律师5，添加专家3，总推客服3，总注册2，总开单1，加密货币充值1000，银行卡充值0，出金0"
        : NATURAL_TEMPLATES.DAILY[0].text;
      return context.channels.map((channel) => ({ label: `今日数据 · ${channel.name}`, text: base.replace("FB-M", channel.name).replace("CHANNEL", channel.name) }));
    }
    if (naturalIntent === "CUSTOMER" && customerContext?.channelOptions.length) {
      const operator = customerContext.memberOptions[0]?.name ?? "炒群负责人";
      return customerContext.channelOptions.map((channel) => ({ label: `新增客户 · ${channel.name}`, text: NATURAL_TEMPLATES.CUSTOMER[0].text.replace("FB-M", channel.name).replace("吴天", operator) }));
    }
    if (naturalIntent === "LEGACY" && legacyContext?.channelOptions.length) {
      const reception = legacyContext.memberOptions.find((item) => item.id === legacyContext.actorId)?.name ?? legacyContext.memberOptions[0]?.name ?? "接粉组员";
      const operator = legacyContext.memberOptions.find((item) => item.id !== legacyContext.actorId)?.name ?? reception;
      const expert = legacyContext.expertOptions[0]?.name ?? "专家负责人";
      const channel = legacyContext.channelOptions[0].name;
      return NATURAL_TEMPLATES.LEGACY.map((template) => ({ ...template, text: template.text.replace("FB-M", channel).replace("演示接粉", reception).replace("吴天", operator).replace("西瓜", expert) }));
    }
    return NATURAL_TEMPLATES[naturalIntent];
  }, [naturalIntent, context, customerContext, legacyContext]);

  useEffect(() => {
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, phase]);

  function addMessage(role: Message["role"], text: string) {
    const id = messageIdRef.current++;
    setMessages((current) => [...current, { id, role, text }]);
  }

  function reset() {
    setInput(""); setNaturalIntent(null); setPhase("idle"); setMessages([]); setContext(null); setChannelId(""); setEntryId(null);
    setDraft({ ...EMPTY_VALUES }); setFieldIndex(0); setEditingIndex(null); setValidationError("");
    setCustomerContext(null); setCustomerDraft({ ...EMPTY_CUSTOMER });
    setCustomerMode(null); setCustomerBatchText(""); setCustomerBatchPreview(null); setCustomerBatchCreated(0);
    setProgressContext(null); setProgressCustomer(null); setProgressDraft({ ...EMPTY_PROGRESS });
    setLegacyContext(null); setLegacyDraft({ ...EMPTY_LEGACY });
    messageIdRef.current = 1;
  }

  async function openNaturalTemplate(intent: NaturalIntent, title: string) {
    setNaturalIntent(intent); setPhase("loading"); setInput("");
    setMessages([{ id: 0, role: "user", text: title }, { id: 1, role: "assistant", text: "正在读取本组真实渠道和人员，为你生成可直接使用的模板…" }]);
    messageIdRef.current = 2;
    try {
      if (intent === "DAILY") setContext(await requestJson<DailyContext>("/api/daily-stats"));
      if (intent === "CUSTOMER") setCustomerContext(await requestJson<CustomerContext>("/api/lead/customer-reporting?stage=group&page=1"));
      if (intent === "LEGACY") setLegacyContext(await requestJson<LegacyContext>("/api/lead/customer-reporting?stage=group&page=1"));
      addMessage("assistant", "模板已经换成本组真实名称。点击模板后，只需要修改号码和数字，再发送即可；我会先生成预览，不会直接保存。");
      setPhase("template");
    } catch (caught) {
      addMessage("assistant", caught instanceof Error ? `真实资料读取失败：${caught.message}` : "真实资料读取失败，请稍后重试。");
      setPhase("idle");
    }
  }

  function optionInText<T extends { id: string; name: string }>(text: string, options: T[]) {
    return [...options].sort((a, b) => b.name.length - a.name.length).find((item) => text.includes(item.name)) ?? null;
  }

  function optionAfter<T extends { id: string; name: string }>(text: string, label: string, options: T[]) {
    const start = text.indexOf(label); if (start < 0) return null;
    const segment = text.slice(start + label.length).split(/[，,；;。\n]/)[0] ?? "";
    return optionInText(segment, options);
  }

  function numberAfter(text: string, labels: string[]) {
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matched = text.match(new RegExp(`${escaped}\\s*[:：]?\\s*\\$?([\\d,]+(?:\\.\\d+)?)`, "i"));
      if (matched) return Number(matched[1].replace(/,/g, ""));
    }
    return null;
  }

  function phoneIn(text: string) {
    const matched = text.match(/(?:老客户|客户|号码)\s*[:：]?\s*([+\d][\d\s()+-]{5,})/);
    const digits = matched?.[1].replace(/\D/g, "") ?? "";
    return digits.length >= 6 ? digits.slice(-6) : "";
  }

  function textAfter(text: string, label: string) {
    const start = text.indexOf(label); if (start < 0) return "";
    return (text.slice(start + label.length).split(/[，,；;。\n]/)[0] ?? "").replace(/^[:：\s]+/, "").trim();
  }

  async function parseNaturalDaily(text: string) {
    setPhase("loading"); addMessage("user", text); addMessage("assistant", "正在识别渠道和指标…"); setInput("");
    try {
      const next = await requestJson<DailyContext>("/api/daily-stats");
      const channel = optionInText(text, next.channels) ?? (next.channels.length === 1 ? next.channels[0] : null);
      if (!channel) { addMessage("assistant", `没有识别出渠道，请在内容里写上渠道名称。可选：${next.channels.map((item) => item.name).join("、")}`); setPhase("template"); return; }
      const existing = next.unifiedEntries.find((item) => item.businessDate === next.today && item.channel.id === channel.id) ?? null;
      let values = existing ? { ...EMPTY_VALUES, ...existing.values } : { ...EMPTY_VALUES }; let found = 0;
      const mappings: Array<{ key: keyof Values; labels: string[]; money?: boolean }> = next.groupType === "LAWYER" ? [
        { key: "dispatchCount", labels: ["接粉"] }, { key: "replyCount", labels: ["回复"] }, { key: "lowAmountCount", labels: ["接粉小金额", "小金额"] },
        { key: "lawyerRealCaseCount", labels: ["接粉真实案件", "真实案件"] }, { key: "lawyerAddedCount", labels: ["添加律师"] }, { key: "lawyerExpertAddedCount", labels: ["添加专家"] },
        { key: "customerServicePushCount", labels: ["总推客服", "推客服"] }, { key: "registrationCount", labels: ["总注册", "注册"] }, { key: "orderCount", labels: ["总开单", "开单"] },
        { key: "cryptoInitialDepositCents", labels: ["加密货币充值", "加密充值"], money: true }, { key: "bankInitialDepositCents", labels: ["银行卡充值", "银行充值"], money: true }, { key: "withdrawalCents", labels: ["出金"], money: true },
      ] : [
        { key: "dispatchCount", labels: ["添加数据", "添加"] }, { key: "duplicateCount", labels: ["撞粉"] }, { key: "lowAmountCount", labels: ["低金额"] }, { key: "noWsCount", labels: ["无WS", "无 WS", "无号码"] },
        { key: "manualInvalidCount", labels: ["人工无效"] }, { key: "replyCount", labels: ["回复"] }, { key: "joinCount", labels: ["进群"] }, { key: "normalLeaveCount", labels: ["正常退群"] },
        { key: "abnormalLeaveCount", labels: ["异常退群"] }, { key: "expertIntroCount", labels: ["推专家"] }, { key: "registrationCount", labels: ["注册"] }, { key: "orderCount", labels: ["开单"] },
        { key: "cryptoInitialDepositCents", labels: ["首充"], money: true }, { key: "cryptoRechargeCents", labels: ["续充"], money: true }, { key: "withdrawalCents", labels: ["出金"], money: true },
      ];
      for (const mapping of mappings) {
        const value = numberAfter(text, mapping.labels); if (value === null) continue;
        values = { ...values, [mapping.key]: mapping.money ? Math.round(value * 100) : Math.round(value) }; found += 1;
      }
      if (!found) { addMessage("assistant", "没有识别出任何指标。请点击模板后修改数字再发送。"); setPhase("template"); return; }
      setContext(next); setChannelId(channel.id); setEntryId(existing?.entryId ?? null); setDraft(values); setValidationError(validate(values, next.groupType === "LAWYER")); setPhase("preview");
      addMessage("assistant", `已识别 ${found} 个指标，未提到的指标保持原值。请核对预览后确认保存。`);
    } catch (caught) { addMessage("assistant", caught instanceof Error ? caught.message : "数据识别失败，请重试。"); setPhase("template"); }
  }

  async function parseNaturalCustomer(text: string) {
    setPhase("customer-loading"); addMessage("user", text); addMessage("assistant", "正在识别客户号码、渠道和负责人…"); setInput("");
    try {
      const next = await requestJson<CustomerContext>("/api/lead/customer-reporting?stage=group&page=1");
      const phone = phoneIn(text); const channel = optionAfter(text, "渠道", next.channelOptions) ?? optionInText(text, next.channelOptions);
      const operator = optionAfter(text, "炒群", next.memberOptions); const deviceCode = textAfter(text, "设备") || textAfter(text, "设备号"); const customerName = textAfter(text, "姓名");
      const missing = [!phone && "客户号码", !channel && "来源渠道", !operator && "炒群负责人", !deviceCode && "设备号"].filter(Boolean);
      if (missing.length) { setCustomerContext(next); addMessage("assistant", `还缺少：${missing.join("、")}。请点击模板补齐这些内容后重新发送。`); setPhase("template"); return; }
      setCustomerContext(next); setCustomerMode("single"); setCustomerDraft({ phone, customerName, channelId: channel!.id, joinedOn: next.today, groupOperatorOwnerId: operator!.id, deviceCode }); setPhase("customer-preview");
      addMessage("assistant", "客户资料已一次识别完成，请核对预览后确认新增。");
    } catch (caught) { addMessage("assistant", caught instanceof Error ? caught.message : "客户资料识别失败。"); setPhase("template"); }
  }

  async function parseNaturalLegacy(text: string) {
    setPhase("legacy-loading"); addMessage("user", text); addMessage("assistant", "正在识别老客户历史底账和今天的新进度…"); setInput("");
    try {
      const next = await requestJson<LegacyContext>("/api/lead/customer-reporting?stage=group&page=1");
      const scenario: LegacyScenario | null = /续充/.test(text) ? "RECHARGE" : /开单|首充/.test(text) ? "ORDER" : /进群/.test(text) ? "JOIN" : null;
      const phone = phoneIn(text); const dateRaw = text.match(/((?:(?:\d{4})[年./-])?\d{1,2}[月./-]\d{1,2}(?:日|号)?)\s*接粉/)?.[1] ?? "";
      const sourceDate = aiDate(dateRaw, next.today); const channel = optionAfter(text, "渠道", next.channelOptions) ?? optionInText(text, next.channelOptions);
      const reception = optionAfter(text, "归属", next.memberOptions) ?? next.memberOptions.find((item) => item.id === next.actorId) ?? null;
      const operator = optionAfter(text, "炒群", next.memberOptions); const expert = optionAfter(text, "专家", next.expertOptions);
      const deviceCode = textAfter(text, "设备号") || textAfter(text, "设备"); const amountValue = numberAfter(text, scenario === "ORDER" ? ["首充"] : ["续充"]);
      const missing = [!scenario && "今天发生的场景", !phone && "客户号码", !sourceDate && "接粉日期", !channel && "来源渠道", !reception && "接粉归属", !operator && "炒群负责人", scenario !== "JOIN" && !expert && "专家负责人", scenario !== "JOIN" && !amountValue && "金额"].filter(Boolean);
      if (missing.length) { setLegacyContext(next); addMessage("assistant", `还缺少：${missing.join("、")}。请点击对应模板补齐后重新发送。`); setPhase("template"); return; }
      setLegacyContext(next); setLegacyDraft({ scenario, phone, customerName: textAfter(text, "姓名"), sourceDate: sourceDate!, channelId: channel!.id, receptionOwnerId: reception!.id, deviceCode, baselineOn: sourceDate!, groupOperatorOwnerId: operator!.id, expertOwnerId: expert?.id ?? "", occurredOn: next.today, amountCents: amountValue ? Math.round(amountValue * 100) : 0, depositMethod: /银行卡|银行/.test(text) ? "BANK" : "CRYPTO" }); setPhase("legacy-preview");
      addMessage("assistant", "老客户资料已一次识别完成。历史状态日期默认采用接粉日期，只保留底账；今天的新进度才进入统计。请核对预览。");
    } catch (caught) { addMessage("assistant", caught instanceof Error ? caught.message : "老客户资料识别失败。"); setPhase("template"); }
  }

  async function parseNaturalProgress(text: string) {
    setPhase("progress-loading"); addMessage("user", text); addMessage("assistant", "正在查找客户并识别本次进度…"); setInput("");
    try {
      const phone = phoneIn(text); if (!phone) { addMessage("assistant", "没有识别出客户号码，请使用模板补上号码后重新发送。"); setPhase("template"); return; }
      const result = await requestJson<ProgressContext>(`/api/lead/customer-reporting?stage=group&page=1&q=${encodeURIComponent(phone)}`); const customer = result.customers.find((item) => item.phone === phone) ?? null;
      if (!customer) { addMessage("assistant", `本组共享客户表没有找到 ${phone}。`); setPhase("template"); return; }
      const action: ProgressAction | null = /续充/.test(text) ? "recharge" : /出金/.test(text) ? "withdrawal" : /开单|首充/.test(text) ? "initial" : /注册/.test(text) ? "register" : /异常退群/.test(text) ? "abnormalLeave" : /正常退群|退群/.test(text) ? "normalLeave" : null;
      if (!action) { addMessage("assistant", "没有识别出要更新的进度。目前模板支持注册、开单、续充和出金。"); setPhase("template"); return; }
      if (action === "initial" && (!customer.registeredOn || customer.order)) { addMessage("assistant", customer.order ? "该客户已经开单，不能重复登记首充。" : "该客户尚未登记注册，请先登记注册。"); setPhase("template"); return; }
      if ((action === "recharge" || action === "withdrawal") && !customer.order) { addMessage("assistant", "该客户还没有开单，不能登记续充或出金。"); setPhase("template"); return; }
      const amountValue = ["initial", "recharge", "withdrawal"].includes(action) ? numberAfter(text, action === "initial" ? ["首充", "开单"] : action === "recharge" ? ["续充"] : ["出金"]) : 0;
      if (["initial", "recharge", "withdrawal"].includes(action) && !amountValue) { addMessage("assistant", "没有识别出本次金额，请在首充、续充或出金后面填写金额。"); setPhase("template"); return; }
      setProgressContext(result); setProgressCustomer(customer); setProgressDraft({ action, text: "", userId: "", amountCents: amountValue ? Math.round(amountValue * 100) : 0, depositMethod: /银行卡|银行/.test(text) ? "BANK" : "CRYPTO" }); setPhase("progress-preview");
      addMessage("assistant", `已识别“${PROGRESS_LABELS[action]}”，请核对预览后确认更新。`);
    } catch (caught) { addMessage("assistant", caught instanceof Error ? caught.message : "客户进度识别失败。"); setPhase("template"); }
  }

  function parseNaturalEntry(text: string) {
    if (naturalIntent === "DAILY") { void parseNaturalDaily(text); return; }
    if (naturalIntent === "CUSTOMER") { void parseNaturalCustomer(text); return; }
    if (naturalIntent === "LEGACY") { void parseNaturalLegacy(text); return; }
    if (naturalIntent === "PROGRESS") { void parseNaturalProgress(text); }
  }

  async function startLegacyFlow() {
    if (phase === "legacy-loading" || phase === "legacy-saving") return;
    setPhase("legacy-loading");
    setMessages([{ id: 0, role: "user", text: "录入老客户进度" }, { id: 1, role: "assistant", text: "正在读取本组渠道和人员，请稍候…" }]);
    messageIdRef.current = 2;
    setLegacyDraft({ ...EMPTY_LEGACY });
    try {
      const next = await requestJson<LegacyContext>("/api/lead/customer-reporting?stage=group&page=1");
      setLegacyContext(next);
      if (!next.channelOptions.length || !next.memberOptions.length) {
        addMessage("assistant", "当前小组缺少可用渠道或组员，暂时不能录入老客户。");
        setPhase("idle"); return;
      }
      setLegacyDraft({ ...EMPTY_LEGACY, occurredOn: next.today, receptionOwnerId: next.memberOptions.find((item) => item.id === next.actorId)?.id ?? next.memberOptions[0]?.id ?? "" });
      addMessage("assistant", "请选择这位老客户今天发生的真实场景。历史事实只留档，不会重复计算。");
      setPhase("legacy-scenario");
    } catch (caught) {
      addMessage("assistant", caught instanceof Error ? `资料读取失败：${caught.message}` : "资料读取失败，请稍后重试。");
      setPhase("idle");
    }
  }

  function chooseLegacyScenario(scenario: LegacyScenario) {
    const meta = LEGACY_SCENARIOS[scenario];
    setLegacyDraft((current) => ({ ...EMPTY_LEGACY, scenario, occurredOn: legacyContext?.today ?? current.occurredOn, receptionOwnerId: legacyContext?.memberOptions.find((item) => item.id === legacyContext.actorId)?.id ?? legacyContext?.memberOptions[0]?.id ?? "" }));
    addMessage("user", meta.label);
    addMessage("assistant", "请填写这位客户最早的接粉日期，例如 2026-08-20。这个日期只作为来源底账，不增加今天接粉量。");
    setPhase("legacy-source-date");
  }

  function aiDate(raw: string, today: string) {
    const value = raw.trim();
    if (value === "今天") return today;
    const currentYear = today.slice(0, 4);
    const chinese = value.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)?$/);
    const separated = value.match(/^(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})$/);
    const matched = chinese ?? separated;
    if (!matched) return null;
    const year = Number(matched[1] ?? currentYear); const month = Number(matched[2]); const day = Number(matched[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function acceptLegacyText(raw: string) {
    if (!legacyContext || !legacyDraft.scenario) return;
    const value = raw.trim();
    if (phase === "legacy-source-date") {
      addMessage("user", value);
      const date = aiDate(value, legacyContext.today); if (!date || date > legacyContext.today) { addMessage("assistant", `没有识别出这个接粉日期。可以输入“8月20日”“8/20”或“2026-08-20”，并且不能晚于今天 ${legacyContext.today}。`); setInput(""); return; }
      setLegacyDraft((current) => ({ ...current, sourceDate: date }));
      addMessage("assistant", "请输入客户完整号码或号码后 6 位。完整号码保存时只保留最后 6 位。"); setInput(""); setPhase("legacy-phone"); return;
    }
    if (phase === "legacy-phone") {
      const digits = value.replace(/\D/g, ""); if (digits.length < 6) { addMessage("assistant", "客户号码至少需要 6 位数字。"); return; }
      const phone = digits.slice(-6); setLegacyDraft((current) => ({ ...current, phone })); addMessage("user", value);
      addMessage("assistant", `号码将保存为 ${phone}。请输入客户姓名，不填写请回复“跳过”。`); setInput(""); setPhase("legacy-name"); return;
    }
    if (phase === "legacy-name") {
      const customerName = /^(跳过|没有|无|不填|-)$/.test(value) ? "" : value.slice(0, 100);
      setLegacyDraft((current) => ({ ...current, customerName })); addMessage("user", value);
      addMessage("assistant", "请选择这位客户最初的来源渠道。"); setInput(""); setPhase("legacy-channel"); return;
    }
    if (phase === "legacy-device") {
      const deviceCode = /^(跳过|没有|无|不填|-)$/.test(value) ? "" : value.slice(0, 100);
      setLegacyDraft((current) => ({ ...current, deviceCode })); addMessage("user", value);
      addMessage("assistant", `请填写系统启用前最后状态的发生日期。不能早于接粉日期 ${legacyDraft.sourceDate}；如果是同一天，直接点击或回复“同接粉日”。该日期只留历史，不计入新统计。`); setInput(""); setPhase("legacy-baseline-date"); return;
    }
    if (phase === "legacy-baseline-date") {
      addMessage("user", value);
      const date = /^(同接粉日|接粉日|同一天)$/.test(value) ? legacyDraft.sourceDate : aiDate(value, legacyContext.today);
      if (!date) { addMessage("assistant", "没有识别出这个日期。可以输入“8月20日”“8/20”或“2026-08-20”，也可以直接回复“同接粉日”。"); setInput(""); return; }
      if (date < legacyDraft.sourceDate) { addMessage("assistant", `你填的是 ${date}，但接粉日期是 ${legacyDraft.sourceDate}。客户进度不能发生在接粉之前；请填写 ${legacyDraft.sourceDate} 至 ${legacyContext.today}，或回复“同接粉日”。`); setInput(""); return; }
      if (date > legacyContext.today) { addMessage("assistant", `你填的是未来日期。请填写不晚于今天 ${legacyContext.today} 的日期。`); setInput(""); return; }
      setLegacyDraft((current) => ({ ...current, baselineOn: date }));
      addMessage("assistant", "请选择负责这位客户的炒群负责人。"); setInput(""); setPhase("legacy-operator"); return;
    }
    if (phase === "legacy-occurred-date") {
      addMessage("user", value);
      const date = aiDate(value, legacyContext.today);
      if (!date) { addMessage("assistant", "没有识别出这个日期。可以输入“今天”“9月2日”“9/2”或完整日期。"); setInput(""); return; }
      if (date < legacyDraft.baselineOn) { addMessage("assistant", `你填的是 ${date}，但历史最后状态日期是 ${legacyDraft.baselineOn}。本次新进度不能发生在历史状态之前。`); setInput(""); return; }
      if (date > legacyContext.today) { addMessage("assistant", `你填的是未来日期。请填写不晚于今天 ${legacyContext.today} 的日期。`); setInput(""); return; }
      setLegacyDraft((current) => ({ ...current, occurredOn: date })); setInput("");
      if (legacyDraft.scenario === "JOIN") { addMessage("assistant", "资料已经整理完成，请核对后确认保存。"); setPhase("legacy-preview"); return; }
      addMessage("assistant", `请输入本次${legacyDraft.scenario === "ORDER" ? "首充" : "续充"}金额，例如 1000。`); setPhase("legacy-amount"); return;
    }
    if (phase === "legacy-amount") {
      const parsed = parseAnswer(value, true); if (parsed.error || !parsed.value || parsed.value <= 0) { addMessage("assistant", parsed.error ?? "金额必须大于 0。"); return; }
      setLegacyDraft((current) => ({ ...current, amountCents: Math.round(parsed.value! * 100) })); addMessage("user", value);
      addMessage("assistant", "请选择本次入金方式。"); setInput(""); setPhase("legacy-method");
    }
  }

  function chooseLegacyChannel(id: string) {
    const item = legacyContext?.channelOptions.find((option) => option.id === id); if (!item) return;
    setLegacyDraft((current) => ({ ...current, channelId: id })); addMessage("user", item.name);
    addMessage("assistant", "请选择最初接到这位客户的归属组员。"); setPhase("legacy-reception");
  }

  function chooseLegacyReception(id: string) {
    const item = legacyContext?.memberOptions.find((option) => option.id === id); if (!item) return;
    setLegacyDraft((current) => ({ ...current, receptionOwnerId: id })); addMessage("user", item.name);
    addMessage("assistant", "请输入设备账号或设备号；暂时没有请回复“跳过”。"); setPhase("legacy-device");
  }

  function chooseLegacyOperator(id: string) {
    const item = legacyContext?.memberOptions.find((option) => option.id === id); if (!item) return;
    setLegacyDraft((current) => ({ ...current, groupOperatorOwnerId: id })); addMessage("user", item.name);
      if (legacyDraft.scenario === "JOIN") { addMessage("assistant", `请填写本次进群实际发生日期，今天是 ${legacyContext?.today}；如果就是今天，直接点击或回复“今天”。`); setPhase("legacy-occurred-date"); return; }
    addMessage("assistant", "请选择这位客户的专家负责人。"); setPhase("legacy-expert");
  }

  function chooseLegacyExpert(id: string) {
    const item = legacyContext?.expertOptions.find((option) => option.id === id); if (!item) return;
    setLegacyDraft((current) => ({ ...current, expertOwnerId: id })); addMessage("user", item.name);
    addMessage("assistant", `请填写本次${legacyDraft.scenario === "ORDER" ? "开单" : "续充"}实际发生日期，今天是 ${legacyContext?.today}；如果就是今天，直接点击或回复“今天”。`); setPhase("legacy-occurred-date");
  }

  function chooseLegacyMethod(method: "CRYPTO" | "BANK") {
    setLegacyDraft((current) => ({ ...current, depositMethod: method })); addMessage("user", method === "CRYPTO" ? "加密货币" : "银行卡");
    addMessage("assistant", "资料已经整理完成，请核对。AI 不会在你确认前写入数据。"); setPhase("legacy-preview");
  }

  async function saveLegacyCustomer() {
    if (!legacyContext || !legacyDraft.scenario) return;
    const meta = LEGACY_SCENARIOS[legacyDraft.scenario]; setPhase("legacy-saving"); addMessage("assistant", "正在保存老客户档案和本次真实进度…");
    try {
      await requestJson("/api/legacy-customers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        phone: legacyDraft.phone, customerName: legacyDraft.customerName, sourceDate: legacyDraft.sourceDate, channelId: legacyDraft.channelId,
        receptionOwnerId: legacyDraft.receptionOwnerId, groupOperatorOwnerId: legacyDraft.groupOperatorOwnerId,
        ...(legacyDraft.expertOwnerId ? { expertOwnerId: legacyDraft.expertOwnerId } : {}), ...(legacyDraft.deviceCode ? { deviceCode: legacyDraft.deviceCode } : {}),
        baselineStage: meta.baselineStage, baselineOn: legacyDraft.baselineOn, currentEvent: meta.currentEvent, occurredOn: legacyDraft.occurredOn,
        ...(legacyDraft.amountCents ? { amountCents: legacyDraft.amountCents, initialDepositMethod: legacyDraft.depositMethod } : {}),
      }) });
      setPhase("legacy-done"); addMessage("assistant", `${legacyDraft.phone} 已保存成功。${meta.note}，客户进度表和汇总已同步刷新。`); window.dispatchEvent(new Event("ai-data-updated"));
    } catch (caught) {
      setPhase("legacy-preview"); addMessage("assistant", caught instanceof Error ? `保存失败：${caught.message}` : "老客户保存失败，请稍后重试。");
    }
  }

  async function startCustomerFlow() {
    if (phase === "customer-loading" || phase === "customer-saving") return;
    setPhase("customer-loading");
    setMessages([{ id: 0, role: "user", text: "新增客户" }, { id: 1, role: "assistant", text: "正在读取今天的日期和来源渠道…" }]);
    messageIdRef.current = 2;
    setCustomerDraft({ ...EMPTY_CUSTOMER });
    setCustomerMode(null);
    setCustomerBatchText("");
    setCustomerBatchPreview(null);
    setCustomerBatchCreated(0);
    try {
      const next = await requestJson<CustomerContext>("/api/lead/customer-reporting?stage=group&page=1");
      setCustomerContext(next);
      if (!next.channelOptions.length) {
        setMessages((current) => [...current, { id: 2, role: "assistant", text: "当前小组还没有可用渠道，请先联系组长或管理员开设渠道。" }]);
        messageIdRef.current = 3;
        setPhase("idle");
        return;
      }
      setCustomerDraft({ ...EMPTY_CUSTOMER, joinedOn: next.today });
      setMessages((current) => [...current, { id: 2, role: "assistant", text: `这里新增的是“已进群客户”，进群日期自动记为 ${next.today}。请选择单个新增或批量新增。` }]);
      messageIdRef.current = 3;
      setPhase("customer-mode");
    } catch (caught) {
      setMessages((current) => [...current, { id: 2, role: "assistant", text: caught instanceof Error ? caught.message : "客户资料读取失败，请稍后重试。" }]);
      messageIdRef.current = 3;
      setPhase("idle");
    }
  }

  function chooseCustomerMode(mode: "single" | "batch") {
    setCustomerMode(mode);
    addMessage("user", mode === "single" ? "单个新增" : "批量新增");
    if (mode === "single") {
      addMessage("assistant", "请输入客户完整号码或号码后 6 位。完整号码会统一保留最后 6 位。" );
      setPhase("customer-phone");
      return;
    }
    addMessage("assistant", "请粘贴客户号码，一行一个；也支持使用逗号或分号分隔。一次最多 200 个。" );
    setPhase("customer-batch-input");
  }

  function customerBatchPhones() {
    return customerBatchText.split(/[\n,，;；]+/).map((value) => value.trim()).filter(Boolean);
  }

  function acceptCustomerBatch() {
    const phones = customerBatchPhones();
    if (!phones.length) {
      addMessage("assistant", "请先粘贴至少一个客户号码。" );
      return;
    }
    if (phones.length > 200) {
      addMessage("assistant", "一次最多处理 200 个客户，请分批操作。" );
      return;
    }
    addMessage("user", `已粘贴 ${phones.length} 条号码`);
    addMessage("assistant", "请选择这些客户的统一来源渠道。" );
    setPhase("customer-channel");
  }

  function acceptCustomerPhone(raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 6) {
      addMessage("assistant", "客户号码至少需要 6 位数字。可以输入完整号码，系统只保留最后 6 位。" );
      return;
    }
    const phone = digits.slice(-6);
    addMessage("user", raw.trim());
    setCustomerDraft((current) => ({ ...current, phone }));
    addMessage("assistant", `号码将保存为 ${phone}。请输入客户姓名；如果不需要填写，直接回复“跳过”。`);
    setInput("");
    setPhase("customer-name");
  }

  function acceptCustomerName(raw: string) {
    const skip = /^(跳过|没有|无|不填|-)$/.test(raw.trim());
    const name = skip ? "" : raw.trim().slice(0, 80);
    addMessage("user", raw.trim());
    setCustomerDraft((current) => ({ ...current, customerName: name }));
    addMessage("assistant", "请选择客户的来源渠道。" );
    setInput("");
    setPhase("customer-channel");
  }

  function chooseCustomerChannel(nextChannelId: string) {
    const channel = customerContext?.channelOptions.find((item) => item.id === nextChannelId);
    if (!channel) return;
    setCustomerDraft((current) => ({ ...current, channelId: channel.id }));
    addMessage("user", channel.name);
    addMessage("assistant", "请选择这些客户的炒群负责人。可选择本组任意在职成员。" );
    setPhase("customer-operator");
  }

  function chooseCustomerOperator(userId: string) {
    const member = customerContext?.memberOptions.find((item) => item.id === userId);
    if (!member) return;
    setCustomerDraft((current) => ({ ...current, groupOperatorOwnerId: member.id }));
    addMessage("user", member.name);
    addMessage("assistant", "请输入这些客户使用的设备账号或设备号。" );
    setPhase("customer-device");
  }

  async function acceptCustomerDevice(raw: string) {
    const deviceCode = raw.trim();
    if (!deviceCode) {
      addMessage("assistant", "设备账号不能为空，请重新输入。" );
      return;
    }
    if (deviceCode.length > 100) {
      addMessage("assistant", "设备账号不能超过 100 个字。" );
      return;
    }
    const nextDraft = { ...customerDraft, deviceCode };
    setCustomerDraft(nextDraft);
    addMessage("user", deviceCode);
    setInput("");
    if (customerMode !== "batch") {
      addMessage("assistant", "资料已经整理完成，请确认后再保存到组内共享客户进度表。" );
      setPhase("customer-preview");
      return;
    }
    setPhase("customer-loading");
    addMessage("assistant", "正在整理号码并检查重复客户…" );
    try {
      const preview = await requestJson<CustomerBatchPreview>("/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phones: customerBatchPhones(), ...nextDraft, dryRun: true }),
      });
      setCustomerBatchPreview(preview);
      addMessage("assistant", `检查完成：可新增 ${preview.validPhones.length} 个，重复 ${preview.duplicates.length} 个，格式错误 ${preview.invalid.length} 个。请核对后确认。`);
      setPhase("customer-batch-preview");
    } catch (caught) {
      addMessage("assistant", caught instanceof Error ? `检查失败：${caught.message}` : "号码检查失败，请稍后重试。" );
      setPhase("customer-device");
    }
  }

  async function saveCustomerBatch() {
    if (!customerContext || !selectedCustomerChannel || !customerBatchPreview?.validPhones.length) return;
    setPhase("customer-batch-saving");
    addMessage("assistant", "正在批量新增客户，请稍候…" );
    try {
      const result = await requestJson<{ created: Array<{ id: string; phone: string }>; duplicates: string[]; invalid: string[] }>("/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phones: customerBatchPhones(), ...customerDraft, channelId: selectedCustomerChannel.id, dryRun: false }),
      });
      setCustomerBatchCreated(result.created.length);
      setCustomerBatchPreview((current) => current ? { ...current, validPhones: result.created.map((customer) => customer.phone), duplicates: result.duplicates, invalid: result.invalid } : current);
      setPhase("customer-batch-done");
      addMessage("assistant", `批量新增完成：成功 ${result.created.length} 个，跳过重复 ${result.duplicates.length} 个，格式错误 ${result.invalid.length} 个。`);
      window.dispatchEvent(new Event("ai-data-updated"));
    } catch (caught) {
      setPhase("customer-batch-preview");
      addMessage("assistant", caught instanceof Error ? `批量新增失败：${caught.message}` : "批量新增失败，请稍后重试。" );
    }
  }

  function startProgressFlow() {
    setMessages([{ id: 0, role: "user", text: "更新客户进度" }, { id: 1, role: "assistant", text: "请输入客户完整号码或号码后 6 位，我会先找到客户再让你选择更新内容。" }]);
    messageIdRef.current = 2;
    setProgressContext(null); setProgressCustomer(null); setProgressDraft({ ...EMPTY_PROGRESS }); setInput("");
    setPhase("progress-phone");
  }

  async function acceptProgressPhone(raw: string) {
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 6) { addMessage("assistant", "客户号码至少需要 6 位数字。" ); return; }
    const phone = digits.slice(-6);
    addMessage("user", raw.trim()); setInput(""); setPhase("progress-loading");
    addMessage("assistant", `正在查找号码 ${phone}…`);
    try {
      const result = await requestJson<ProgressContext>(`/api/lead/customer-reporting?stage=group&page=1&q=${encodeURIComponent(phone)}`);
      const customer = result.customers.find((item) => item.phone === phone) ?? null;
      if (!customer) {
        addMessage("assistant", "没有在本组共享客户表中找到这个号码，请核对后重新输入。" );
        setPhase("progress-phone"); return;
      }
      setProgressContext(result); setProgressCustomer(customer);
      addMessage("assistant", `已找到 ${customer.phone}${customer.customerName ? `（${customer.customerName}）` : ""}，请选择需要更新的进度。`);
      setPhase("progress-action");
    } catch (caught) {
      addMessage("assistant", caught instanceof Error ? `查找失败：${caught.message}` : "查找客户失败，请稍后重试。" );
      setPhase("progress-phone");
    }
  }

  function progressReady(next: ProgressDraft, message: string) {
    setProgressDraft(next); addMessage("assistant", message); setPhase("progress-preview");
  }

  function chooseProgressAction(action: ProgressAction) {
    if (!progressCustomer || !progressContext) return;
    if ((action === "expertNote" || action === "register" || action === "initial") && !progressCustomer.expertOwner) {
      addMessage("assistant", "这个客户还没有专家负责人，请先选择“推专家”。" ); return;
    }
    if ((action === "recharge" || action === "withdrawal") && !progressCustomer.order) {
      addMessage("assistant", "这个客户还没有首充记录，请先登记首充。" ); return;
    }
    if (action === "initial" && progressCustomer.order) {
      addMessage("assistant", "这个客户已经登记过首充，不能重复开单；可以选择新增续充。" ); return;
    }
    if (action === "initial" && !progressCustomer.registeredOn) {
      addMessage("assistant", "这个客户还没有登记注册，请先选择“登记注册”，注册完成后才能登记首充。" ); return;
    }
    if (action === "register" && progressCustomer.registeredOn) {
      addMessage("assistant", `这个客户已经在 ${progressCustomer.registeredOn} 登记注册，不需要重复登记。`); return;
    }
    const next = { ...EMPTY_PROGRESS, action };
    setProgressDraft(next); addMessage("user", PROGRESS_LABELS[action]);
    if (action === "groupNote" || action === "expertNote") {
      addMessage("assistant", `请输入新的${action === "groupNote" ? "炒群" : "专家"}情况。`); setPhase("progress-text"); return;
    }
    if (action === "device") { addMessage("assistant", "请输入新的设备账号或设备号。" ); setPhase("progress-text"); return; }
    if (action === "assignOperator" || action === "assignExpert") {
      addMessage("assistant", `请选择${action === "assignOperator" ? "炒群负责人" : "专家负责人"}。`); setPhase("progress-person"); return;
    }
    if (action === "register" || action === "normalLeave" || action === "abnormalLeave") {
      progressReady(next, `将按统计日期 ${progressContext.today} 登记“${PROGRESS_LABELS[action]}”，请确认。`); return;
    }
    addMessage("assistant", `请输入本次${PROGRESS_LABELS[action].replace("登记", "").replace("新增", "")}金额。`); setPhase("progress-amount");
  }

  function acceptProgressValue(raw: string) {
    if (!progressDraft.action) return;
    if (phase === "progress-text") {
      const textValue = raw.trim();
      if (!textValue) { addMessage("assistant", "内容不能为空。" ); return; }
      if (textValue.length > 300) { addMessage("assistant", "内容不能超过 300 个字。" ); return; }
      addMessage("user", textValue); setInput("");
      progressReady({ ...progressDraft, text: textValue }, "内容已整理，请确认后保存。" ); return;
    }
    const parsed = parseAnswer(raw, true);
    if (parsed.error || parsed.value === undefined || parsed.value <= 0) { addMessage("assistant", parsed.error ?? "金额必须大于 0。" ); return; }
    const next = { ...progressDraft, amountCents: Math.round(parsed.value * 100) };
    addMessage("user", raw.trim()); setInput(""); setProgressDraft(next);
    if (progressDraft.action === "withdrawal") { progressReady(next, "出金金额已整理，请确认后保存。" ); return; }
    addMessage("assistant", "请选择入金方式。" ); setPhase("progress-method");
  }

  function chooseProgressPerson(userId: string) {
    if (!progressDraft.action || !progressContext) return;
    const options = progressDraft.action === "assignExpert" ? progressContext.expertOptions : progressContext.memberOptions;
    const person = options.find((item) => item.id === userId);
    if (!person) return;
    addMessage("user", person.name);
    progressReady({ ...progressDraft, userId }, `${PROGRESS_LABELS[progressDraft.action]}将设置为 ${person.name}，请确认。`);
  }

  function chooseProgressMethod(method: "CRYPTO" | "BANK") {
    addMessage("user", method === "CRYPTO" ? "加密货币" : "银行卡");
    progressReady({ ...progressDraft, depositMethod: method }, "金额和入金方式已经整理，请确认后保存。" );
  }

  async function saveProgressUpdate() {
    if (!progressCustomer || !progressContext || !progressDraft.action) return;
    const action = progressDraft.action; setPhase("progress-saving"); addMessage("assistant", "正在更新客户进度…" );
    try {
      if (action === "groupNote" || action === "expertNote") {
        await requestJson(`/api/leads/${progressCustomer.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(action === "groupNote" ? { action: "updateGroupProgress", progressNote: progressDraft.text, occurredOn: progressContext.today } : { action: "updateExpertDetails", expertNotes: progressDraft.text, occurredOn: progressContext.today }) });
      } else if (action === "assignOperator" || action === "assignExpert" || action === "device" || action === "register" || action === "normalLeave" || action === "abnormalLeave") {
        const body = action === "assignOperator" ? { action: "assignGroupOperator", userId: progressDraft.userId }
          : action === "assignExpert" ? { action: "assignExpert", userId: progressDraft.userId }
          : action === "device" ? { action: "setDeviceCode", code: progressDraft.text }
          : action === "register" ? { action: "setRegistration", occurredOn: progressContext.today }
          : { action: "setLeave", leaveType: action === "normalLeave" ? "NORMAL" : "ABNORMAL", occurredOn: progressContext.today };
        await requestJson(`/api/lead/customer-reporting/${progressCustomer.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      } else if (action === "initial") {
        await requestJson("/api/customer-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: progressCustomer.batch.id, leadId: progressCustomer.id, phone: progressCustomer.phone, openedOn: progressContext.today, initialDepositCents: progressDraft.amountCents, initialDepositMethod: progressDraft.depositMethod }) });
      } else {
        await requestJson("/api/customer-finance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerOrderId: progressCustomer.order!.id, occurredOn: progressContext.today, kind: action === "recharge" ? "RECHARGE" : "WITHDRAWAL", amountCents: progressDraft.amountCents, ...(action === "recharge" ? { depositMethod: progressDraft.depositMethod, continuationNumber: progressCustomer.order!.nextContinuationNumber } : {}) }) });
      }
      setPhase("progress-done"); addMessage("assistant", `${progressCustomer.phone} 的“${PROGRESS_LABELS[action]}”已保存成功。`); window.dispatchEvent(new Event("ai-data-updated"));
    } catch (caught) {
      setPhase("progress-preview"); addMessage("assistant", caught instanceof Error ? `更新失败：${caught.message}` : "客户进度更新失败。" );
    }
  }

  async function saveCustomer() {
    if (!customerContext || !selectedCustomerChannel || !customerDraft.phone) return;
    setPhase("customer-saving");
    addMessage("assistant", "正在新增客户，请稍候…");
    try {
      await requestJson("/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(customerDraft),
      });
      setPhase("customer-done");
      addMessage("assistant", `客户 ${customerDraft.phone} 已加入组内共享客户进度表，进群日期为 ${customerDraft.joinedOn}。`);
      window.dispatchEvent(new Event("ai-data-updated"));
    } catch (caught) {
      setPhase("customer-preview");
      addMessage("assistant", caught instanceof Error ? `新增失败：${caught.message}` : "新增客户失败，请稍后重试。" );
    }
  }

  async function startDailyFlow() {
    if (phase === "loading" || phase === "saving") return;
    setPhase("loading");
    setMessages([{ id: 0, role: "user", text: "添加今日数据" }, { id: 1, role: "assistant", text: "正在读取你的统计日期和可用渠道…" }]);
    messageIdRef.current = 2;
    setValidationError("");
    try {
      const next = await requestJson<DailyContext>("/api/daily-stats");
      setContext(next);
      if (!next.channels.length) {
        setMessages((current) => [...current, { id: 2, role: "assistant", text: "当前小组还没有可用渠道，请先联系组长或管理员开设渠道。" }]);
        setPhase("idle");
        return;
      }
      setMessages((current) => [...current, {
        id: 2, role: "assistant", text: `统计日期是 ${next.today}（${next.rolloverLabel}）。请选择这次要填写的来源渠道。`,
      }]);
      messageIdRef.current = 3;
      setPhase("channel");
    } catch (caught) {
      setMessages((current) => [...current, { id: 2, role: "assistant", text: caught instanceof Error ? caught.message : "读取数据失败，请稍后重试。" }]);
      setPhase("idle");
    }
  }

  function chooseChannel(nextChannelId: string) {
    if (!context) return;
    const channel = context.channels.find((item) => item.id === nextChannelId);
    if (!channel) return;
    const existing = context.unifiedEntries.find((item) => item.businessDate === context.today && item.channel.id === nextChannelId) ?? null;
    const nextDraft = existing ? { ...EMPTY_VALUES, ...existing.values } : { ...EMPTY_VALUES };
    setChannelId(nextChannelId);
    setEntryId(existing?.entryId ?? null);
    setDraft(nextDraft);
    setFieldIndex(0);
    setValidationError("");
    addMessage("user", channel.name);
    addMessage("assistant", existing
      ? `已选择 ${channel.name}。这个渠道今天已有数据，接下来会在现有数据上修改。`
      : `已选择 ${channel.name}。这个渠道今天还没有数据，将从 0 开始填写。`);
    const firstField = (context.groupType === "LAWYER" ? LAWYER_FIELDS : HACKER_FIELDS)[0];
    addMessage("assistant", `第 1/${context.groupType === "LAWYER" ? LAWYER_FIELDS.length : HACKER_FIELDS.length} 项：${firstField.question} 当前值是 ${firstField.money ? amount(firstField.read(nextDraft)) : firstField.read(nextDraft)}。`);
    setPhase("metrics");
  }

  function showPreview(nextDraft = draft) {
    const error = validate(nextDraft, Boolean(lawyer));
    setValidationError(error);
    setPhase("preview");
    addMessage("assistant", error ? `数据还不能保存：${error}。请点击“修改数据”进行纠正。` : "所有项目已经填写完成，请核对下面的保存预览。AI 不会在你确认前写入数据。" );
  }

  function acceptMetric(raw: string) {
    const targetIndex = phase === "editing" ? editingIndex : fieldIndex;
    if (targetIndex === null) return;
    const field = fields[targetIndex];
    if (!field) return;
    const parsed = parseAnswer(raw, field.money);
    if (parsed.error || parsed.value === undefined) {
      addMessage("assistant", parsed.error ?? "请重新填写。" );
      return;
    }
    addMessage("user", raw.trim());
    const nextDraft = field.write(draft, parsed.value);
    setDraft(nextDraft);
    setInput("");
    if (phase === "editing") {
      setEditingIndex(null);
      showPreview(nextDraft);
      return;
    }
    const nextIndex = fieldIndex + 1;
    if (nextIndex >= fields.length) {
      showPreview(nextDraft);
      return;
    }
    setFieldIndex(nextIndex);
    const nextField = fields[nextIndex];
    addMessage("assistant", `第 ${nextIndex + 1}/${fields.length} 项：${nextField.question} 当前值是 ${nextField.money ? amount(nextField.read(nextDraft)) : nextField.read(nextDraft)}。`);
  }

  function beginEdit(index: number) {
    const field = fields[index];
    setEditingIndex(index);
    setValidationError("");
    setPhase("editing");
    addMessage("assistant", `正在修改“${field.label}”。当前值是 ${field.money ? amount(field.read(draft)) : field.read(draft)}，请输入正确数字。`);
  }

  async function save() {
    if (!context || !selectedChannel || validationError) return;
    setPhase("saving");
    addMessage("assistant", "正在保存，请稍候…");
    try {
      const computed = calculated(draft, lawyer);
      const result = await requestJson<{ entry: { id: string } }>("/api/daily-stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(entryId ? { entryId } : {}),
          businessDate: context.today,
          expectedStatisticsDate: context.today,
          position: "RECEPTION",
          channelId: selectedChannel.id,
          sourceReceptionId: null,
          sourceGroupOperatorId: null,
          changeReason: null,
          values: {
            ...draft,
            effectiveCount: typeof computed.effective === "number" ? computed.effective : draft.effectiveCount,
            currentInGroupCount: typeof computed.current === "number" ? computed.current : draft.currentInGroupCount,
          },
        }),
      });
      setEntryId(result.entry.id);
      setContext((current) => current ? {
        ...current,
        unifiedEntries: [
          ...current.unifiedEntries.filter((item) => !(item.businessDate === current.today && item.channel.id === selectedChannel.id)),
          { entryId: result.entry.id, businessDate: current.today, channel: { id: selectedChannel.id, name: selectedChannel.name }, values: { ...draft } },
        ],
      } : current);
      setPhase("done");
      addMessage("assistant", `${context.today} · ${selectedChannel.name} 已保存成功，左侧当日数据表已同步刷新。`);
      window.dispatchEvent(new Event("ai-data-updated"));
    } catch (caught) {
      setPhase("preview");
      addMessage("assistant", caught instanceof Error ? `保存失败：${caught.message}` : "保存失败，请稍后重试。");
    }
  }

  function handleQuickAction(action: string) {
    if (action === "添加今日数据") { void openNaturalTemplate("DAILY", action); return; }
    if (action === "新增客户") { void openNaturalTemplate("CUSTOMER", action); return; }
    if (action === "录入老客户进度") { void openNaturalTemplate("LEGACY", action); return; }
    if (action === "更新客户进度") { void openNaturalTemplate("PROGRESS", action); return; }
    addMessage("user", action);
    addMessage("assistant", "这个入口会在下一步接入。目前可以使用“添加今日数据”“新增客户”和“更新客户进度”。");
  }

  function submit() {
    const raw = input.trim();
    if (!raw || phase === "loading" || phase === "saving" || phase === "customer-loading" || phase === "customer-saving") return;
    if (phase === "metrics" || phase === "editing") { acceptMetric(raw); return; }
    if (phase === "template") { parseNaturalEntry(raw); return; }
    if (phase === "customer-phone") { acceptCustomerPhone(raw); return; }
    if (phase === "customer-name") { acceptCustomerName(raw); return; }
    if (phase === "customer-device") { void acceptCustomerDevice(raw); return; }
    if (phase === "progress-phone") { void acceptProgressPhone(raw); return; }
    if (phase === "progress-text" || phase === "progress-amount") { acceptProgressValue(raw); return; }
    if (["legacy-source-date", "legacy-phone", "legacy-name", "legacy-device", "legacy-baseline-date", "legacy-occurred-date", "legacy-amount"].includes(phase)) { acceptLegacyText(raw); return; }
    if (phase === "idle" && /今日|当天|添加.*数据|填.*数据/.test(raw)) { setNaturalIntent("DAILY"); void parseNaturalDaily(raw); return; }
    if (phase === "idle" && /老客户|老粉/.test(raw)) { setNaturalIntent("LEGACY"); void parseNaturalLegacy(raw); return; }
    if (phase === "idle" && /新增.*客户|添加.*客户|录入.*客户/.test(raw)) { setNaturalIntent("CUSTOMER"); void parseNaturalCustomer(raw); return; }
    addMessage("user", raw);
    if (phase === "idle" && /更新.*客户|客户.*进度|跟进.*客户|客户\d+.*(?:注册|开单|首充|续充|出金|退群)/.test(raw)) { setNaturalIntent("PROGRESS"); void parseNaturalProgress(raw); return; }
    addMessage("assistant", "目前支持添加今日数据、新增客户和更新客户进度，请点击对应入口开始。" );
    setInput("");
  }

  const inputEnabled = phase === "idle" || phase === "template" || phase === "metrics" || phase === "editing" || phase === "customer-phone" || phase === "customer-name" || phase === "customer-device" || phase === "progress-phone" || phase === "progress-text" || phase === "progress-amount" || ["legacy-source-date", "legacy-phone", "legacy-name", "legacy-device", "legacy-baseline-date", "legacy-occurred-date", "legacy-amount"].includes(phase);

  return <section className={styles.assistant} data-open={open}>
    <button type="button" className={styles.trigger} onClick={() => onOpenChange(!open)} aria-label="AI 智能助手" aria-expanded={open} aria-controls="ai-assistant-drawer">
      <MagicWand size={17} weight="fill" /><span>AI 智能助手</span>
    </button>
    {open ? <aside className={styles.drawer} id="ai-assistant-drawer" aria-label="AI 智能助手">
      <header className={styles.header}>
        <span className={styles.spark}><ChatCircleDots size={19} weight="fill" /></span>
        <div><strong>AI 智能助手</strong><small>{contextLabel}</small></div>
        <div className={styles.windowActions}>
          <button type="button" aria-label="收起 AI 助手" title="收起" onClick={() => onOpenChange(false)}><Minus size={17} /></button>
          <button type="button" aria-label="关闭 AI 助手" title="关闭" onClick={() => { reset(); onOpenChange(false); }}><X size={17} /></button>
        </div>
      </header>

      <div className={styles.conversation} aria-label="AI 对话内容" ref={conversationRef}>
        {!messages.length
          ? <div className={styles.welcome}><span><MagicWand size={22} weight="fill" /></span><strong>需要处理什么？</strong><p>选择一个入口，或者直接在下方输入。</p></div>
          : <div className={styles.messages}>{messages.map((message) => <div key={message.id} className={styles.message} data-role={message.role}>{message.text}</div>)}</div>}
        {phase === "idle" ? <div className={styles.quickActions}>{quickActions.map((action) => <button key={action} type="button" data-ready={action !== "查询或纠正数据"} onClick={() => handleQuickAction(action)}>{action}{action === "查询或纠正数据" ? <small>稍后接入</small> : null}</button>)}</div> : null}

        {phase === "template" && naturalIntent ? <div className={styles.templateList} aria-label="自然语言填写模板">
          <strong>选择一个模板</strong>
          {displayedNaturalTemplates.map((template) => <button type="button" key={`${template.label}-${template.text}`} onClick={() => setInput(template.text)}><span>{template.label}</span><small>{template.text}</small></button>)}
          <p>点击模板后，在下方把号码、人员、渠道和数字改成真实内容，再发送。</p>
        </div> : null}

        {phase === "legacy-scenario" ? <div className={styles.choiceList} aria-label="选择老客户场景">
          {(Object.keys(LEGACY_SCENARIOS) as LegacyScenario[]).map((scenario) => <button type="button" key={scenario} onClick={() => chooseLegacyScenario(scenario)}><strong>{LEGACY_SCENARIOS[scenario].label}</strong><small>{LEGACY_SCENARIOS[scenario].note}</small></button>)}
        </div> : null}

        {phase === "legacy-channel" && legacyContext ? <div className={styles.choiceList} aria-label="选择老客户来源渠道">
          {legacyContext.channelOptions.map((item) => <button type="button" key={item.id} onClick={() => chooseLegacyChannel(item.id)}><strong>{item.name}</strong><small>原始来源渠道</small></button>)}
        </div> : null}

        {phase === "legacy-reception" && legacyContext ? <div className={styles.choiceList} aria-label="选择老客户接粉归属">
          {legacyContext.memberOptions.map((item) => <button type="button" key={item.id} onClick={() => chooseLegacyReception(item.id)}><strong>{item.name}</strong><small>{item.id === legacyContext.actorId ? "当前账号" : "本组成员"}</small></button>)}
        </div> : null}

        {phase === "legacy-operator" && legacyContext ? <div className={styles.choiceList} aria-label="选择老客户炒群负责人">
          {legacyContext.memberOptions.map((item) => <button type="button" key={item.id} onClick={() => chooseLegacyOperator(item.id)}><strong>{item.name}</strong><small>炒群负责人</small></button>)}
        </div> : null}

        {phase === "legacy-expert" && legacyContext ? <div className={styles.choiceList} aria-label="选择老客户专家负责人">
          {legacyContext.expertOptions.map((item) => <button type="button" key={item.id} onClick={() => chooseLegacyExpert(item.id)}><strong>{item.name}</strong><small>专家/组长</small></button>)}
        </div> : null}

        {phase === "legacy-baseline-date" && legacyDraft.sourceDate ? <div className={styles.choiceList} aria-label="老客户历史日期快捷选择">
          <button type="button" onClick={() => acceptLegacyText("同接粉日")}><strong>同接粉日</strong><small>{legacyDraft.sourceDate}</small></button>
        </div> : null}

        {phase === "legacy-occurred-date" && legacyContext ? <div className={styles.choiceList} aria-label="老客户本次日期快捷选择">
          <button type="button" onClick={() => acceptLegacyText("今天")}><strong>今天</strong><small>{legacyContext.today}</small></button>
        </div> : null}

        {phase === "legacy-method" ? <div className={styles.choiceList} aria-label="选择老客户入金方式">
          <button type="button" onClick={() => chooseLegacyMethod("CRYPTO")}><strong>加密货币</strong><small>CRYPTO</small></button>
          <button type="button" onClick={() => chooseLegacyMethod("BANK")}><strong>银行卡</strong><small>BANK</small></button>
        </div> : null}

        {phase === "customer-mode" ? <div className={styles.choiceList} aria-label="选择新增客户方式">
          <button type="button" onClick={() => chooseCustomerMode("single")}><strong>单个新增</strong><small>录入 1 个客户</small></button>
          <button type="button" onClick={() => chooseCustomerMode("batch")}><strong>批量新增</strong><small>一次最多 200 个</small></button>
        </div> : null}

        {phase === "customer-batch-input" ? <div className={styles.batchInput}>
          <label htmlFor="ai-customer-batch">批量客户号码</label>
          <textarea id="ai-customer-batch" aria-label="批量客户号码" placeholder={"每行一个号码，例如：\n+1 725 294 2480\n12545213193\n17409906565"} value={customerBatchText} onChange={(event) => setCustomerBatchText(event.target.value)} />
          <small>可以填写完整号码或后 6 位；系统保存时统一保留最后 6 位。</small>
        </div> : null}

        {phase === "channel" && context ? <div className={styles.choiceList} aria-label="选择来源渠道">
          {context.channels.map((channel) => <button type="button" key={channel.id} onClick={() => chooseChannel(channel.id)}><strong>{channel.name}</strong><small>{channel.channelType}</small></button>)}
        </div> : null}

        {phase === "customer-channel" && customerContext ? <div className={styles.choiceList} aria-label="选择客户来源渠道">
          {customerContext.channelOptions.map((channel) => <button type="button" key={channel.id} onClick={() => chooseCustomerChannel(channel.id)}><strong>{channel.name}</strong><small>来源渠道</small></button>)}
        </div> : null}

        {phase === "customer-operator" && customerContext ? <div className={styles.choiceList} aria-label="选择炒群负责人">
          {customerContext.memberOptions.map((member) => <button type="button" key={member.id} onClick={() => chooseCustomerOperator(member.id)}><strong>{member.name}</strong><small>本组在职成员</small></button>)}
        </div> : null}

        {(phase === "preview" || phase === "saving" || phase === "done" || phase === "edit-select") && context && selectedChannel ? <div className={styles.preview}>
          <header><span><CheckCircle size={18} weight="fill" /></span><div><strong>保存预览</strong><small>{context.today} · {selectedChannel.name}</small></div></header>
          {validationError ? <div className={styles.previewError}>{validationError}</div> : null}
          <div className={styles.previewGrid}>{fields.map((field) => <div key={field.key}><span>{field.label}</span><strong>{field.money ? amount(field.read(draft)) : field.read(draft)}</strong></div>)}</div>
          <div className={styles.calculated}><strong>系统自动计算</strong>{lawyer ? <><span>未回复：{Math.max(0, draft.dispatchCount - draft.replyCount)}</span><span>回复率：{summary.replyRate}</span><span>添加律师率：{summary.registrationRate}</span><span>添加专家率：{summary.orderRate}</span></> : <><span>有效数据：{summary.effective}</span><span>回复率：{summary.replyRate}</span><span>进群率：{summary.joinRate}</span><span>异常退群率：{summary.abnormalRate}</span><span>当前在群：{summary.current}</span><span>注册率：{summary.registrationRate}</span><span>开单率：{summary.orderRate}</span></>}<span>净业绩：{amount(summary.net)}</span></div>
        </div> : null}

        {phase === "edit-select" ? <div className={styles.editChoices}>{fields.map((field, index) => <button type="button" key={field.key} onClick={() => beginEdit(index)}>{field.label}</button>)}</div> : null}

        {(phase === "customer-preview" || phase === "customer-saving" || phase === "customer-done") && customerContext && selectedCustomerChannel ? <div className={styles.preview}>
          <header><span><CheckCircle size={18} weight="fill" /></span><div><strong>新增客户预览</strong><small>保存后进入组内共享客户进度表</small></div></header>
          <div className={styles.customerPreview}>
            <div><span>客户号码</span><strong>{customerDraft.phone}</strong></div>
            <div><span>客户姓名</span><strong>{customerDraft.customerName || "未填写"}</strong></div>
            <div><span>来源渠道</span><strong>{selectedCustomerChannel.name}</strong></div>
            <div><span>进群日期</span><strong>{customerDraft.joinedOn}</strong></div>
            <div><span>炒群负责人</span><strong>{selectedCustomerOperator?.name ?? "未选择"}</strong></div>
            <div><span>设备账号</span><strong>{customerDraft.deviceCode}</strong></div>
            <div><span>归属组员</span><strong>当前账号本人</strong></div>
            <div><span>初始状态</span><strong>已进群</strong></div>
          </div>
          <div className={styles.customerNotice}>完整号码只保留最后 6 位；保存后同组成员可以继续填写负责人、设备号、炒群和专家进度。</div>
        </div> : null}

        {(phase === "customer-batch-preview" || phase === "customer-batch-saving" || phase === "customer-batch-done") && customerContext && selectedCustomerChannel && customerBatchPreview ? <div className={styles.preview}>
          <header><span><CheckCircle size={18} weight="fill" /></span><div><strong>批量新增预览</strong><small>{customerDraft.joinedOn} · {selectedCustomerChannel.name}</small></div></header>
          <div className={styles.batchSummary}>
            <div data-kind="valid"><strong>{phase === "customer-batch-done" ? customerBatchCreated : customerBatchPreview.validPhones.length}</strong><span>{phase === "customer-batch-done" ? "成功新增" : "可以新增"}</span></div>
            <div data-kind="duplicate"><strong>{customerBatchPreview.duplicates.length}</strong><span>重复跳过</span></div>
            <div data-kind="invalid"><strong>{customerBatchPreview.invalid.length}</strong><span>格式错误</span></div>
          </div>
          <div className={styles.customerPreview}>
            <div><span>炒群负责人</span><strong>{selectedCustomerOperator?.name ?? "未选择"}</strong></div>
            <div><span>设备账号</span><strong>{customerDraft.deviceCode}</strong></div>
          </div>
          {customerBatchPreview.validPhones.length ? <div className={styles.phoneList}><strong>有效号码</strong><div>{customerBatchPreview.validPhones.map((phone) => <span key={phone}>{phone}</span>)}</div></div> : null}
          {customerBatchPreview.duplicates.length ? <div className={styles.batchWarning}>重复号码：{customerBatchPreview.duplicates.join("、")}</div> : null}
          {customerBatchPreview.invalid.length ? <div className={styles.batchWarning}>格式错误：{customerBatchPreview.invalid.join("、")}</div> : null}
          <div className={styles.customerNotice}>所有成功新增的客户都归属当前账号本人，初始状态统一为“已进群”。重复号码和错误号码不会写入。</div>
        </div> : null}

        {phase === "progress-action" && progressCustomer ? <div className={styles.choiceList} aria-label="选择客户进度动作">
          {(Object.keys(PROGRESS_LABELS) as ProgressAction[]).map((action) => <button type="button" key={action} onClick={() => chooseProgressAction(action)}><strong>{PROGRESS_LABELS[action]}</strong><small>{action === "recharge" && progressCustomer.order ? `第 ${progressCustomer.order.nextContinuationNumber} 笔续充` : "客户进度"}</small></button>)}
        </div> : null}

        {phase === "progress-person" && progressContext && progressDraft.action ? <div className={styles.choiceList} aria-label="选择客户负责人">
          {(progressDraft.action === "assignExpert" ? progressContext.expertOptions : progressContext.memberOptions).map((person) => <button type="button" key={person.id} onClick={() => chooseProgressPerson(person.id)}><strong>{person.name}</strong><small>{progressDraft.action === "assignExpert" ? "专家/组长" : "本组在职成员"}</small></button>)}
        </div> : null}

        {phase === "progress-method" ? <div className={styles.choiceList} aria-label="选择入金方式">
          <button type="button" onClick={() => chooseProgressMethod("CRYPTO")}><strong>加密货币</strong><small>CRYPTO</small></button>
          <button type="button" onClick={() => chooseProgressMethod("BANK")}><strong>银行卡</strong><small>BANK</small></button>
        </div> : null}

        {(phase === "progress-preview" || phase === "progress-saving" || phase === "progress-done") && progressCustomer && progressContext && progressDraft.action ? <div className={styles.preview}>
          <header><span><CheckCircle size={18} weight="fill" /></span><div><strong>客户进度更新预览</strong><small>{progressCustomer.phone} · {progressCustomer.customerName || "未填写姓名"}</small></div></header>
          <div className={styles.customerPreview}>
            <div><span>更新项目</span><strong>{PROGRESS_LABELS[progressDraft.action]}</strong></div>
            <div><span>发生日期</span><strong>{progressContext.today}</strong></div>
            {progressDraft.text ? <div><span>填写内容</span><strong>{progressDraft.text}</strong></div> : null}
            {progressDraft.userId ? <div><span>选择人员</span><strong>{[...progressContext.memberOptions, ...progressContext.expertOptions].find((item) => item.id === progressDraft.userId)?.name ?? "—"}</strong></div> : null}
            {progressDraft.amountCents ? <div><span>金额</span><strong>{amount(progressDraft.amountCents)}</strong></div> : null}
            {(progressDraft.action === "initial" || progressDraft.action === "recharge") ? <div><span>入金方式</span><strong>{progressDraft.depositMethod === "CRYPTO" ? "加密货币" : "银行卡"}</strong></div> : null}
          </div>
          <div className={styles.customerNotice}>确认前不会修改客户数据；保存后会同步刷新共享客户进度表。</div>
        </div> : null}

        {(phase === "legacy-preview" || phase === "legacy-saving" || phase === "legacy-done") && legacyContext && legacyDraft.scenario && selectedLegacyChannel ? <div className={styles.preview}>
          <header><span><CheckCircle size={18} weight="fill" /></span><div><strong>老客户导入预览</strong><small>{LEGACY_SCENARIOS[legacyDraft.scenario].label}</small></div></header>
          <div className={styles.customerPreview}>
            <div><span>客户号码</span><strong>{legacyDraft.phone}</strong></div>
            <div><span>客户姓名</span><strong>{legacyDraft.customerName || "未填写"}</strong></div>
            <div><span>接粉日期</span><strong>{legacyDraft.sourceDate}</strong></div>
            <div><span>来源渠道</span><strong>{selectedLegacyChannel.name}</strong></div>
            <div><span>接粉归属</span><strong>{selectedLegacyReception?.name ?? "—"}</strong></div>
            <div><span>设备号</span><strong>{legacyDraft.deviceCode || "未填写"}</strong></div>
            <div><span>历史状态日期</span><strong>{legacyDraft.baselineOn}</strong></div>
            <div><span>炒群负责人</span><strong>{selectedLegacyOperator?.name ?? "—"}</strong></div>
            {selectedLegacyExpert ? <div><span>专家负责人</span><strong>{selectedLegacyExpert.name}</strong></div> : null}
            <div><span>本次发生日期</span><strong>{legacyDraft.occurredOn}</strong></div>
            {legacyDraft.amountCents ? <div><span>{legacyDraft.scenario === "ORDER" ? "首充金额" : "续充金额"}</span><strong>{amount(legacyDraft.amountCents)}</strong></div> : null}
            {legacyDraft.amountCents ? <div><span>入金方式</span><strong>{legacyDraft.depositMethod === "CRYPTO" ? "加密货币" : "银行卡"}</strong></div> : null}
          </div>
          <div className={styles.customerNotice}>{LEGACY_SCENARIOS[legacyDraft.scenario].note}；接粉日期只留作历史底账。</div>
        </div> : null}
      </div>

      <div className={styles.flowActions}>
        {phase === "preview" ? <><button type="button" onClick={() => void openNaturalTemplate("DAILY", "添加今日数据")}>重新填写</button><button type="button" data-primary="true" disabled={Boolean(validationError)} onClick={() => void save()}>确认保存</button></> : null}
        {phase === "edit-select" ? <button type="button" onClick={() => setPhase("preview")}>返回预览</button> : null}
        {phase === "done" ? <><button type="button" onClick={() => void openNaturalTemplate("DAILY", "添加今日数据")}>继续填写其他渠道</button><button type="button" data-primary="true" onClick={() => { reset(); onOpenChange(false); }}>完成</button></> : null}
        {phase === "customer-preview" ? <><button type="button" onClick={() => void openNaturalTemplate("CUSTOMER", "新增客户")}>重新填写</button><button type="button" data-primary="true" onClick={() => void saveCustomer()}>确认新增</button></> : null}
        {phase === "customer-done" ? <><button type="button" onClick={() => void openNaturalTemplate("CUSTOMER", "新增客户")}>继续新增客户</button><button type="button" data-primary="true" onClick={() => { reset(); onOpenChange(false); }}>完成</button></> : null}
        {phase === "customer-batch-input" ? <button type="button" data-primary="true" disabled={!customerBatchText.trim()} onClick={acceptCustomerBatch}>下一步：选择渠道</button> : null}
        {phase === "customer-batch-preview" ? <><button type="button" onClick={() => { setPhase("customer-batch-input"); setCustomerBatchPreview(null); addMessage("assistant", "请修改批量号码后重新检查。" ); }}>修改号码</button><button type="button" data-primary="true" disabled={!customerBatchPreview?.validPhones.length} onClick={() => void saveCustomerBatch()}>确认批量新增</button></> : null}
        {phase === "customer-batch-done" ? <><button type="button" onClick={() => void openNaturalTemplate("CUSTOMER", "新增客户")}>继续新增客户</button><button type="button" data-primary="true" onClick={() => { reset(); onOpenChange(false); }}>完成</button></> : null}
        {phase === "progress-preview" ? <><button type="button" onClick={() => void openNaturalTemplate("PROGRESS", "更新客户进度")}>重新填写</button><button type="button" data-primary="true" onClick={() => void saveProgressUpdate()}>确认更新</button></> : null}
        {phase === "progress-done" ? <><button type="button" onClick={() => void openNaturalTemplate("PROGRESS", "更新客户进度")}>继续更新其他客户</button><button type="button" data-primary="true" onClick={() => { reset(); onOpenChange(false); }}>完成</button></> : null}
        {phase === "legacy-preview" ? <><button type="button" onClick={() => void openNaturalTemplate("LEGACY", "录入老客户进度")}>重新填写</button><button type="button" data-primary="true" onClick={() => void saveLegacyCustomer()}>确认导入老客户</button></> : null}
        {phase === "legacy-done" ? <><button type="button" onClick={() => void openNaturalTemplate("LEGACY", "录入老客户进度")}>继续录入老客户</button><button type="button" data-primary="true" onClick={() => { reset(); onOpenChange(false); }}>完成</button></> : null}
      </div>
      <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {phase === "template" ? <textarea aria-label="AI 对话输入框" rows={3} placeholder="点击上方模板，修改后发送；也可以直接说完整内容" value={input} onChange={(event) => setInput(event.target.value)} /> : <input aria-label="AI 对话输入框" placeholder={phase === "metrics" || phase === "editing" ? "输入数字，例如 10" : phase === "customer-phone" || phase === "progress-phone" || phase === "legacy-phone" ? "输入完整号码或后 6 位" : phase === "customer-name" || phase === "legacy-name" ? "输入姓名或回复“跳过”" : phase === "customer-device" || phase === "legacy-device" ? "输入设备账号，或回复“跳过”" : phase === "progress-text" ? "输入新的进度内容" : phase === "progress-amount" || phase === "legacy-amount" ? "输入金额，例如 1000" : ["legacy-source-date", "legacy-baseline-date", "legacy-occurred-date"].includes(phase) ? "输入日期，例如 2026-08-20" : "输入你想处理的内容…"} value={input} onChange={(event) => setInput(event.target.value)} disabled={!inputEnabled} />}
        <button type="submit" aria-label="发送" disabled={!input.trim() || !inputEnabled}><PaperPlaneTilt size={16} weight="fill" /></button>
      </form>
    </aside> : null}
  </section>;
}
