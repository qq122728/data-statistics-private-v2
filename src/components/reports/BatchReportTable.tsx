import type { ReportRow } from "../../app/api/reports/route";
import { DataTable } from "../ui/DataTable";
import { SectionHeader } from "../ui/SectionHeader";

const rate = (value: number | null) => value === null ? "暂无数据" : `${(value * 100).toFixed(1)}%`;
export function BatchReportTable({ rows, mode }: { rows: ReportRow[]; mode: "cumulative" | "incremental" }) {
  const isIncremental = mode === "incremental";
  return <section aria-labelledby="batch-report-heading" className="panel"><SectionHeader title="来源批次明细" description="批次数量与统一漏斗转化率；窄屏可横向查看" /><DataTable><thead><tr><th>来源批次</th><th>小组</th><th>添加数据</th><th>回复</th><th>进群</th><th>退群</th><th>{isIncremental ? "本期净增在群" : "在群"}</th><th>推专家</th><th>注册</th><th>开单</th><th>入金</th><th>回复率</th><th>进群率</th><th>异常退群率</th><th>注册率</th><th>开单率</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td className="min-w-52 font-semibold" id={row.id}>{row.label}</td><td>{row.group.name}</td><td>{row.totals.newFans}</td><td>{row.totals.replies}</td><td>{row.totals.groupJoin}</td><td className="text-red-600">{row.totals.groupLeave}</td><td>{row.totals.inGroup}</td><td>{row.totals.expertIntro}</td><td>{row.totals.registration}</td><td>{row.totals.orders}</td><td>${(row.totals.rechargeCents / 100).toFixed(2)}</td><td>{rate(row.rates?.replyRate ?? null)}</td><td>{rate(row.rates?.groupRate ?? null)}</td><td>{rate(row.rates?.leaveRate ?? null)}</td><td>{rate(row.rates?.registrationRate ?? null)}</td><td>{rate(row.rates?.orderRate ?? null)}</td></tr>)}{!rows.length ? <tr><td colSpan={16} className="empty-state">没有符合条件的来源批次</td></tr> : null}</tbody></DataTable></section>;
}
