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
  groupStatus: string; expertIntroducedOn: string | null; expertNotes: string | null; nextPlan: string | null;
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
  | {
    kind: "legacy_event"; event: "JOINED" | "ORDERED" | "RECHARGE"; phoneTail: string; sourceDate: string; today: string;
    channel: Option; receptionOwner: Option; groupOperator: Option; expert: Option | null; amountCents: number | null;
    existingCustomer: Customer | null; original: string;
  };
type ChatItem = { id: number; from: "user" | "assistant"; text: string };

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

export function AiSmartAssistant({ user, onNavigate }: { user: BackendUser; onNavigate: (view: "statistics" | "customers") => void }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState("");
  const [chat, setChat] = useState<ChatItem[]>([{ id: 1, from: "assistant", text: "你直接说人话就行。我会先查现有数据，再把准备修改的内容列出来，只有你确认后才保存。" }]);
  const nextId = useMemo(() => Math.max(0, ...chat.map((item) => item.id)) + 1, [chat]);

  function reply(text: string) {
    setChat((items) => [...items, { id: Date.now(), from: "assistant", text }]);
  }

  async function findCustomer(tail: string) {
    if (!user.groupId) throw new Error("当前账号没有绑定小组，不能查询客户");
    const params = new URLSearchParams({ groupId: user.groupId, stage: "group", page: "1", q: tail });
    const result = await requestJson<CustomerPayload>(`/api/lead/customer-reporting?${params}`);
    return result.customers.find((item) => item.phone.replace(/\D/g, "").endsWith(tail)) ?? result.customers[0] ?? null;
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
      if (intent.kind === "legacy_event") {
        const daily = await requestJson<DailyContext>("/api/daily-stats");
        const existingCustomer = intent.event === "RECHARGE" ? await findCustomer(intent.phoneTail) : null;
        if (intent.event === "RECHARGE") {
          if (!existingCustomer?.order) { reply(`客户 ${intent.phoneTail} 没有有效开单记录，不能直接续充。请先核对号码或先登记开单。`); return; }
          if (!intent.amountCents) { reply("我知道这是今天续充，但还缺续充金额。请补充，例如：续充500美元。"); return; }
          const channel = daily.channels.find((item) => item.name === existingCustomer.batch.channel.name);
          const receptionOwner = existingCustomer.attributionOwner ?? existingCustomer.owner;
          const groupOperator = existingCustomer.groupOperatorOwner;
          if (!channel || !receptionOwner || !groupOperator) { reply("这位客户的渠道或负责人资料不完整，请先在客户共享表补全。 "); return; }
          setPending({ kind: "legacy_event", event: intent.event, phoneTail: intent.phoneTail, sourceDate: existingCustomer.batch.sourceDate, today: daily.today, channel, receptionOwner, groupOperator, expert: existingCustomer.expertOwner, amountCents: intent.amountCents, existingCustomer, original: message });
          reply(`已读取客户 ${existingCustomer.phone} 的历史开单和资金记录。今天只新增一笔续充，不会重复增加开单。`);
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
      <div className={styles.messages}>{chat.slice(-5).map((item) => <div key={item.id} className={styles.message} data-from={item.from}>{item.text}</div>)}</div>
      {pending ? <div className={styles.preview}>
        <div className={styles.previewTitle}><ShieldCheck size={18} /><div><strong>保存前确认</strong><small>AI 不会直接改数据，确认后才写入</small></div></div>
        {pending.kind === "daily" ? <>
          <p>{pending.date} · {pending.channelName}</p>
          <div className={styles.changes}>{pending.changes.map((change) => <div key={change.key}><span>{change.label}</span><del>{formatAssistantValue(change.before, change.money)}</del><ArrowRight size={13} /><b>{formatAssistantValue(change.value, change.money)}</b></div>)}</div>
        </> : pending.kind === "customer_note" ? <>
          <p>客户 {pending.customer.phone} · {pending.noteKind === "group" ? "炒群情况" : "专家情况"}</p>
          <div className={styles.noteChange}><del>{pending.before}</del><ArrowRight size={14} /><b>{pending.after}</b></div>
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
      <div className={styles.samples}>{samples.map((sample) => <button type="button" key={sample} onClick={() => { setInput(sample); void understand(sample); }}>{sample}</button>)}</div>
      <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void understand(input); }}>
        <input aria-label="告诉 AI 要填写或修改什么" value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：今天 FB-M 添加20，回复8，进群3" />
        <button type="submit" disabled={busy || !input.trim()}>{busy ? "理解中…" : <><PaperPlaneTilt size={16} weight="fill" />发送</>}</button>
      </form>
      <p className={styles.safety}>所有修改先预览再确认；纠错保留旧版本和操作记录。</p>
    </div> : null}
  </section>;
}
