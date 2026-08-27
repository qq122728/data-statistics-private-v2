"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Channel = { id: string; name: string };

export function AdvertisingBatchCreator({ channels, today }: { channels: Channel[]; today: string }) {
  const router = useRouter();
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [sourceDate, setSourceDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function create() {
    setError("");
    setSuccess("");
    if (!channelId) { setError("请先选择投流渠道"); return; }
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      setError("请填写大于 0 的美元广告费，最多两位小数");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/batches/advertising", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId, sourceDate, advertisingSpendCents: Math.round(Number(amount) * 100) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "建立失败");
      setSuccess(`已建立“${result.channelName} · ${sourceDate}”共享投流批次。请通知接粉员选择同一渠道和导入日期。`);
      setAmount("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "建立失败");
    } finally {
      setBusy(false);
    }
  }

  if (!channels.length) return <section className="panel border-amber-200 bg-amber-50/50 p-5"><h2 className="panel-title">建立共享投流批次</h2><p className="mt-2 text-sm text-slate-600">还没有启用中的投流渠道。请先让管理员在“渠道与单价”创建具体投放渠道。</p></section>;

  return <section className="panel border-amber-200 bg-amber-50/50 p-5">
    <div><h2 className="panel-title">建立共享投流批次</h2><p className="mt-1 text-sm leading-6 text-slate-600">广告费只填一次。三位接粉员随后都选择相同的渠道和导入日期，系统只合计成功新增的号码，自动给三人使用同一单粉成本。</p></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_190px_auto] sm:items-end">
      <label className="text-sm font-medium text-slate-700">投流渠道<select aria-label="投流渠道" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" value={channelId} onChange={(event) => setChannelId(event.target.value)}>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label>
      <label className="text-sm font-medium text-slate-700">导入日期<input aria-label="投流导入日期" type="date" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" value={sourceDate} onChange={(event) => setSourceDate(event.target.value)} /></label>
      <label className="text-sm font-medium text-slate-700">广告费（美元）<input aria-label="投流广告费" inputMode="decimal" placeholder="例如 1150.00" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
      <button type="button" className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-300" onClick={() => { void create(); }} disabled={busy}>{busy ? "建立中…" : "建立批次"}</button>
    </div>
    {error ? <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
    {success ? <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{success}</p> : null}
  </section>;
}
