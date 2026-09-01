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
type Phase = "idle" | "loading" | "channel" | "metrics" | "preview" | "edit-select" | "editing" | "saving" | "done"
  | "customer-loading" | "customer-mode" | "customer-phone" | "customer-name" | "customer-channel" | "customer-preview" | "customer-saving" | "customer-done"
  | "customer-batch-input" | "customer-batch-preview" | "customer-batch-saving" | "customer-batch-done";
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

const quickActions = ["添加今日数据", "新增客户", "更新客户进度", "查询或纠正数据"];

type CustomerContext = {
  today: string;
  channelOptions: Array<{ id: string; name: string }>;
};

type CustomerDraft = { phone: string; customerName: string; channelId: string; joinedOn: string };
type CustomerBatchPreview = { validPhones: string[]; duplicates: string[]; invalid: string[]; totalInput: number };
const EMPTY_CUSTOMER: CustomerDraft = { phone: "", customerName: "", channelId: "", joinedOn: "" };

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
  const messageIdRef = useRef(1);
  const conversationRef = useRef<HTMLDivElement>(null);

  const lawyer = context?.groupType === "LAWYER";
  const fields = lawyer ? LAWYER_FIELDS : HACKER_FIELDS;
  const selectedChannel = context?.channels.find((channel) => channel.id === channelId) ?? null;
  const selectedCustomerChannel = customerContext?.channelOptions.find((channel) => channel.id === customerDraft.channelId) ?? null;
  const summary = useMemo(() => calculated(draft, Boolean(lawyer)), [draft, lawyer]);

  useEffect(() => {
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages, phase]);

  function addMessage(role: Message["role"], text: string) {
    const id = messageIdRef.current++;
    setMessages((current) => [...current, { id, role, text }]);
  }

  function reset() {
    setInput(""); setPhase("idle"); setMessages([]); setContext(null); setChannelId(""); setEntryId(null);
    setDraft({ ...EMPTY_VALUES }); setFieldIndex(0); setEditingIndex(null); setValidationError("");
    setCustomerContext(null); setCustomerDraft({ ...EMPTY_CUSTOMER });
    setCustomerMode(null); setCustomerBatchText(""); setCustomerBatchPreview(null); setCustomerBatchCreated(0);
    messageIdRef.current = 1;
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

  async function chooseCustomerChannel(nextChannelId: string) {
    const channel = customerContext?.channelOptions.find((item) => item.id === nextChannelId);
    if (!channel) return;
    setCustomerDraft((current) => ({ ...current, channelId: channel.id }));
    addMessage("user", channel.name);
    if (customerMode === "batch") {
      setPhase("customer-loading");
      addMessage("assistant", "正在整理号码并检查重复客户…" );
      try {
        const preview = await requestJson<CustomerBatchPreview>("/api/lead/customer-reporting", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phones: customerBatchPhones(), channelId: channel.id, joinedOn: customerDraft.joinedOn, dryRun: true }),
        });
        setCustomerBatchPreview(preview);
        addMessage("assistant", `检查完成：可新增 ${preview.validPhones.length} 个，重复 ${preview.duplicates.length} 个，格式错误 ${preview.invalid.length} 个。请核对后确认。`);
        setPhase("customer-batch-preview");
      } catch (caught) {
        addMessage("assistant", caught instanceof Error ? `检查失败：${caught.message}` : "号码检查失败，请稍后重试。" );
        setPhase("customer-channel");
      }
      return;
    }
    addMessage("assistant", "资料已经整理完成，请确认后再保存到组内共享客户进度表。" );
    setPhase("customer-preview");
  }

  async function saveCustomerBatch() {
    if (!customerContext || !selectedCustomerChannel || !customerBatchPreview?.validPhones.length) return;
    setPhase("customer-batch-saving");
    addMessage("assistant", "正在批量新增客户，请稍候…" );
    try {
      const result = await requestJson<{ created: Array<{ id: string; phone: string }>; duplicates: string[]; invalid: string[] }>("/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phones: customerBatchPhones(), channelId: selectedCustomerChannel.id, joinedOn: customerDraft.joinedOn, dryRun: false }),
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
    if (action === "添加今日数据") { void startDailyFlow(); return; }
    if (action === "新增客户") { void startCustomerFlow(); return; }
    addMessage("user", action);
    addMessage("assistant", "这个入口会在下一步接入。目前可以使用“添加今日数据”和“新增客户”。");
  }

  function submit() {
    const raw = input.trim();
    if (!raw || phase === "loading" || phase === "saving" || phase === "customer-loading" || phase === "customer-saving") return;
    if (phase === "metrics" || phase === "editing") { acceptMetric(raw); return; }
    if (phase === "customer-phone") { acceptCustomerPhone(raw); return; }
    if (phase === "customer-name") { acceptCustomerName(raw); return; }
    if (phase === "idle" && /今日|当天|添加.*数据|填.*数据/.test(raw)) { setInput(""); void startDailyFlow(); return; }
    if (phase === "idle" && /新增.*客户|添加.*客户|录入.*客户/.test(raw)) { setInput(""); void startCustomerFlow(); return; }
    addMessage("user", raw);
    addMessage("assistant", "目前支持“添加今日数据”和“新增客户”，请点击对应入口开始。" );
    setInput("");
  }

  const inputEnabled = phase === "idle" || phase === "metrics" || phase === "editing" || phase === "customer-phone" || phase === "customer-name";

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
        {phase === "idle" ? <div className={styles.quickActions}>{quickActions.map((action, index) => <button key={action} type="button" data-ready={index <= 1} onClick={() => handleQuickAction(action)}>{action}{index > 1 ? <small>稍后接入</small> : null}</button>)}</div> : null}

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
          {customerBatchPreview.validPhones.length ? <div className={styles.phoneList}><strong>有效号码</strong><div>{customerBatchPreview.validPhones.map((phone) => <span key={phone}>{phone}</span>)}</div></div> : null}
          {customerBatchPreview.duplicates.length ? <div className={styles.batchWarning}>重复号码：{customerBatchPreview.duplicates.join("、")}</div> : null}
          {customerBatchPreview.invalid.length ? <div className={styles.batchWarning}>格式错误：{customerBatchPreview.invalid.join("、")}</div> : null}
          <div className={styles.customerNotice}>所有成功新增的客户都归属当前账号本人，初始状态统一为“已进群”。重复号码和错误号码不会写入。</div>
        </div> : null}
      </div>

      <div className={styles.flowActions}>
        {phase === "preview" ? <><button type="button" onClick={() => setPhase("edit-select")}>修改数据</button><button type="button" data-primary="true" disabled={Boolean(validationError)} onClick={() => void save()}>确认保存</button></> : null}
        {phase === "edit-select" ? <button type="button" onClick={() => setPhase("preview")}>返回预览</button> : null}
        {phase === "done" ? <><button type="button" onClick={() => { setPhase("channel"); setChannelId(""); setEntryId(null); addMessage("assistant", "请选择下一个需要填写的来源渠道。" ); }}>继续填写其他渠道</button><button type="button" data-primary="true" onClick={() => { reset(); onOpenChange(false); }}>完成</button></> : null}
        {phase === "customer-preview" ? <><button type="button" onClick={() => { setPhase("customer-phone"); addMessage("assistant", "请重新输入客户完整号码或号码后 6 位。" ); }}>重新填写</button><button type="button" data-primary="true" onClick={() => void saveCustomer()}>确认新增</button></> : null}
        {phase === "customer-done" ? <><button type="button" onClick={() => void startCustomerFlow()}>继续新增客户</button><button type="button" data-primary="true" onClick={() => { reset(); onOpenChange(false); }}>完成</button></> : null}
        {phase === "customer-batch-input" ? <button type="button" data-primary="true" disabled={!customerBatchText.trim()} onClick={acceptCustomerBatch}>下一步：选择渠道</button> : null}
        {phase === "customer-batch-preview" ? <><button type="button" onClick={() => { setPhase("customer-batch-input"); setCustomerBatchPreview(null); addMessage("assistant", "请修改批量号码后重新检查。" ); }}>修改号码</button><button type="button" data-primary="true" disabled={!customerBatchPreview?.validPhones.length} onClick={() => void saveCustomerBatch()}>确认批量新增</button></> : null}
        {phase === "customer-batch-done" ? <><button type="button" onClick={() => void startCustomerFlow()}>继续新增客户</button><button type="button" data-primary="true" onClick={() => { reset(); onOpenChange(false); }}>完成</button></> : null}
      </div>
      <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <input aria-label="AI 对话输入框" placeholder={phase === "metrics" || phase === "editing" ? "输入数字，例如 10" : phase === "customer-phone" ? "输入完整号码或后 6 位" : phase === "customer-name" ? "输入姓名或回复“跳过”" : "输入你想处理的内容…"} value={input} onChange={(event) => setInput(event.target.value)} disabled={!inputEnabled} />
        <button type="submit" aria-label="发送" disabled={!input.trim() || !inputEnabled}><PaperPlaneTilt size={16} weight="fill" /></button>
      </form>
    </aside> : null}
  </section>;
}
