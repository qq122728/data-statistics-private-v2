"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatUsd } from "../../../lib/money";

type Props = {
  batchId: string;
  advertisingSpendCents: number | null;
  advertisingFanCount: number | null;
  advertisingServiceFeeRateBps: number | null;
  effectiveFanPriceCentsSnapshot: number | null;
  canEdit: boolean;
};

export function AdvertisingSpendEditor({
  batchId,
  advertisingSpendCents,
  advertisingFanCount,
  advertisingServiceFeeRateBps,
  effectiveFanPriceCentsSnapshot,
  canEdit,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(advertisingSpendCents === null && canEdit);
  const [amount, setAmount] = useState(advertisingSpendCents === null ? "" : (advertisingSpendCents / 100).toFixed(2));
  const [correctionReason, setCorrectionReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const hasSavedSpend = advertisingSpendCents !== null;
  const hasImportedFans = (advertisingFanCount ?? 0) > 0;
  const serviceRate = (advertisingServiceFeeRateBps ?? 1_500) / 100;

  async function save() {
    setError("");
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      setError("请填写大于 0 的美元金额，最多两位小数");
      return;
    }
    if (hasSavedSpend && !correctionReason.trim()) {
      setError("请写明这次更正的原因");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/batches/${batchId}/advertising-spend`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          advertisingSpendCents: Math.round(Number(amount) * 100),
          correctionReason: correctionReason.trim() || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setEditing(false);
      setCorrectionReason("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel border-amber-200 bg-amber-50/40 p-5">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
      <div>
        <h2 className="panel-title">投流广告损耗</h2>
        <p className="mt-1 text-sm text-slate-600">本批所有接粉员合计有效新增 {advertisingFanCount ?? 0} 个；单粉成本 = 广告损耗 × {serviceRate.toFixed(0)}% ÷ 合计有效新增数。后续有人继续导入时，系统会自动统一更新成本。</p>
      </div>
      {hasSavedSpend && hasImportedFans && !editing ? <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">统一成本已更新</span> : hasSavedSpend ? <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800">已设置 · 等待导入</span> : <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">待组长填写</span>}
    </div>
    {!editing ? <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm"><div><dt className="text-slate-500">广告损耗</dt><dd className="mt-1 text-lg font-bold text-slate-900">{formatUsd(advertisingSpendCents ?? 0)}</dd></div><div><dt className="text-sm text-slate-500">冻结单粉成本</dt><dd className="mt-1 text-lg font-bold text-slate-900">{effectiveFanPriceCentsSnapshot === null ? "待核算" : formatUsd(effectiveFanPriceCentsSnapshot)}</dd></div></dl>
      {canEdit ? <button type="button" className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100" onClick={() => setEditing(true)}>更正广告损耗</button> : null}
    </div> : <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr_auto] sm:items-end">
      <label className="text-sm font-medium text-slate-700">广告损耗（美元）<input aria-label="广告损耗（美元）" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="例如 100.00" /></label>
      {hasSavedSpend ? <label className="text-sm font-medium text-slate-700">更正说明<input aria-label="更正说明" className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="例如：广告后台金额更正" maxLength={300} /></label> : <p className="mb-1 text-sm leading-5 text-slate-500">接粉员无法填写。保存后会按本批所有接粉员的有效新增数，统一更新资源成本和相关报表。</p>}
      <div className="flex gap-2"><button type="button" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-300" onClick={() => { void save(); }} disabled={saving}>{saving ? "保存中…" : "保存核算"}</button>{hasSavedSpend ? <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700" onClick={() => { setEditing(false); setAmount((advertisingSpendCents / 100).toFixed(2)); setCorrectionReason(""); setError(""); }} disabled={saving}>取消</button> : null}</div>
    </div>}
    {error ? <p role="alert" className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
  </section>;
}
