import type { BatchTotals, ConversionRates } from "../../lib/metrics";

type Window = { state: "MATURE" | "PENDING"; totals: BatchTotals; rates: ConversionRates };

const percent = (value: number | null) => value === null ? "分母为 0" : `${(value * 100).toFixed(1)}%`;

export function MaturityWindowCards({ d7, d14 }: { d7: Window; d14: Window }) {
  const windows: Array<{ label: "D7" | "D14"; window: Window }> = [{ label: "D7", window: d7 }, { label: "D14", window: d14 }];
  return <div className="grid gap-3 md:grid-cols-2">{windows.map(({ label, window }) => {
    return <article className="rounded-lg border border-slate-200 bg-white p-4" key={label}><h3 className="font-semibold">{label} 累计</h3>{window.state === "PENDING" ? <p className="mt-3 text-sm text-slate-500">尚未达到 {label}</p> : <><p className="mt-3 text-sm text-slate-600">{label}添加数据样本 <strong className="text-slate-900">{window.totals.newFans}</strong></p><dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt className="text-slate-500">进群率</dt><dd className="mt-1 font-semibold">{percent(window.rates.groupRate)}</dd></div><div><dt className="text-slate-500">注册率</dt><dd className="mt-1 font-semibold">{percent(window.rates.registrationRate)}</dd></div><div><dt className="text-slate-500">开单率</dt><dd className="mt-1 font-semibold">{percent(window.rates.orderRate)}</dd></div></dl><p className="mt-3 text-xs text-slate-500">开单 {window.totals.orders} · 入金 ${(window.totals.rechargeCents / 100).toFixed(2)}</p></>}</article>;
  })}</div>;
}
