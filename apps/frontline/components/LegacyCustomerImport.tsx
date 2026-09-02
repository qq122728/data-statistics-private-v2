"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle, ClockCounterClockwise } from "@phosphor-icons/react";
import { requestJson } from "@/lib/backend";
import styles from "./LegacyCustomerImport.module.css";

type Option = { id: string; name: string };
type Context = { actorId: string; today: string; channelOptions: Option[]; memberOptions: Option[]; expertOptions: Option[] };
type BaselineStage = "NOT_REPLIED" | "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED" | "ORDERED";
type CurrentEvent = "NONE" | "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED" | "ORDERED" | "RECHARGE" | "WITHDRAWAL";
type Draft = {
  phone: string; customerName: string; sourceDate: string; channelId: string; receptionOwnerId: string;
  groupOperatorOwnerId: string; expertOwnerId: string; deviceCode: string; baselineStage: BaselineStage;
  joinedOn: string; expertIntroducedOn: string; registeredOn: string; openedOn: string;
  currentEvent: CurrentEvent; occurredOn: string; amount: string;
  depositMethod: "CRYPTO" | "BANK"; notes: string;
};
type PhoneLookup = {
  checkedPhone: string;
  exists: boolean;
  sameGroup?: boolean;
  message?: string;
  destination?: string;
};

const baselineOptions: Array<{ value: BaselineStage; label: string }> = [
  { value: "NOT_REPLIED", label: "接粉后未回复" }, { value: "REPLIED", label: "已回复、未进群" },
  { value: "JOINED", label: "已进群、未推专家" }, { value: "INTRODUCED", label: "已推专家、未注册" },
  { value: "REGISTERED", label: "已注册、未开单" }, { value: "ORDERED", label: "已经开单" },
];
const eventOptions: Array<{ value: CurrentEvent; label: string }> = [
  { value: "NONE", label: "只建立档案，本次无新进度" }, { value: "REPLIED", label: "本次新回复" },
  { value: "JOINED", label: "本次新进群" }, { value: "INTRODUCED", label: "本次新推专家" },
  { value: "REGISTERED", label: "本次新注册" }, { value: "ORDERED", label: "本次新开单并首充" },
  { value: "RECHARGE", label: "已开单客户本次续充" }, { value: "WITHDRAWAL", label: "已开单客户本次出金" },
];
const rank: Record<BaselineStage | Exclude<CurrentEvent, "RECHARGE" | "WITHDRAWAL">, number> = { NONE: -1, NOT_REPLIED: 0, REPLIED: 1, JOINED: 2, INTRODUCED: 3, REGISTERED: 4, ORDERED: 5 };
const moneyEvents = new Set<CurrentEvent>(["ORDERED", "RECHARGE", "WITHDRAWAL"]);

function initialDraft(today = ""): Draft { return {
  phone: "", customerName: "", sourceDate: "", channelId: "", receptionOwnerId: "", groupOperatorOwnerId: "",
  expertOwnerId: "", deviceCode: "", baselineStage: "REPLIED", joinedOn: "", expertIntroducedOn: "",
  registeredOn: "", openedOn: "", currentEvent: "JOINED",
  occurredOn: today, amount: "", depositMethod: "CRYPTO", notes: "",
}; }

export function LegacyCustomerImport({ onBack, canImportExpertStage }: { onBack: () => void; canImportExpertStage: boolean }) {
  const [context, setContext] = useState<Context | null>(null);
  const [draft, setDraft] = useState<Draft>(() => initialDraft());
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""); const [saved, setSaved] = useState("");
  const [checkingPhone, setCheckingPhone] = useState(false);
  const [phoneLookup, setPhoneLookup] = useState<PhoneLookup | null>(null);

  useEffect(() => {
    let cancelled = false;
    void requestJson<Context>("/api/lead/customer-reporting?stage=group&page=1").then((result) => {
      if (cancelled) return;
      setContext(result); setDraft((value) => ({ ...value, occurredOn: result.today, channelId: result.channelOptions[0]?.id ?? "", receptionOwnerId: result.memberOptions.find((item) => item.id === result.actorId)?.id ?? result.memberOptions[0]?.id ?? "" }));
    }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "老客户录入资料读取失败"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const validEvents = useMemo(() => eventOptions.filter((item) => {
    if (!canImportExpertStage && ["REGISTERED", "ORDERED", "RECHARGE", "WITHDRAWAL"].includes(item.value)) return false;
    if (item.value === "NONE") return true;
    if (item.value === "RECHARGE" || item.value === "WITHDRAWAL") return draft.baselineStage === "ORDERED";
    return rank[item.value] > rank[draft.baselineStage];
  }), [canImportExpertStage, draft.baselineStage]);
  const finalRank = draft.currentEvent === "RECHARGE" || draft.currentEvent === "WITHDRAWAL" ? rank.ORDERED : draft.currentEvent === "NONE" ? rank[draft.baselineStage] : rank[draft.currentEvent];
  const baselineRank = rank[draft.baselineStage];
  const needsOperator = finalRank >= rank.JOINED;
  const needsExpert = finalRank >= rank.INTRODUCED;
  const phoneReady = Boolean(phoneLookup && !phoneLookup.exists && phoneLookup.checkedPhone === draft.phone);
  const statisticText = draft.currentEvent === "JOINED" ? "只增加本次日期的进群 +1"
    : draft.currentEvent === "INTRODUCED" ? "只增加本次日期的推专家 +1"
      : draft.currentEvent === "REGISTERED" ? "只增加本次日期的注册 +1"
        : draft.currentEvent === "ORDERED" ? "只增加本次日期的开单 +1；金额只记客户进度"
          : draft.currentEvent === "RECHARGE" ? "续充金额只记客户进度，不改公司认账业绩"
            : draft.currentEvent === "WITHDRAWAL" ? "出金金额只记客户进度，不改公司认账业绩"
              : draft.currentEvent === "REPLIED" ? "只增加本次日期的回复 +1" : "只建历史档案，不增加任何日报数字";

  function set<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  async function checkPhone() {
    if (draft.phone.length !== 6 || checkingPhone) {
      setError("请先填写客户号码后 6 位");
      return;
    }
    setCheckingPhone(true); setError(""); setSaved(""); setPhoneLookup(null);
    try {
      const result = await requestJson<Omit<PhoneLookup, "checkedPhone">>(`/api/legacy-customers?phone=${encodeURIComponent(draft.phone)}`);
      const next = { ...result, checkedPhone: draft.phone };
      setPhoneLookup(next);
      if (next.exists) setError(next.sameGroup ? "该号码已在本组，请打开原客户继续更新，不能重复新增。" : "该号码已存在，不能重复新增。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "号码检查失败");
    } finally { setCheckingPhone(false); }
  }
  function scenario(kind: "JOIN" | "REGISTERED" | "OPENED" | "ORDER" | "RECHARGE") {
    setDraft((current) => ({ ...current,
      baselineStage: kind === "JOIN" ? "REPLIED" : kind === "REGISTERED" ? "REGISTERED" : kind === "ORDER" ? "REGISTERED" : "ORDERED",
      currentEvent: kind === "JOIN" ? "JOINED" : kind === "ORDER" ? "ORDERED" : kind === "RECHARGE" ? "RECHARGE" : "NONE",
      occurredOn: context?.today ?? current.occurredOn, amount: "",
    })); setError(""); setSaved("");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!context || saving) return;
    if (!phoneReady) { setError("请先检查号码，确认系统中不存在后再填写"); return; }
    const amount = Number(draft.amount);
    setSaving(true); setError(""); setSaved("");
    try {
      await requestJson("/api/legacy-customers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        phone: draft.phone, customerName: draft.customerName, sourceDate: draft.sourceDate, channelId: draft.channelId,
        receptionOwnerId: draft.receptionOwnerId, ...(draft.groupOperatorOwnerId ? { groupOperatorOwnerId: draft.groupOperatorOwnerId } : {}),
        ...(draft.expertOwnerId ? { expertOwnerId: draft.expertOwnerId } : {}), ...(draft.deviceCode ? { deviceCode: draft.deviceCode } : {}),
        baselineStage: draft.baselineStage,
        ...(draft.joinedOn ? { joinedOn: draft.joinedOn } : {}),
        ...(draft.expertIntroducedOn ? { expertIntroducedOn: draft.expertIntroducedOn } : {}),
        ...(draft.registeredOn ? { registeredOn: draft.registeredOn } : {}),
        ...(draft.openedOn ? { openedOn: draft.openedOn } : {}),
        currentEvent: draft.currentEvent,
        ...(draft.currentEvent !== "NONE" ? { occurredOn: draft.occurredOn } : {}),
        ...(moneyEvents.has(draft.currentEvent) ? { amountCents: Math.round(amount * 100) } : {}),
        ...(["ORDERED", "RECHARGE"].includes(draft.currentEvent) ? { initialDepositMethod: draft.depositMethod } : {}), notes: draft.notes,
      }) });
      setSaved(`${draft.phone} 已建立老客户档案；${statisticText}。`); window.dispatchEvent(new Event("ai-data-updated")); setPhoneLookup(null);
      setDraft({ ...initialDraft(context.today), channelId: context.channelOptions[0]?.id ?? "", receptionOwnerId: context.memberOptions.find((item) => item.id === context.actorId)?.id ?? context.memberOptions[0]?.id ?? "" });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "老客户保存失败"); }
    finally { setSaving(false); }
  }

  return <div className={styles.workspace}>
    <section className={styles.toolbar}><button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16} />返回新客户进度</button><div><strong>老客户真实进度录入</strong><span>按号码建立档案，历史不重算，今天新发生的步骤自动进入统计</span></div></section>
    {error ? <div className={styles.error}>{error}</div> : null}{saved ? <div className={styles.success}><CheckCircle size={17} weight="fill" />{saved}</div> : null}
    <section className={styles.card}>
      <header><div><h2>先选择最接近的场景</h2><p>系统会自动带出正确的历史状态和本次进度，你只需补齐号码、日期和归属。</p></div><span><i />组内实时共享</span></header>
      <div className={styles.scenarios}>
        <button type="button" data-active={draft.baselineStage === "REPLIED" && draft.currentEvent === "JOINED"} onClick={() => scenario("JOIN")}><strong>老粉今天进群</strong><small>例如 8月20日来的粉，今天才进群</small></button>
        {canImportExpertStage ? <button type="button" data-active={draft.baselineStage === "REGISTERED" && draft.currentEvent === "NONE"} onClick={() => scenario("REGISTERED")}><strong>补录已注册客户</strong><small>补齐接粉、进群、推专家和注册日期</small></button> : null}
        {canImportExpertStage ? <button type="button" data-active={draft.baselineStage === "ORDERED" && draft.currentEvent === "NONE"} onClick={() => scenario("OPENED")}><strong>补录已开单客户</strong><small>补齐全部阶段日期，历史不重算</small></button> : null}
        {canImportExpertStage ? <button type="button" data-active={draft.baselineStage === "REGISTERED" && draft.currentEvent === "ORDERED"} onClick={() => scenario("ORDER")}><strong>老粉今天开单</strong><small>以前已注册，今天开单并首充</small></button> : null}
        {canImportExpertStage ? <button type="button" data-active={draft.baselineStage === "ORDERED" && draft.currentEvent === "RECHARGE"} onClick={() => scenario("RECHARGE")}><strong>已开单老粉今天续充</strong><small>历史开单不重算，只统计今天续充</small></button> : null}
      </div>
      <form onSubmit={(event) => void submit(event)} className={styles.form}>
        <fieldset disabled={loading || saving}><legend>1. 先检查客户号码</legend><div className={styles.grid}>
          <label><span>客户号码后 6 位 *</span><input required inputMode="numeric" minLength={6} maxLength={6} value={draft.phone} placeholder="例如 112233" onChange={(event) => { set("phone", event.target.value.replace(/\D/g, "").slice(-6)); setPhoneLookup(null); setError(""); }} /></label>
          <label><span>号码查重</span><button type="button" onClick={() => void checkPhone()} disabled={checkingPhone || draft.phone.length !== 6}>{checkingPhone ? "检查中…" : "检查号码"}</button><small>{phoneReady ? "号码不存在，可以继续填写" : "号码已存在时只更新原客户，不能新建第二行"}</small></label>
        </div></fieldset>
        <fieldset disabled={loading || saving || !phoneReady}><legend>2. 客户来源与归属</legend><div className={styles.grid}>
          <label><span>接粉日期 *</span><input required type="date" max={context?.today} value={draft.sourceDate} onChange={(event) => set("sourceDate", event.target.value)} /><small>只记录什么时候来的粉，不会重复增加接粉量</small></label>
          <label><span>客户姓名</span><input maxLength={100} value={draft.customerName} onChange={(event) => set("customerName", event.target.value)} /></label>
          <label><span>来源渠道 *</span><select required value={draft.channelId} onChange={(event) => set("channelId", event.target.value)}><option value="">请选择渠道</option>{context?.channelOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>接粉归属 *</span><select required value={draft.receptionOwnerId} onChange={(event) => set("receptionOwnerId", event.target.value)}><option value="">请选择组员</option>{context?.memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>设备号</span><input maxLength={100} value={draft.deviceCode} placeholder="可后补" onChange={(event) => set("deviceCode", event.target.value)} /></label>
        </div></fieldset>
        <fieldset disabled={loading || saving || !phoneReady}><legend>3. 历史阶段与真实日期</legend><div className={styles.grid}>
          <label><span>启用前最后状态 *</span><select value={draft.baselineStage} onChange={(event) => { const next = event.target.value as BaselineStage; setDraft((current) => ({ ...current, baselineStage: next, currentEvent: "NONE", amount: "" })); }}>{baselineOptions.filter((item) => canImportExpertStage || !["REGISTERED", "ORDERED"].includes(item.value)).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          {baselineRank >= rank.JOINED ? <label><span>进群（开始炒群）日期 *</span><input required type="date" min={draft.sourceDate || undefined} max={context?.today} value={draft.joinedOn} onChange={(event) => set("joinedOn", event.target.value)} /></label> : null}
          {baselineRank >= rank.INTRODUCED ? <label><span>推专家日期 *</span><input required type="date" min={draft.joinedOn || draft.sourceDate || undefined} max={context?.today} value={draft.expertIntroducedOn} onChange={(event) => set("expertIntroducedOn", event.target.value)} /></label> : null}
          {baselineRank >= rank.REGISTERED ? <label><span>注册日期 *</span><input required type="date" min={draft.expertIntroducedOn || undefined} max={context?.today} value={draft.registeredOn} onChange={(event) => set("registeredOn", event.target.value)} /></label> : null}
          {baselineRank >= rank.ORDERED ? <label><span>开单日期 *</span><input required type="date" min={draft.registeredOn || undefined} max={context?.today} value={draft.openedOn} onChange={(event) => set("openedOn", event.target.value)} /></label> : null}
          {needsOperator ? <label><span>炒群负责人 *</span><select required value={draft.groupOperatorOwnerId} onChange={(event) => set("groupOperatorOwnerId", event.target.value)}><option value="">请选择组员</option>{context?.memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
          {needsExpert ? <label><span>专家负责人 *</span><select required value={draft.expertOwnerId} onChange={(event) => set("expertOwnerId", event.target.value)}><option value="">请选择专家或组长</option>{context?.expertOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        </div></fieldset>
        <fieldset disabled={loading || saving || !phoneReady}><legend>4. 本次真实新进度</legend><div className={styles.grid}>
          <label><span>本次发生什么 *</span><select value={draft.currentEvent} onChange={(event) => set("currentEvent", event.target.value as CurrentEvent)}>{validEvents.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          {draft.currentEvent !== "NONE" ? <label><span>实际发生日期 *</span><input required type="date" min={draft.openedOn || draft.registeredOn || draft.expertIntroducedOn || draft.joinedOn || draft.sourceDate || undefined} max={context?.today} value={draft.occurredOn} onChange={(event) => set("occurredOn", event.target.value)} /></label> : null}
          {moneyEvents.has(draft.currentEvent) ? <label><span>{draft.currentEvent === "ORDERED" ? "首充金额" : draft.currentEvent === "RECHARGE" ? "本次续充金额" : "本次出金金额"}（美元）*</span><input required type="number" min="0.01" step="0.01" value={draft.amount} placeholder="0.00" onChange={(event) => set("amount", event.target.value)} /></label> : null}
          {["ORDERED", "RECHARGE"].includes(draft.currentEvent) ? <label><span>入金方式 *</span><select value={draft.depositMethod} onChange={(event) => set("depositMethod", event.target.value as "CRYPTO" | "BANK")}><option value="CRYPTO">加密货币</option><option value="BANK">银行卡</option></select></label> : null}
          <label className={styles.notes}><span>备注</span><textarea rows={2} maxLength={1000} value={draft.notes} placeholder="可填写客户历史来源或核对说明" onChange={(event) => set("notes", event.target.value)} /></label>
        </div></fieldset>
        <div className={styles.summary}><ClockCounterClockwise size={20} /><div><strong>本次保存后的统计结果</strong><span>{statisticText}；历史阶段只建档，不重复增加统计。</span></div><button type="submit" disabled={loading || saving || !phoneReady}>{saving ? "保存中…" : "确认保存老客户"}</button></div>
      </form>
    </section>
  </div>;
}
