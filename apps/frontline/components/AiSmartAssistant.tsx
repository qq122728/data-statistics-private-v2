"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Check, MagicWand, PaperPlaneTilt, ShieldCheck, X } from "@phosphor-icons/react";
import { requestJson, type BackendUser } from "@/lib/backend";
import { localToday } from "@/lib/frontline-workbench";
import {
  EMPTY_DAILY_VALUES,
  formatAssistantValue,
  interpretAssistantMessage,
  withComputedValues,
  type DailyValues,
  type MetricUpdate,
} from "@/lib/ai-smart-assistant";
import styles from "./AiSmartAssistant.module.css";

type DailyContext = {
  today: string;
  channels: Array<{ id: string; name: string; channelType: string }>;
  unifiedEntries: Array<{ entryId: string | null; businessDate: string; channel: { id: string; name: string }; values: DailyValues }>;
};
type Customer = {
  id: string; phone: string; customerName: string | null; joinedOn: string | null; registeredOn: string | null;
  groupStatus: string; expertIntroducedOn: string | null; expertNotes: string | null; nextPlan: string | null;
  owner: { name: string } | null; attributionOwner: { name: string } | null;
  groupOperatorOwner: { name: string } | null; expertOwner: { name: string } | null;
  batch: { channel: { name: string } };
  activities: Array<{ kind: string; note: string | null; occurredOn: string }>;
  order: { initialDepositCents: number; rechargeCents: number; withdrawalCents: number } | null;
};
type CustomerPayload = { customers: Customer[] };
type Change = MetricUpdate & { before: number };
type PendingAction =
  | { kind: "daily"; channelId: string; channelName: string; date: string; entryId: string | null; current: DailyValues; changes: Change[]; correction: boolean; original: string; today: string }
  | { kind: "customer_note"; customer: Customer; noteKind: "group" | "expert"; before: string; after: string; original: string };
type ChatItem = { id: number; from: "user" | "assistant"; text: string };

const samples = [
  "今天 FB-M 添加20，回复8，进群3",
  "JH 回复写错了，改成8",
  "查客户 123456 的进度",
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
      const intent = interpretAssistantMessage(message);
      if (intent.kind === "daily") {
        const context = await requestJson<DailyContext>("/api/daily-stats");
        const channel = [...context.channels].sort((a, b) => b.name.length - a.name.length).find((item) => message.toLowerCase().includes(item.name.toLowerCase()));
        if (!channel) {
          reply(`我识别到了数据，但还不知道归哪个渠道。请补上渠道名称，例如：${context.channels[0]?.name ?? "FB-M"} 添加20，回复8。`);
          return;
        }
        const date = dateFromMessage(message, context.today);
        const existing = context.unifiedEntries.find((item) => item.businessDate === date && item.channel.id === channel.id);
        const current = { ...EMPTY_DAILY_VALUES, ...(existing?.values ?? {}) };
        const changes = intent.updates.map((update) => ({ ...update, before: current[update.key] }));
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
        for (const change of pending.changes) values[change.key] = change.value;
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
      } else {
        await requestJson(`/api/leads/${pending.customer.id}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify(pending.noteKind === "group"
            ? { action: "updateGroupProgress", progressNote: pending.after, occurredOn: localToday() }
            : { action: "updateExpertDetails", expertNotes: pending.after, occurredOn: localToday() }),
        });
        reply(`客户 ${pending.customer.phone} 的${pending.noteKind === "group" ? "炒群情况" : "专家情况"}已更新，并记录了操作账号和时间。`);
        onNavigate("customers");
      }
      window.dispatchEvent(new CustomEvent("ai-data-updated"));
      setPending(null);
    } catch (caught) {
      const messageText = caught instanceof Error ? caught.message : "保存失败，请稍后再试";
      setError(messageText); reply(messageText);
    } finally { setBusy(false); }
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
        </> : <>
          <p>客户 {pending.customer.phone} · {pending.noteKind === "group" ? "炒群情况" : "专家情况"}</p>
          <div className={styles.noteChange}><del>{pending.before}</del><ArrowRight size={14} /><b>{pending.after}</b></div>
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
