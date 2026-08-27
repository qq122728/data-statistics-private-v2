"use client";

import { ArrowRight, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

export type HistoricalCustomerMember = { id: string; name: string; active: boolean; roleLabel: string };
export type HistoricalCustomerChannel = { id: string; name: string; active: boolean; channelType: "SMS" | "ADS" | "REBATE" };
type BaselineStage = "NOT_REPLIED" | "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED";
type CurrentEvent = "NONE" | "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED" | "ORDERED";

const baselineOptions: Array<{ value: BaselineStage; label: string; hint: string }> = [
  { value: "NOT_REPLIED", label: "未回复", hint: "该状态已计入历史汇总" },
  { value: "REPLIED", label: "已回复、未进群", hint: "历史汇总已经包含回复" },
  { value: "JOINED", label: "已进群、未推专家", hint: "历史汇总已经包含进群" },
  { value: "INTRODUCED", label: "已推专家、未注册", hint: "历史汇总已经包含推专家" },
  { value: "REGISTERED", label: "已注册、未开单", hint: "历史汇总已经包含注册" },
];
const eventOptions: Array<{ value: CurrentEvent; label: string }> = [
  { value: "NONE", label: "仅建立老客户档案" },
  { value: "REPLIED", label: "本次新回复" },
  { value: "JOINED", label: "本次新进群" },
  { value: "INTRODUCED", label: "本次新推专家" },
  { value: "REGISTERED", label: "本次新注册" },
  { value: "ORDERED", label: "本次新开单" },
];
const rank: Record<BaselineStage | CurrentEvent, number> = { NONE: -1, NOT_REPLIED: 0, REPLIED: 1, JOINED: 2, INTRODUCED: 3, REGISTERED: 4, ORDERED: 5 };

export function HistoricalCustomerDialog({
  open, today, entryRole, members, channels, currentUserId, onClose, onCreated,
}: {
  open: boolean;
  today: string;
  entryRole: "RECEPTION" | "GROUP_OPERATOR" | "EXPERT" | "LEAD";
  members: HistoricalCustomerMember[];
  channels: HistoricalCustomerChannel[];
  currentUserId: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [phone, setPhone] = useState("");
  const [checkedPhone, setCheckedPhone] = useState("");
  const [lookup, setLookup] = useState<null | { exists: boolean; sameGroup?: boolean; message?: string; destination?: string; customer?: { customerName: string | null; receptionOwnerName: string; groupOperatorOwnerName: string | null; expertOwnerName: string | null } }>(null);
  const [baselineStage, setBaselineStage] = useState<BaselineStage>("NOT_REPLIED");
  const [currentEvent, setCurrentEvent] = useState<CurrentEvent>("NONE");
  const [receptionOwnerId, setReceptionOwnerId] = useState("");
  const [groupOperatorOwnerId, setGroupOperatorOwnerId] = useState("");
  const [expertOwnerId, setExpertOwnerId] = useState("");
  const [busy, setBusy] = useState<"lookup" | "save" | "">("");
  const [error, setError] = useState("");

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    setPhone(""); setCheckedPhone(""); setLookup(null); setBaselineStage("NOT_REPLIED"); setCurrentEvent("NONE"); setError("");
    setReceptionOwnerId(entryRole === "RECEPTION" ? currentUserId : "");
    setGroupOperatorOwnerId(entryRole === "GROUP_OPERATOR" ? currentUserId : "");
    setExpertOwnerId(entryRole === "EXPERT" ? currentUserId : "");
  }, [currentUserId, entryRole, open]);

  const finalRank = currentEvent === "NONE" ? rank[baselineStage] : rank[currentEvent];
  const needsGroupOwner = finalRank >= rank.JOINED;
  const needsExpertOwner = finalRank >= rank.INTRODUCED;
  const validCurrentEvents = useMemo(() => eventOptions.filter((option) => option.value === "NONE" || rank[option.value] > rank[baselineStage]), [baselineStage]);
  const memberOptions = members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.roleLabel}{member.active ? "" : "（已停用）"}</option>);

  async function checkPhone() {
    setBusy("lookup"); setError(""); setLookup(null);
    try {
      const response = await fetch(`/api/legacy-customers?phone=${encodeURIComponent(phone.trim())}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "号码查询失败");
      setCheckedPhone(phone.trim()); setLookup(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "号码查询失败"); }
    finally { setBusy(""); }
  }

  async function submit(form: HTMLFormElement) {
    if (!lookup || lookup.exists || checkedPhone !== phone.trim()) { setError("请先查询并确认该号码尚未录入"); return; }
    const data = new FormData(form); const amount = String(data.get("initialDeposit") ?? "").trim();
    setBusy("save"); setError("");
    try {
      const response = await fetch("/api/legacy-customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        phone: phone.trim(), customerName: String(data.get("customerName") ?? ""), channelId: String(data.get("channelId") ?? ""),
        receptionOwnerId, ...(groupOperatorOwnerId ? { groupOperatorOwnerId } : {}), ...(expertOwnerId ? { expertOwnerId } : {}),
        baselineStage, baselineOn: String(data.get("baselineOn") ?? ""), currentEvent,
        ...(currentEvent !== "NONE" ? { occurredOn: String(data.get("occurredOn") ?? "") } : {}),
        ...(amount ? { initialDepositCents: Math.round(Number(amount) * 100), initialDepositMethod: String(data.get("initialDepositMethod") ?? "") } : {}), notes: String(data.get("notes") ?? ""),
      }) });
      const result = await response.json();
      if (!response.ok) { if (result.destination) setLookup({ exists: true, sameGroup: true, message: result.error, destination: result.destination }); throw new Error(result.error ?? "保存失败"); }
      onCreated?.(); onClose(); router.push(result.destination); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setBusy(""); }
  }

  if (!mounted || !open) return null;
  return createPortal(<div className="fixed inset-0 z-[110] overflow-y-auto bg-slate-950/45 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="historical-customer-title" className="mx-auto my-5 w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50/80 px-6 py-5">
        <div><div className="mb-1 text-xs font-bold tracking-wider text-blue-600">统一老客户档案</div><h2 id="historical-customer-title" className="m-0 text-xl font-bold text-slate-950">录入老客户</h2><p className="mb-0 mt-1 text-sm text-slate-600">先确认号码，再登记启用前状态和本次真实新增进度。录入号码本身不会增加粉数。</p></div>
        <button type="button" aria-label="关闭老客户录入" disabled={Boolean(busy)} onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-white disabled:opacity-50"><X size={19} /></button>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }} className="space-y-6 px-6 py-5">
        <fieldset className="rounded-xl border border-blue-100 bg-blue-50/45 p-4"><legend className="px-1 text-sm font-bold text-blue-900">1. 先查询客户号码</legend>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row"><label className="sr-only" htmlFor="historical-phone">客户号码</label><div className="relative flex-1"><MagnifyingGlass size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input id="historical-phone" value={phone} onChange={(event) => { setPhone(event.target.value); setLookup(null); setCheckedPhone(""); }} maxLength={80} placeholder="输入完整客户号码" className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" /></div><button type="button" disabled={busy === "lookup" || !phone.trim()} onClick={() => void checkPhone()} className="h-11 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white disabled:opacity-50">{busy === "lookup" ? "查询中…" : "查询号码"}</button></div>
          {lookup?.exists ? <div className={`mt-3 rounded-lg border p-4 text-sm ${lookup.sameGroup ? "border-amber-200 bg-amber-50 text-amber-950" : "border-red-200 bg-red-50 text-red-800"}`}><strong>{lookup.message ?? (lookup.sameGroup ? "该号码已经录入" : "该号码已存在")}</strong>{lookup.sameGroup && lookup.customer ? <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2"><span>客户：{lookup.customer.customerName || "未填写姓名"}</span><span>接粉归属：{lookup.customer.receptionOwnerName}</span><span>炒群归属：{lookup.customer.groupOperatorOwnerName || "待确认"}</span><span>专家归属：{lookup.customer.expertOwnerName || "待确认"}</span></div> : null}{lookup.destination ? <button type="button" onClick={() => router.push(lookup.destination!)} className="mt-3 inline-flex items-center gap-1 rounded-md bg-amber-700 px-3 py-2 text-xs font-semibold text-white">打开客户进度<ArrowRight size={14} /></button> : null}</div> : null}
          {lookup && !lookup.exists ? <p className="mb-0 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">号码尚未录入，可以继续建立老客户档案。</p> : null}
        </fieldset>

        <fieldset disabled={!lookup || lookup.exists} className="space-y-4 disabled:opacity-50"><legend className="mb-2 text-sm font-bold text-slate-900">2. 客户资料与真实归属</legend>
          <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">客户姓名（可选）<input name="customerName" maxLength={100} className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">历史渠道<select required name="channelId" defaultValue="" className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="" disabled>请选择本组历史渠道</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}（{channel.channelType === "SMS" ? "短信粉" : channel.channelType === "ADS" ? "投流粉" : "底料返点"}）{channel.active ? "" : "（已停用）"}</option>)}</select><span className="text-xs font-normal text-slate-500">系统会按所选渠道自动记录短信粉／投流粉类型；只累计转化，不增加该渠道粉数或成本。</span></label></div>
          <div className="grid gap-4 md:grid-cols-3"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">接粉归属<select required value={receptionOwnerId} onChange={(event) => setReceptionOwnerId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="" disabled>请选择本组成员</option>{memberOptions}</select></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">炒群归属{needsGroupOwner ? " *" : "（可后补）"}<select required={needsGroupOwner} value={groupOperatorOwnerId} onChange={(event) => setGroupOperatorOwnerId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="">待确认</option>{memberOptions}</select></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">专家归属{needsExpertOwner ? " *" : "（可后补）"}<select required={needsExpertOwner} value={expertOwnerId} onChange={(event) => setExpertOwnerId(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal"><option value="">待确认</option>{memberOptions}</select></label></div>
          <p className="m-0 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">三个归属都可选择本组全部成员，不按当前岗位过滤；同一个人可以同时负责多个环节。录入人不会自动获得业绩。</p>
        </fieldset>

        <fieldset disabled={!lookup || lookup.exists} className="space-y-4 disabled:opacity-50"><legend className="mb-2 text-sm font-bold text-slate-900">3. 历史底账与本次新增进度</legend>
          <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">启用前最后状态<select value={baselineStage} onChange={(event) => { const next = event.target.value as BaselineStage; setBaselineStage(next); if (currentEvent !== "NONE" && rank[currentEvent] <= rank[next]) setCurrentEvent("NONE"); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal">{baselineOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="text-xs font-normal text-slate-500">{baselineOptions.find((option) => option.value === baselineStage)?.hint}</span></label><label className="grid gap-1.5 text-sm font-semibold text-slate-700">启用前状态日期<input required type="date" name="baselineOn" max={today} className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /><span className="text-xs font-normal text-slate-500">用于定位历史渠道批次；这些阶段不重复增加统计。</span></label></div>
          <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-slate-700">本次新发生的进度<select value={currentEvent} onChange={(event) => setCurrentEvent(event.target.value as CurrentEvent)} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal">{validCurrentEvents.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{currentEvent !== "NONE" ? <label className="grid gap-1.5 text-sm font-semibold text-slate-700">实际发生日期<input required type="date" name="occurredOn" defaultValue={today} max={today} className="rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /><span className="text-xs font-normal text-slate-500">只有启用后真实发生的步骤才增加累计数据。</span></label> : <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">本次只建档，不增加回复、进群、推专家、注册或开单。</div>}</div>
          {currentEvent === "ORDERED" ? <div className="grid gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 md:grid-cols-2"><label className="grid gap-1.5 text-sm font-semibold text-emerald-950">首充金额（美元）<input required name="initialDeposit" type="number" min="0.01" step="0.01" placeholder="例如 500" className="rounded-lg border border-emerald-300 bg-white px-3 py-2.5 font-normal text-slate-900" /></label><label className="grid gap-1.5 text-sm font-semibold text-emerald-950">首充入金方式<select required name="initialDepositMethod" defaultValue="CRYPTO" className="rounded-lg border border-emerald-300 bg-white px-3 py-2.5 font-normal text-slate-900"><option value="CRYPTO">加密货币入金</option><option value="BANK">银行卡入金</option></select></label></div> : null}
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">备注（可选）<textarea name="notes" rows={3} maxLength={1000} placeholder="例如：已与历史表核对，今天重新回访" className="resize-y rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
        </fieldset>
        {error ? <p role="alert" className="m-0 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5"><p className="m-0 text-xs text-slate-500">保存后，各岗位围绕同一条客户记录同步更新。</p><div className="flex gap-2"><button type="button" disabled={Boolean(busy)} onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">取消</button><button disabled={busy === "save" || !lookup || lookup.exists} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50">{busy === "save" ? "保存中…" : "确认建立老客户档案"}</button></div></footer>
      </form>
    </section>
  </div>, document.body);
}
