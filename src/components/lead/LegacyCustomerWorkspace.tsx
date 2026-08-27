"use client";

import { Plus, Trash, UserPlus } from "@phosphor-icons/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatUsd } from "../../lib/money";

type Member = { id: string; name: string; active: boolean };
type Channel = { id: string; name: string };
type Customer = {
  id: string; phone: string; customerName: string | null; historicalSourceName: string | null; joinedOn: string | null; registeredOn: string | null;
  owner: { name: string }; groupOperatorOwner: { name: string } | null; expertOwner: { name: string } | null;
  customerOrder: null | { id: string; openedOn: string; initialDepositCents: number; voidedAt: Date | null; events: Array<{ id: string; kind: string; occurredOn: string; amountCents: number | null; continuationNumber: number | null }> };
};
type Transaction = { kind: "RECHARGE" | "WITHDRAWAL"; occurredOn: string; amount: string; note: string };
const today = () => new Date().toISOString().slice(0, 10);

export function LegacyCustomerWorkspace({ members, channels, customers }: { members: Member[]; channels: Channel[]; customers: Customer[] }) {
  const router = useRouter();
  const memberLabel = (member: Member) => member.active ? member.name : `${member.name}（已停用／历史成员）`;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const addTransaction = () => setTransactions((rows) => [...rows, { kind: "RECHARGE", occurredOn: today(), amount: "", note: "" }]);
  const setTransaction = (index: number, patch: Partial<Transaction>) => setTransactions((rows) => rows.map((row, itemIndex) => itemIndex === index ? { ...row, ...patch } : row));
  const removeTransaction = (index: number) => setTransactions((rows) => rows.filter((_, itemIndex) => itemIndex !== index));

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const initialAmount = String(data.get("initialDeposit") ?? "").trim();
    const toCents = (value: string) => Math.round(Number(value) * 100);
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/legacy-customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        phone: data.get("phone"), customerName: data.get("customerName") || undefined, contactedOn: data.get("contactedOn"), historicalSourceName: data.get("historicalSourceName"),
        receptionOwnerId: data.get("receptionOwnerId"), groupOperatorOwnerId: data.get("groupOperatorOwnerId") || undefined, expertOwnerId: data.get("expertOwnerId") || "SELF",
        joinedOn: data.get("joinedOn") || undefined, registeredOn: data.get("registeredOn") || undefined, openedOn: data.get("openedOn") || undefined,
        initialDepositCents: initialAmount ? toCents(initialAmount) : undefined, notes: data.get("notes") || undefined,
        transactions: transactions.map((row) => ({ kind: row.kind, occurredOn: row.occurredOn, amountCents: toCents(row.amount), note: row.note || undefined })),
      }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存失败");
      setOpen(false); setTransactions([]); setNotice("老客户已补录。资金和归属已按真实日期写入，新增粉与广告成本没有变化。"); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setSaving(false); }
  }
  return <section className="panel p-4">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-900">历史客户库</h2><p className="mt-1 text-sm text-slate-600">已补录 {customers.length} 位。每位客户都有“历史补录”标记，和今天待处理的新客户分开。</p></div><button type="button" onClick={() => { setOpen(true); setError(""); }} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm"><UserPlus size={18} weight="bold" />录入老客户</button></div>
    {notice ? <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p> : null}
    <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr><th className="px-3 py-3">客户</th><th className="px-3 py-3">历史来源</th><th className="px-3 py-3">归属</th><th className="px-3 py-3">首充 / 净业绩</th><th className="px-3 py-3">状态</th></tr></thead><tbody>{customers.map((customer) => { const recharges = customer.customerOrder?.events.filter((event) => event.kind === "RECHARGE" && event.continuationNumber !== null).reduce((sum, event) => sum + (event.amountCents ?? 0), 0) ?? 0; const withdrawals = customer.customerOrder?.events.filter((event) => event.kind === "WITHDRAWAL").reduce((sum, event) => sum + (event.amountCents ?? 0), 0) ?? 0; const initial = customer.customerOrder?.initialDepositCents ?? 0; return <tr key={customer.id} className="border-t border-slate-100"><td className="px-3 py-3 font-medium text-slate-900">{customer.phone}<small className="mt-1 block font-normal text-slate-500">{customer.customerName || "未填写姓名"} · 历史补录</small></td><td className="px-3 py-3">{customer.historicalSourceName || "待补"}</td><td className="px-3 py-3"><div>接粉：{customer.owner.name}</div><div>炒群：{customer.groupOperatorOwner?.name || "未分配"}</div><div>专家：{customer.expertOwner?.name || "组长跟进"}</div></td><td className="px-3 py-3"><div>{customer.customerOrder ? `首充 ${formatUsd(initial)}` : "未补资金"}</div><strong className="text-slate-900">{formatUsd(initial + recharges - withdrawals)}</strong></td><td className="px-3 py-3">{customer.customerOrder ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">已开单</span> : <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">待补资金</span>}</td></tr>; })}{!customers.length ? <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-500">还没有历史客户。点击右上角开始补录。</td></tr> : null}</tbody></table></div>
    {open ? <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4"><div className="mx-auto my-8 max-w-3xl rounded-2xl bg-white p-6 shadow-2xl"><div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">录入老客户</h2><p className="mt-1 text-sm text-slate-600">按真实历史填写；系统不会把它当作今天新接的粉。</p></div><button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500">关闭</button></div><form onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget); }} className="space-y-6"><fieldset className="grid gap-4 md:grid-cols-2"><legend className="mb-2 font-semibold">1. 基本资料</legend><label>手机号<input required name="phone" placeholder="例如 17770001006" className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label>客户姓名<input name="customerName" className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label>接粉日期<input required type="date" name="contactedOn" defaultValue={today()} className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label>历史来源渠道<select required name="historicalSourceName" defaultValue="" className="mt-1 w-full rounded-lg border px-3 py-2"><option value="" disabled>请选择本组已有渠道</option>{channels.map((channel) => <option key={channel.id} value={channel.name}>{channel.name}</option>)}</select><small className="mt-1 block text-slate-500">渠道由本组系统自动读取，只能从已有渠道中选择。</small></label></fieldset><fieldset className="grid gap-4 md:grid-cols-2"><legend className="mb-2 font-semibold">2. 真实归属与流程</legend><label>接粉员<select required name="receptionOwnerId" defaultValue="" className="mt-1 w-full rounded-lg border px-3 py-2"><option value="" disabled>请选择历史实际负责人</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label>炒群员<select name="groupOperatorOwnerId" defaultValue="" className="mt-1 w-full rounded-lg border px-3 py-2"><option value="">暂不指定</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></label><label>专家负责人<select name="expertOwnerId" defaultValue="SELF" className="mt-1 w-full rounded-lg border px-3 py-2"><option value="SELF">组长本人（默认跟进）</option>{members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select><small className="mt-1 block text-slate-500">三个归属都可选择本组全部成员（含停用／历史成员）；按当时实际情况填写即可。</small></label><div className="grid grid-cols-2 gap-3"><label>进群日期<input type="date" name="joinedOn" className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label>注册日期<input type="date" name="registeredOn" className="mt-1 w-full rounded-lg border px-3 py-2" /></label></div></fieldset><fieldset><legend className="mb-2 font-semibold">3. 历史资金（可先留空，以后再补）</legend><div className="grid gap-4 md:grid-cols-2"><label>首充日期<input type="date" name="openedOn" className="mt-1 w-full rounded-lg border px-3 py-2" /></label><label>首充金额（美元）<input inputMode="decimal" min="0" step="0.01" name="initialDeposit" className="mt-1 w-full rounded-lg border px-3 py-2" /></label></div><div className="mt-3 space-y-2">{transactions.map((row, index) => <div key={index} className="grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-[120px_150px_1fr_36px]"><select value={row.kind} onChange={(event) => setTransaction(index, { kind: event.target.value as Transaction["kind"] })} className="rounded border px-2 py-2"><option value="RECHARGE">续充入金</option><option value="WITHDRAWAL">出金</option></select><input type="date" value={row.occurredOn} onChange={(event) => setTransaction(index, { occurredOn: event.target.value })} className="rounded border px-2 py-2" /><input required inputMode="decimal" placeholder="金额（美元）" value={row.amount} onChange={(event) => setTransaction(index, { amount: event.target.value })} className="rounded border px-2 py-2" /><button type="button" aria-label="删除这笔资金" onClick={() => removeTransaction(index)} className="text-red-600"><Trash size={18} /></button></div>)}</div><button type="button" onClick={addTransaction} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-700"><Plus size={16} />增加续充或出金</button></fieldset><label className="block">补录备注<textarea name="notes" rows={3} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="例如：7 月老客户，已与原记录核对" /></label>{error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}<div className="flex justify-end gap-3 border-t pt-5"><button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm">取消</button><button disabled={saving} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">{saving ? "保存中…" : "确认补录"}</button></div></form></div></div> : null}
  </section>;
}
