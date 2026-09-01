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
type Phase = "idle" | "loading" | "channel" | "metrics" | "preview" | "edit-select" | "editing" | "saving" | "done";
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
  const messageIdRef = useRef(1);
  const conversationRef = useRef<HTMLDivElement>(null);

  const lawyer = context?.groupType === "LAWYER";
  const fields = lawyer ? LAWYER_FIELDS : HACKER_FIELDS;
  const selectedChannel = context?.channels.find((channel) => channel.id === channelId) ?? null;
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
    messageIdRef.current = 1;
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
    addMessage("user", action);
    addMessage("assistant", "这个入口会在下一步接入。目前已经可以使用“添加今日数据”。");
  }

  function submit() {
    const raw = input.trim();
    if (!raw || phase === "loading" || phase === "saving") return;
    if (phase === "metrics" || phase === "editing") { acceptMetric(raw); return; }
    if (phase === "idle" && /今日|当天|添加.*数据|填.*数据/.test(raw)) { setInput(""); void startDailyFlow(); return; }
    addMessage("user", raw);
    addMessage("assistant", "当前第一版先支持“添加今日数据”，请点击对应入口开始。" );
    setInput("");
  }

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
        {phase === "idle" ? <div className={styles.quickActions}>{quickActions.map((action, index) => <button key={action} type="button" data-ready={index === 0} onClick={() => handleQuickAction(action)}>{action}{index ? <small>稍后接入</small> : null}</button>)}</div> : null}

        {phase === "channel" && context ? <div className={styles.choiceList} aria-label="选择来源渠道">
          {context.channels.map((channel) => <button type="button" key={channel.id} onClick={() => chooseChannel(channel.id)}><strong>{channel.name}</strong><small>{channel.channelType}</small></button>)}
        </div> : null}

        {(phase === "preview" || phase === "saving" || phase === "done" || phase === "edit-select") && context && selectedChannel ? <div className={styles.preview}>
          <header><span><CheckCircle size={18} weight="fill" /></span><div><strong>保存预览</strong><small>{context.today} · {selectedChannel.name}</small></div></header>
          {validationError ? <div className={styles.previewError}>{validationError}</div> : null}
          <div className={styles.previewGrid}>{fields.map((field) => <div key={field.key}><span>{field.label}</span><strong>{field.money ? amount(field.read(draft)) : field.read(draft)}</strong></div>)}</div>
          <div className={styles.calculated}><strong>系统自动计算</strong>{lawyer ? <><span>未回复：{Math.max(0, draft.dispatchCount - draft.replyCount)}</span><span>回复率：{summary.replyRate}</span><span>添加律师率：{summary.registrationRate}</span><span>添加专家率：{summary.orderRate}</span></> : <><span>有效数据：{summary.effective}</span><span>回复率：{summary.replyRate}</span><span>进群率：{summary.joinRate}</span><span>异常退群率：{summary.abnormalRate}</span><span>当前在群：{summary.current}</span><span>注册率：{summary.registrationRate}</span><span>开单率：{summary.orderRate}</span></>}<span>净业绩：{amount(summary.net)}</span></div>
        </div> : null}

        {phase === "edit-select" ? <div className={styles.editChoices}>{fields.map((field, index) => <button type="button" key={field.key} onClick={() => beginEdit(index)}>{field.label}</button>)}</div> : null}
      </div>

      <div className={styles.flowActions}>
        {phase === "preview" ? <><button type="button" onClick={() => setPhase("edit-select")}>修改数据</button><button type="button" data-primary="true" disabled={Boolean(validationError)} onClick={() => void save()}>确认保存</button></> : null}
        {phase === "edit-select" ? <button type="button" onClick={() => setPhase("preview")}>返回预览</button> : null}
        {phase === "done" ? <><button type="button" onClick={() => { setPhase("channel"); setChannelId(""); setEntryId(null); addMessage("assistant", "请选择下一个需要填写的来源渠道。" ); }}>继续填写其他渠道</button><button type="button" data-primary="true" onClick={() => { reset(); onOpenChange(false); }}>完成</button></> : null}
      </div>
      <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <input aria-label="AI 对话输入框" placeholder={phase === "metrics" || phase === "editing" ? "输入数字，例如 10" : "输入你想处理的内容…"} value={input} onChange={(event) => setInput(event.target.value)} disabled={phase === "loading" || phase === "saving" || phase === "channel" || phase === "preview" || phase === "edit-select" || phase === "done"} />
        <button type="submit" aria-label="发送" disabled={!input.trim() || phase === "loading" || phase === "saving" || phase === "channel" || phase === "preview" || phase === "edit-select" || phase === "done"}><PaperPlaneTilt size={16} weight="fill" /></button>
      </form>
    </aside> : null}
  </section>;
}
