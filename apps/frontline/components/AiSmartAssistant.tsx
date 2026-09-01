"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, MagicWand, PaperPlaneTilt, ShieldCheck, X } from "@phosphor-icons/react";
import { requestJson, type BackendUser } from "@/lib/backend";
import { localToday } from "@/lib/frontline-workbench";
import {
  EMPTY_DAILY_VALUES,
  formatAssistantValue,
  interpretAssistantMessage,
  valueToStoreForUnifiedTotal,
  withComputedValues,
  type DailyValues,
  type MetricUpdate,
} from "@/lib/ai-smart-assistant";
import styles from "./AiSmartAssistant.module.css";

type DailyContext = {
  today: string;
  channels: Array<{ id: string; name: string; channelType: string }>;
  entries: Array<{
    id: string; businessDate: string; position: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
    channel: { id: string; name: string }; sourceReception: { id: string } | null; sourceGroupOperator: { id: string } | null;
    currentRevision: DailyValues | null; approvedRevision: DailyValues | null;
  }>;
  unifiedEntries: Array<{ entryId: string | null; businessDate: string; channel: { id: string; name: string }; values: DailyValues }>;
};
type Option = { id: string; name: string };
type HistoricalContext = { today: string; channels: Option[]; members: { reception: Option[]; groupOperator: Option[]; expert: Option[] } };
type Customer = {
  id: string; phone: string; customerName: string | null; joinedOn: string | null; registeredOn: string | null;
  repliedOn?: string | null; leftOn?: string | null; groupStatus: string; expertIntroducedOn: string | null; expertNotes: string | null; nextPlan: string | null;
  owner: Option | null; attributionOwner: Option | null;
  groupOperatorOwner: Option | null; expertOwner: Option | null;
  batch: { id: string; sourceDate: string; channel: { name: string } };
  activities: Array<{ kind: string; note: string | null; occurredOn: string }>;
  order: { id: string; initialDepositCents: number; rechargeCents: number; withdrawalCents: number; nextContinuationNumber: number } | null;
};
type CustomerPayload = { customers: Customer[] };
type Change = MetricUpdate & { before: number };
type PendingAction =
  | { kind: "daily"; channelId: string; channelName: string; date: string; entryId: string | null; current: DailyValues; changes: Change[]; correction: boolean; original: string; today: string }
  | { kind: "customer_note"; customer: Customer; noteKind: "group" | "expert"; before: string; after: string; original: string }
  | { kind: "customer_event"; customer: Customer; event: "REPLIED" | "JOINED" | "LEFT_NORMAL" | "LEFT_ABNORMAL" | "INTRODUCED" | "REGISTERED" | "ORDERED" | "RECHARGE" | "WITHDRAWAL"; amountCents: number | null; today: string; original: string }
  | {
    kind: "legacy_event"; event: "JOINED" | "ORDERED" | "RECHARGE"; phoneTail: string; sourceDate: string; today: string;
    channel: Option; receptionOwner: Option; groupOperator: Option; expert: Option | null; amountCents: number | null;
    existingCustomer: Customer | null; original: string;
  };
type ChatItem = { id: number; from: "user" | "assistant"; text: string };
type ResourceGuide = { today: string; channels: Array<{ id: string; name: string }>; channelId: string; dispatchCount: number; duplicateCount: number; lowAmountCount: number; noWsCount: number; manualInvalidCount: number };
type LegacyGuide = { today: string; phone: string; sourceDate: string; event: "JOINED" | "ORDERED"; channelId: string; receptionOwnerId: string; groupOperatorId: string; expertId: string; amount: number; context: HistoricalContext };

const samples = [
  "今天 FB-M 添加20，回复8，进群3",
  "JH 回复写错了，改成8",
  "查客户 123456 的进度",
  "000004是8月20日的老粉，今天进群",
];

function dateFromMessage(message: string, today: string) {
  const iso = message.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const short = message.match(/(\d{1,2})月(\d{1,2})日?/);
  if (short) return `${today.slice(0, 4)}-${short[1].padStart(2, "0")}-${short[2].padStart(2, "0")}`;
  return today;
}

function latestNote(customer: Customer, kind: "group" | "expert") {
  if (kind === "expert") return customer.expertNotes?.trim() || customer.nextPlan?.trim() || "暂无专家记录";
  return customer.activities.find((item) => item.kind === "GROUP_PROGRESS_UPDATED")?.note?.trim() || "暂无炒群记录";
}

function namedOption(name: string | undefined, raw: string, options: Option[]) {
  if (name) {
    const exact = options.find((item) => item.name === name || item.name.includes(name) || name.includes(item.name));
    if (exact) return exact;
  }
  return [...options].sort((a, b) => b.name.length - a.name.length).find((item) => raw.includes(item.name)) ?? null;
}

function eventLabel(event: "JOINED" | "ORDERED" | "RECHARGE") {
  return event === "JOINED" ? "今天进群" : event === "ORDERED" ? "今天开单并首充" : "今天续充";
}

function customerEventLabel(event: Extract<PendingAction, { kind: "customer_event" }>["event"]) {
  const labels = { REPLIED: "回复", JOINED: "进群", LEFT_NORMAL: "正常退群", LEFT_ABNORMAL: "异常退群", INTRODUCED: "推专家", REGISTERED: "注册", ORDERED: "开单并首充", RECHARGE: "续充", WITHDRAWAL: "出金" } as const;
  return labels[event];
}

export function AiSmartAssistant({ user, onNavigate }: { user: BackendUser; onNavigate: (view: "statistics" | "customers") => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [resourceGuide, setResourceGuide] = useState<ResourceGuide | null>(null);
  const [legacyGuide, setLegacyGuide] = useState<LegacyGuide | null>(null);
  const [error, setError] = useState("");
  const [chat, setChat] = useState<ChatItem[]>([{ id: 1, from: "assistant", text: "你直接说人话就行。我会先查现有数据，再把准备修改的内容列出来，只有你确认后才保存。" }]);
  const nextId = useMemo(() => Math.max(0, ...chat.map((item) => item.id)) + 1, [chat]);

  function reply(text: string) {
    setChat((items) => [...items, { id: Date.now(), from: "assistant", text }]);
  }

  async function findCustomer(tail: string) {
    if (!user.groupId) throw new Error("当前账号没有绑定小组，不能查询客户");
    for (const stage of ["group", "reception", "expert"] as const) {
      const params = new URLSearchParams({ groupId: user.groupId, stage, page: "1", q: tail });
      const result = await requestJson<CustomerPayload>(`/api/lead/customer-reporting?${params}`);
      const customer = result.customers.find((item) => item.phone.replace(/\D/g, "").endsWith(tail)) ?? result.customers[0] ?? null;
      if (customer) return customer;
    }
    return null;
  }

  async function startResourceGuide() {
    setOpen(true); setBusy(true); setError(""); setPending(null); setLegacyGuide(null);
    try {
      const context = await requestJson<DailyContext>("/api/daily-stats");
      setResourceGuide({ today: context.today, channels: context.channels, channelId: context.channels[0]?.id ?? "", dispatchCount: 0, duplicateCount: 0, lowAmountCount: 0, noWsCount: 0, manualInvalidCount: 0 });
      reply("先选择渠道，再填写今天收到的资源总数和无效分类。有效数据会由系统自动计算。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "读取渠道失败"); }
    finally { setBusy(false); }
  }

  async function startLegacyGuide() {
    setOpen(true); setBusy(true); setError(""); setPending(null); setResourceGuide(null);
    try {
      const daily = await requestJson<DailyContext>("/api/daily-stats");
      const context = await requestJson<HistoricalContext>(`/api/historical-claims?baselineOn=${encodeURIComponent(daily.today)}`);
      setLegacyGuide({ today: context.today, phone: "", sourceDate: context.today, event: "JOINED", channelId: context.channels[0]?.id ?? "", receptionOwnerId: context.members.reception.find((item) => item.id === user.id)?.id ?? context.members.reception[0]?.id ?? "", groupOperatorId: context.members.groupOperator.find((item) => item.id === user.id)?.id ?? context.members.groupOperator[0]?.id ?? "", expertId: context.members.expert.find((item) => item.id === user.id)?.id ?? context.members.expert[0]?.id ?? "", amount: 0, context });
      reply("老客户先填原始来源日期，再选择今天新发生的进度。以前已经发生的步骤只作为底账，不会倒灌到今天统计。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "读取老客户选项失败"); }
    finally { setBusy(false); }
  }

  async function prepareLegacyGuide() {
    if (!legacyGuide || busy) return;
    setError("");
    const digits = legacyGuide.phone.replace(/\D/g, "");
    if (digits.length < 4) { setError("请输入至少 4 位客户号码"); return; }
    const channel = legacyGuide.context.channels.find((item) => item.id === legacyGuide.channelId);
    const receptionOwner = legacyGuide.context.members.reception.find((item) => item.id === legacyGuide.receptionOwnerId);
    const groupOperator = legacyGuide.context.members.groupOperator.find((item) => item.id === legacyGuide.groupOperatorId);
    const expert = legacyGuide.context.members.expert.find((item) => item.id === legacyGuide.expertId) ?? null;
    if (!channel || !receptionOwner || !groupOperator) { setError("请完整选择渠道、接粉归属和炒群负责人"); return; }
    if (legacyGuide.event === "ORDERED" && (!expert || legacyGuide.amount <= 0)) { setError("今天开单必须选择专家并填写首充金额"); return; }
    const existing = await findCustomer(digits.slice(-6));
    if (existing) {
      setPending({ kind: "customer_event", customer: existing, event: legacyGuide.event, amountCents: legacyGuide.event === "ORDERED" ? Math.round(legacyGuide.amount * 100) : null, today: legacyGuide.today, original: "AI引导老客户新进度" });
      reply("该号码已经存在，不重复导入，只新增今天发生的进度。");
    } else {
      setPending({ kind: "legacy_event", event: legacyGuide.event, phoneTail: digits, sourceDate: legacyGuide.sourceDate, today: legacyGuide.today, channel, receptionOwner, groupOperator, expert: legacyGuide.event === "ORDERED" ? expert : null, amountCents: legacyGuide.event === "ORDERED" ? Math.round(legacyGuide.amount * 100) : null, existingCustomer: null, original: "AI引导老客户新进度" });
      reply("已生成老客户保存预览：原始日期只建历史底账，今天事件才进入今天报表。");
    }
    setLegacyGuide(null);
  }

  async function prepareResourceGuide() {
    if (!resourceGuide?.channelId || busy) return;
    setBusy(true); setError("");
    try {
      const context = await requestJson<DailyContext>("/api/daily-stats");
      const channel = context.channels.find((item) => item.id === resourceGuide.channelId);
      if (!channel) throw new Error("请选择一个有效渠道");
      const existing = context.unifiedEntries.find((item) => item.businessDate === context.today && item.channel.id === channel.id);
      const displayed = { ...EMPTY_DAILY_VALUES, ...(existing?.values ?? {}) };
      const primaryEntry = existing?.entryId ? context.entries.find((entry) => entry.id === existing.entryId) : null;
      const current = { ...EMPTY_DAILY_VALUES, ...(primaryEntry?.currentRevision ?? primaryEntry?.approvedRevision ?? {}) };
      const keys = ["dispatchCount", "duplicateCount", "lowAmountCount", "noWsCount", "manualInvalidCount"] as const;
      const labels = { dispatchCount: "添加数据", duplicateCount: "撞粉", lowAmountCount: "低金额", noWsCount: "无 WS 号码", manualInvalidCount: "人工无效" } as const;
      const changes = keys.map((key) => ({ key, label: labels[key], value: resourceGuide[key], before: displayed[key] }));
      setPending({ kind: "daily", channelId: channel.id, channelName: channel.name, date: context.today, entryId: existing?.entryId ?? null, current, changes, correction: Boolean(existing), original: "AI引导填写资源数据", today: context.today });
      setResourceGuide(null); reply("资源数据已整理成保存预览。请确认渠道和数量，确认后才会写入。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "生成预览失败"); }
    finally { setBusy(false); }
  }

  async function checkTodayMissing() {
    setOpen(true); setBusy(true); setError(""); setPending(null); setResourceGuide(null); setLegacyGuide(null);
    try {
      const context = await requestJson<DailyContext>("/api/daily-stats");
      const filled = new Set(context.unifiedEntries.filter((item) => item.businessDate === context.today && item.entryId).map((item) => item.channel.id));
      const missing = context.channels.filter((item) => !filled.has(item.id));
      reply(missing.length ? `今天还有 ${missing.length} 个渠道没有填写：${missing.map((item) => item.name).join("、")}。` : "今天所有已启用渠道都已经填写过资源数据。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "检查失败"); }
    finally { setBusy(false); }
  }

  async function understand(raw: string) {
    const message = raw.trim();
    if (!message || busy) return;
    setOpen(true); setBusy(true); setError(""); setPending(null); setInput("");
    setChat((items) => [...items, { id: nextId, from: "user", text: message }]);
    try {
      let intent = interpretAssistantMessage(message);
      try {
        const modelResult = await requestJson<{ configured: boolean; intent: ReturnType<typeof interpretAssistantMessage> | null }>("/api/ai-assistant/interpret", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }),
        });
        intent = modelResult.intent ?? intent;
      } catch {
        // 服务器模型短暂不可用时继续使用本地受控解析，不能让员工正在填写的数据丢失。
      }
      if (intent.kind === "daily") {
        const context = await requestJson<DailyContext>("/api/daily-stats");
        const channel = [...context.channels].sort((a, b) => b.name.length - a.name.length).find((item) => message.toLowerCase().includes(item.name.toLowerCase()));
        if (!channel) {
          reply(`我识别到了数据，但还不知道归哪个渠道。请补上渠道名称，例如：${context.channels[0]?.name ?? "FB-M"} 添加20，回复8。`);
          return;
        }
        const date = dateFromMessage(message, context.today);
        const existing = context.unifiedEntries.find((item) => item.businessDate === date && item.channel.id === channel.id);
        const displayed = { ...EMPTY_DAILY_VALUES, ...(existing?.values ?? {}) };
        const primaryEntry = existing?.entryId ? context.entries.find((entry) => entry.id === existing.entryId) : null;
        const current = { ...EMPTY_DAILY_VALUES, ...(primaryEntry?.currentRevision ?? primaryEntry?.approvedRevision ?? (existing ? {} : displayed)) };
        const changes = intent.updates.map((update) => ({ ...update, before: displayed[update.key] }));
        setPending({ kind: "daily", channelId: channel.id, channelName: channel.name, date, entryId: existing?.entryId ?? null, current, changes, correction: intent.correction || Boolean(existing) || date < context.today, original: message, today: context.today });
        reply(`已读取 ${date} 的 ${channel.name} 数据。下面是保存前预览，请核对后再确认。`);
        return;
      }
      if (intent.kind === "customer_query" || intent.kind === "customer_note") {
        const customer = await findCustomer(intent.phoneTail);
        if (!customer) { reply(`没有找到号码后 ${intent.phoneTail.length} 位为 ${intent.phoneTail} 的客户。`); return; }
        if (intent.kind === "customer_query") {
          const net = (customer.order?.initialDepositCents ?? 0) + (customer.order?.rechargeCents ?? 0) - (customer.order?.withdrawalCents ?? 0);
          reply(`客户 ${customer.phone}：渠道 ${customer.batch.channel.name}，归属 ${customer.attributionOwner?.name ?? customer.owner?.name ?? "未分配"}，${customer.joinedOn ? `${customer.joinedOn} 进群` : "未进群"}，${customer.registeredOn ? `${customer.registeredOn} 注册` : "未注册"}，当前净业绩 ${formatAssistantValue(net, true)}。`);
          return;
        }
        const before = latestNote(customer, intent.noteKind);
        setPending({ kind: "customer_note", customer, noteKind: intent.noteKind, before, after: intent.note, original: message });
        reply(`已找到客户 ${customer.phone}。我只会修改${intent.noteKind === "group" ? "炒群情况" : "专家情况"}，请先核对前后差异。`);
        return;
      }
      if (intent.kind === "customer_event") {
        const customer = await findCustomer(intent.phoneTail);
        if (!customer) { reply(`没有找到号码后 ${intent.phoneTail.length} 位为 ${intent.phoneTail} 的客户。若这是老客户，请使用“老客户今天有新进度”并补充原始日期和渠道。`); return; }
        if (["ORDERED", "RECHARGE", "WITHDRAWAL"].includes(intent.event) && !intent.amountCents) {
          reply(`我知道客户要${customerEventLabel(intent.event)}，但还缺金额。请补充金额后再发送。`); return;
        }
        if (["RECHARGE", "WITHDRAWAL"].includes(intent.event) && !customer.order) {
          reply(`客户 ${customer.phone} 还没有有效开单，不能登记${customerEventLabel(intent.event)}。`); return;
        }
        const daily = await requestJson<DailyContext>("/api/daily-stats");
        setPending({ kind: "customer_event", customer, event: intent.event, amountCents: intent.amountCents ?? null, today: daily.today, original: message });
        reply(`已找到客户 ${customer.phone}。这次只新增“${customerEventLabel(intent.event)}”事件，原始接粉归属不会改变。`);
        return;
      }
      if (intent.kind === "legacy_event") {
        const daily = await requestJson<DailyContext>("/api/daily-stats");
        const existingCustomer = await findCustomer(intent.phoneTail);
        if (existingCustomer) {
          const mappedEvent = intent.event;
          if (mappedEvent === "RECHARGE" && !existingCustomer.order) { reply(`客户 ${intent.phoneTail} 没有有效开单记录，不能直接续充。请先核对号码或先登记开单。`); return; }
          if ((mappedEvent === "ORDERED" || mappedEvent === "RECHARGE") && !intent.amountCents) { reply(`我知道这是今天${mappedEvent === "ORDERED" ? "开单" : "续充"}，但还缺金额。`); return; }
          setPending({ kind: "customer_event", customer: existingCustomer, event: mappedEvent, amountCents: intent.amountCents ?? null, today: daily.today, original: message });
          reply(`这个号码已经在客户库中，不会重复导入。今天只新增“${customerEventLabel(mappedEvent)}”事件。`);
          return;
        }
        if (intent.event === "RECHARGE") {
          reply(`号码 ${intent.phoneTail} 还不在客户库中，不能直接从“续充”开始。请先用老客户入口建立历史开单底账。`);
          return;
        }
        const historical = await requestJson<HistoricalContext>(`/api/historical-claims?baselineOn=${encodeURIComponent(intent.sourceDate)}`);
        const channel = namedOption(intent.channelName, message, historical.channels) ?? (historical.channels.length === 1 ? historical.channels[0] : null);
        const receptionOwner = namedOption(intent.receptionOwnerName, message, historical.members.reception)
          ?? historical.members.reception.find((item) => item.id === user.id)
          ?? (historical.members.reception.length === 1 ? historical.members.reception[0] : null);
        const groupOperator = namedOption(intent.groupOperatorName, message, historical.members.groupOperator)
          ?? historical.members.groupOperator.find((item) => item.id === user.id)
          ?? (historical.members.groupOperator.length === 1 ? historical.members.groupOperator[0] : null);
        const expert = intent.event === "ORDERED"
          ? namedOption(intent.expertName, message, historical.members.expert)
            ?? historical.members.expert.find((item) => item.id === user.id)
            ?? (historical.members.expert.length === 1 ? historical.members.expert[0] : null)
          : null;
        const missing = [!channel ? "来源渠道" : "", !receptionOwner ? "接粉归属" : "", !groupOperator ? "炒群负责人" : "", intent.event === "ORDERED" && !expert ? "专家负责人" : "", intent.event === "ORDERED" && !intent.amountCents ? "首充金额" : ""].filter(Boolean);
        if (missing.length) { reply(`我已经理解客户要${eventLabel(intent.event)}，但还缺：${missing.join("、")}。请把这些信息补在同一句里。`); return; }
        setPending({ kind: "legacy_event", event: intent.event, phoneTail: intent.phoneTail, sourceDate: intent.sourceDate, today: historical.today, channel: channel!, receptionOwner: receptionOwner!, groupOperator: groupOperator!, expert, amountCents: intent.amountCents ?? null, existingCustomer: null, original: message });
        reply(`已按“历史资料不倒灌、今天事件计入今天”生成预览。客户来源仍保留在 ${intent.sourceDate}。`);
        return;
      }
      reply("这句话我还没听明白。你可以说：‘今天 FB-M 添加20，回复8’、‘JH 回复写错了，改成8’，或‘查客户 123456 的进度’。");
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "读取失败，请稍后再试";
      setError(messageText); reply(messageText);
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (!pending || busy) return;
    setBusy(true); setError("");
    try {
      if (pending.kind === "daily") {
        const values = { ...pending.current };
        for (const change of pending.changes) {
          values[change.key] = valueToStoreForUnifiedTotal(change.value, change.before, pending.current[change.key]);
        }
        await requestJson("/api/daily-stats", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...(pending.entryId ? { entryId: pending.entryId } : {}), businessDate: pending.date,
            expectedStatisticsDate: pending.today, position: "RECEPTION", channelId: pending.channelId,
            sourceReceptionId: null, sourceGroupOperatorId: null,
            changeReason: pending.correction ? `AI智能纠错：${pending.original.slice(0, 180)}` : null,
            values: withComputedValues(values),
          }),
        });
        reply(`已保存 ${pending.date} · ${pending.channelName}。${pending.correction ? "旧版本已保留，可供后台追查。" : "数据表已同步更新。"}`);
        onNavigate("statistics");
      } else if (pending.kind === "customer_note") {
        await requestJson(`/api/leads/${pending.customer.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify(pending.noteKind === "group"
            ? { action: "updateGroupProgress", progressNote: pending.after, occurredOn: localToday() }
            : { action: "updateExpertDetails", expertNotes: pending.after, occurredOn: localToday() }),
        });
        reply(`客户 ${pending.customer.phone} 的${pending.noteKind === "group" ? "炒群情况" : "专家情况"}已更新，并记录了操作账号和时间。`);
        onNavigate("customers");
      } else if (pending.kind === "customer_event") {
        const { customer, event, amountCents, today } = pending;
        if (event === "ORDERED") {
          if (!amountCents) throw new Error("缺少首充金额");
          await requestJson("/api/customer-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: customer.batch.id, leadId: customer.id, openedOn: today, phone: customer.phone, initialDepositCents: amountCents, initialDepositMethod: "CRYPTO" }) });
        } else if (event === "RECHARGE" || event === "WITHDRAWAL") {
          if (!customer.order || !amountCents) throw new Error("缺少开单或金额信息");
          await requestJson("/api/customer-finance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerOrderId: customer.order.id, occurredOn: today, kind: event, amountCents, ...(event === "RECHARGE" ? { depositMethod: "CRYPTO", continuationNumber: customer.order.nextContinuationNumber } : {}) }) });
        } else {
          const action = { REPLIED: "reply", JOINED: "joinGroup", LEFT_NORMAL: "leaveGroup", LEFT_ABNORMAL: "leaveGroup", INTRODUCED: "introduceExpert", REGISTERED: "register" }[event];
          await requestJson(`/api/leads/${customer.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, occurredOn: today, ...(event === "LEFT_NORMAL" ? { leaveNote: "正常退群（AI录入）" } : event === "LEFT_ABNORMAL" ? { leaveNote: "异常退群（AI录入）" } : {}) }) });
        }
        await syncCustomerEventDailyImpact(pending);
        reply(`客户 ${customer.phone} 已记录${customerEventLabel(event)}；客户表和今天报表已同步，接粉归属仍是 ${customer.attributionOwner?.name ?? customer.owner?.name ?? "原归属人"}。`);
        onNavigate("customers");
      } else {
        if (pending.event === "RECHARGE") {
          const order = pending.existingCustomer?.order;
          if (!order || !pending.amountCents) throw new Error("缺少开单或续充信息");
          await requestJson("/api/customer-finance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
            customerOrderId: order.id, occurredOn: pending.today, kind: "RECHARGE", amountCents: pending.amountCents,
            depositMethod: "CRYPTO", continuationNumber: order.nextContinuationNumber,
          }) });
        } else {
          await requestJson("/api/legacy-customers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
            phone: pending.phoneTail, channelId: pending.channel.id, receptionOwnerId: pending.receptionOwner.id,
            groupOperatorOwnerId: pending.groupOperator.id, ...(pending.expert ? { expertOwnerId: pending.expert.id } : {}),
            baselineStage: pending.event === "JOINED" ? "REPLIED" : "REGISTERED", baselineOn: pending.sourceDate,
            currentEvent: pending.event, occurredOn: pending.today,
            ...(pending.event === "ORDERED" && pending.amountCents ? { initialDepositCents: pending.amountCents, initialDepositMethod: "CRYPTO" } : {}),
            notes: `AI录入：${pending.original.slice(0, 500)}`,
          }) });
        }
        await syncLegacyDailyImpact(pending);
        reply(`客户 ${pending.phoneTail} 已完成${eventLabel(pending.event)}。历史来源日期保持 ${pending.sourceDate}，今天报表只增加本次事件。`);
        onNavigate("customers");
      }
      window.dispatchEvent(new CustomEvent("ai-data-updated"));
      setPending(null);
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "保存失败，请稍后再试";
      setError(messageText); reply(messageText);
    } finally { setBusy(false); }
  }

  async function syncCustomerEventDailyImpact(action: Extract<PendingAction, { kind: "customer_event" }>) {
    const context = await requestJson<DailyContext>("/api/daily-stats");
    const channel = context.channels.find((item) => item.name === action.customer.batch.channel.name);
    const reception = action.customer.attributionOwner ?? action.customer.owner;
    if (!channel || !reception) return;
    const position = action.event === "REPLIED" ? "RECEPTION" as const
      : ["JOINED", "LEFT_NORMAL", "LEFT_ABNORMAL", "INTRODUCED"].includes(action.event) ? "GROUP_OPERATOR" as const
      : "EXPERT" as const;
    // 回复只能写进本人接粉主行；其他岗位事件使用来源归属行，确保代填也不改变粉的归属。
    if (position === "RECEPTION" && reception.id !== user.id) return;
    const existing = context.entries.find((entry) => entry.businessDate === action.today && entry.position === position
      && entry.channel.id === channel.id
      && (position === "RECEPTION" || entry.sourceReception?.id === reception.id)
      && (position !== "EXPERT" || entry.sourceGroupOperator?.id === action.customer.groupOperatorOwner?.id));
    const values = { ...EMPTY_DAILY_VALUES, ...(existing?.currentRevision ?? existing?.approvedRevision ?? {}) };
    if (action.event === "REPLIED") values.replyCount += 1;
    if (action.event === "JOINED") { values.operatorReceivedCount += 1; values.currentInGroupCount += 1; }
    if (action.event === "LEFT_NORMAL") { values.normalLeaveCount += 1; values.currentInGroupCount = Math.max(0, values.currentInGroupCount - 1); }
    if (action.event === "LEFT_ABNORMAL") { values.abnormalLeaveCount += 1; values.currentInGroupCount = Math.max(0, values.currentInGroupCount - 1); }
    if (action.event === "INTRODUCED") values.expertIntroCount += 1;
    if (action.event === "REGISTERED") values.registrationCount += 1;
    if (action.event === "ORDERED") { values.orderCount += 1; values.cryptoInitialDepositCents += action.amountCents ?? 0; }
    if (action.event === "RECHARGE") values.cryptoRechargeCents += action.amountCents ?? 0;
    if (action.event === "WITHDRAWAL") values.withdrawalCents += action.amountCents ?? 0;
    await requestJson("/api/daily-stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      ...(existing ? { entryId: existing.id } : {}), businessDate: action.today, expectedStatisticsDate: context.today, position,
      channelId: channel.id, sourceReceptionId: position === "RECEPTION" ? null : reception.id,
      sourceGroupOperatorId: position === "EXPERT" ? action.customer.groupOperatorOwner?.id ?? null : null,
      changeReason: `AI客户事件同步：${action.original.slice(0, 180)}`, values,
    }) });
  }

  async function syncLegacyDailyImpact(action: Extract<PendingAction, { kind: "legacy_event" }>) {
    const context = await requestJson<DailyContext>("/api/daily-stats");
    const position = action.event === "JOINED" ? "GROUP_OPERATOR" as const : "EXPERT" as const;
    const existing = context.entries.find((entry) => entry.businessDate === action.today && entry.position === position
      && entry.channel.id === action.channel.id && entry.sourceReception?.id === action.receptionOwner.id
      && (position !== "EXPERT" || entry.sourceGroupOperator?.id === action.groupOperator.id));
    const values = { ...EMPTY_DAILY_VALUES, ...(existing?.currentRevision ?? existing?.approvedRevision ?? {}) };
    if (action.event === "JOINED") {
      values.operatorReceivedCount += 1;
      values.currentInGroupCount += 1;
    } else if (action.event === "ORDERED") {
      values.orderCount += 1;
      values.cryptoInitialDepositCents += action.amountCents ?? 0;
    } else {
      values.cryptoRechargeCents += action.amountCents ?? 0;
    }
    await requestJson("/api/daily-stats", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      ...(existing ? { entryId: existing.id } : {}), businessDate: action.today, expectedStatisticsDate: context.today,
      position, channelId: action.channel.id, sourceReceptionId: action.receptionOwner.id,
      sourceGroupOperatorId: position === "EXPERT" ? action.groupOperator.id : null,
      changeReason: `AI客户事件同步：${action.original.slice(0, 180)}`, values,
    }) });
  }

  return <section className={styles.assistant} data-open={open}>
    <button type="button" className={styles.bar} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className={styles.spark}><MagicWand size={18} weight="fill" /></span>
      <span><strong>AI 智能对话</strong><small>说一句话，填写数据、纠正错误、查询客户进度</small></span>
      <i>{open ? "收起" : "开始使用"}<ArrowRight size={15} /></i>
    </button>
    {open ? <div className={styles.panel}>
      <header><div><MagicWand size={18} weight="fill" /><strong>数据助手</strong><span>测试版</span></div><button type="button" onClick={() => setOpen(false)}><X size={16} /></button></header>
      <div className={styles.tasks}>
        <button type="button" onClick={() => void startResourceGuide()}><b>填写资源数据</b><small>渠道＋添加/无效分类</small></button>
        <button type="button" onClick={() => { setResourceGuide(null); setInput("客户123456今天进群"); }}><b>更新客户进度</b><small>按号码记录今天事件</small></button>
        <button type="button" onClick={() => { setResourceGuide(null); setInput("查客户123456的进度"); }}><b>查询客户</b><small>看归属、阶段和业绩</small></button>
        <button type="button" onClick={() => { setResourceGuide(null); setInput("JH 回复写错了，改成8"); }}><b>纠正错误</b><small>先看差异再保存</small></button>
        <button type="button" onClick={() => void startLegacyGuide()}><b>老客户新进度</b><small>历史底账＋今天事件</small></button>
        <button type="button" onClick={() => void checkTodayMissing()}><b>检查今日遗漏</b><small>找出未填渠道</small></button>
      </div>
      <div className={styles.messages}>{chat.slice(-5).map((item) => <div key={item.id} className={styles.message} data-from={item.from}>{item.text}</div>)}</div>
      {resourceGuide ? <form className={styles.guide} onSubmit={(event) => { event.preventDefault(); void prepareResourceGuide(); }}>
        <div className={styles.guideTitle}><strong>引导填写资源数据</strong><small>{resourceGuide.today} · 有效数据自动计算</small></div>
        <label className={styles.channelField}><span>来源渠道</span><select value={resourceGuide.channelId} onChange={(event) => setResourceGuide((value) => value ? { ...value, channelId: event.target.value } : value)}>{resourceGuide.channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
        <div className={styles.guideMetrics}>{([
          ["dispatchCount", "添加数据"], ["duplicateCount", "撞粉"], ["lowAmountCount", "低金额"], ["noWsCount", "无 WS"], ["manualInvalidCount", "人工无效"],
        ] as const).map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min="0" step="1" value={resourceGuide[key]} onChange={(event) => setResourceGuide((value) => value ? { ...value, [key]: Math.max(0, Math.round(Number(event.target.value) || 0)) } : value)} /></label>)}</div>
        <footer><button type="button" onClick={() => setResourceGuide(null)}>取消</button><button type="submit" className={styles.confirm} disabled={busy || !resourceGuide.channelId}>生成保存预览</button></footer>
      </form> : null}
      {legacyGuide ? <form className={styles.guide} onSubmit={(event) => { event.preventDefault(); void prepareLegacyGuide(); }}>
        <div className={styles.guideTitle}><strong>老客户今天有新进度</strong><small>历史不倒灌 · 今天才统计</small></div>
        <div className={styles.legacyFields}>
          <label><span>客户号码</span><input value={legacyGuide.phone} onChange={(event) => setLegacyGuide((value) => value ? { ...value, phone: event.target.value } : value)} placeholder="输入号码或后 6 位" /></label>
          <label><span>原始来源日期</span><input type="date" max={legacyGuide.today} value={legacyGuide.sourceDate} onChange={(event) => setLegacyGuide((value) => value ? { ...value, sourceDate: event.target.value } : value)} /></label>
          <label><span>今天新进度</span><select value={legacyGuide.event} onChange={(event) => setLegacyGuide((value) => value ? { ...value, event: event.target.value as "JOINED" | "ORDERED" } : value)}><option value="JOINED">今天进群</option><option value="ORDERED">今天开单并首充</option></select></label>
          <label><span>来源渠道</span><select value={legacyGuide.channelId} onChange={(event) => setLegacyGuide((value) => value ? { ...value, channelId: event.target.value } : value)}>{legacyGuide.context.channels.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>接粉归属</span><select value={legacyGuide.receptionOwnerId} onChange={(event) => setLegacyGuide((value) => value ? { ...value, receptionOwnerId: event.target.value } : value)}>{legacyGuide.context.members.reception.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>炒群负责人</span><select value={legacyGuide.groupOperatorId} onChange={(event) => setLegacyGuide((value) => value ? { ...value, groupOperatorId: event.target.value } : value)}>{legacyGuide.context.members.groupOperator.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {legacyGuide.event === "ORDERED" ? <><label><span>专家负责人</span><select value={legacyGuide.expertId} onChange={(event) => setLegacyGuide((value) => value ? { ...value, expertId: event.target.value } : value)}>{legacyGuide.context.members.expert.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>首充金额（美元）</span><input type="number" min="0" step="0.01" value={legacyGuide.amount} onChange={(event) => setLegacyGuide((value) => value ? { ...value, amount: Math.max(0, Number(event.target.value) || 0) } : value)} /></label></> : null}
        </div>
        <footer><button type="button" onClick={() => setLegacyGuide(null)}>取消</button><button type="submit" className={styles.confirm}>生成保存预览</button></footer>
      </form> : null}
      {pending ? <div className={styles.preview}>
        <div className={styles.previewTitle}><ShieldCheck size={18} /><div><strong>保存前确认</strong><small>AI 不会直接改数据，确认后才写入</small></div></div>
        {pending.kind === "daily" ? <>
          <p>{pending.date} · {pending.channelName}</p>
          <div className={styles.changes}>{pending.changes.map((change) => <div key={change.key}><span>{change.label}</span><del>{formatAssistantValue(change.before, change.money)}</del><ArrowRight size={13} /><b>{formatAssistantValue(change.value, change.money)}</b></div>)}</div>
        </> : pending.kind === "customer_note" ? <>
          <p>客户 {pending.customer.phone} · {pending.noteKind === "group" ? "炒群情况" : "专家情况"}</p>
          <div className={styles.noteChange}><del>{pending.before}</del><ArrowRight size={14} /><b>{pending.after}</b></div>
        </> : pending.kind === "customer_event" ? <>
          <p>客户 {pending.customer.phone} · {customerEventLabel(pending.event)}</p>
          <div className={styles.legacyPreview}>
            <span>客户归属<b>{pending.customer.attributionOwner?.name ?? pending.customer.owner?.name ?? "未分配"}</b><small>保存后不会改变</small></span>
            <span>发生日期<b>{pending.today}</b><small>计入今天报表</small></span>
            <span>来源渠道<b>{pending.customer.batch.channel.name}</b><small>按原客户线路统计</small></span>
            {pending.amountCents ? <span>本次金额<b>{formatAssistantValue(pending.amountCents, true)}</b><small>{pending.event === "WITHDRAWAL" ? "计入出金并扣减净业绩" : "计入对应入金与净业绩"}</small></span> : null}
          </div>
        </> : <>
          <p>客户 {pending.phoneTail} · {eventLabel(pending.event)}</p>
          <div className={styles.legacyPreview}>
            <span>历史来源日期<b>{pending.sourceDate}</b><small>只展示，不重复统计添加</small></span>
            <span>本次发生日期<b>{pending.today}</b><small>计入今天报表</small></span>
            <span>来源与归属<b>{pending.channel.name} · {pending.receptionOwner.name}</b><small>炒群：{pending.groupOperator.name}{pending.expert ? ` · 专家：${pending.expert.name}` : ""}</small></span>
            {pending.amountCents ? <span>本次金额<b>{formatAssistantValue(pending.amountCents, true)}</b><small>{pending.event === "RECHARGE" ? "只增加续充与净业绩" : "增加开单、首充与净业绩"}</small></span> : null}
          </div>
        </>}
        <footer><button type="button" onClick={() => setPending(null)}>取消</button><button type="button" className={styles.confirm} disabled={busy} onClick={() => void confirm()}><Check size={15} weight="bold" />{busy ? "保存中…" : "确认保存"}</button></footer>
      </div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}
      <div className={styles.samples}>{samples.map((sample) => <button type="button" key={sample} onClick={() => { setResourceGuide(null); setInput(sample); void understand(sample); }}>{sample}</button>)}</div>
      <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void understand(input); }}>
        <input aria-label="告诉 AI 要填写或修改什么" value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：今天 FB-M 添加20，回复8，进群3" />
        <button type="submit" disabled={busy || !input.trim()}>{busy ? "理解中…" : <><PaperPlaneTilt size={16} weight="fill" />发送</>}</button>
      </form>
      <p className={styles.safety}>所有修改先预览再确认；纠错保留旧版本和操作记录。</p>
    </div> : null}
  </section>;
}
