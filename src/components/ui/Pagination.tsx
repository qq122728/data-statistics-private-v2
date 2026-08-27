import Link from "next/link";
import { pageHref } from "../../lib/pagination";

export function Pagination({ pathname, values, page, pageSize, total, label = "客户" }: {
  pathname: string;
  values: Record<string, string>;
  page: number;
  pageSize: number;
  total: number;
  label?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return <p className="m-0 text-xs text-slate-500">共 {total.toLocaleString("zh-CN")} 位{label}</p>;
  const current = Math.min(page, totalPages);
  return (
    <nav aria-label={`${label}分页`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
      <span className="text-slate-600">共 {total.toLocaleString("zh-CN")} 位{label} · 第 {current}/{totalPages} 页 · 每页 {pageSize} 位</span>
      <span className="flex items-center gap-2">
        {current > 1 ? <Link href={pageHref(pathname, values, current - 1)} className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">上一页</Link> : <span className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-300">上一页</span>}
        {current < totalPages ? <Link href={pageHref(pathname, values, current + 1)} className="rounded-md border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50">下一页</Link> : <span className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-300">下一页</span>}
      </span>
    </nav>
  );
}
