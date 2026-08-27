import React from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import type { ManagementOverview } from "../../../lib/analytics/overview";
import { buildHeadquartersPerformance } from "../../../lib/analytics/headquarters-performance";
import { buildAnalysisHref } from "../../../lib/analytics/scope";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import { formatUsdOr } from "../../../lib/money";

const money = (cents: number | null | undefined) => formatUsdOr(cents, "待定价");
const rate = (done: number, base: number) => base ? `${(done / base * 100).toFixed(1)}%` : "暂无样本";
const percentage = (value: number | null) => value === null ? "暂无样本" : `${(value * 100).toFixed(1)}%`;
const countryName = (code: string | null | undefined) => {
  if (!code) return "未设国家";
  try { return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code; }
  catch { return code; }
};

function Rank({ value }: { value: number }) {
  return <span className="hq-rank" data-top={value <= 3}>{value}</span>;
}

export function HeadquartersCommandCenter({ overview, filters }: { overview: ManagementOverview; filters: Partial<AnalysisFilters> }) {
  const ranking = buildHeadquartersPerformance(overview.groupComparison ?? []);
  const groupHref = (groupId: string) => buildAnalysisHref("/team-performance", filters, { groupId });
  const alerts = [
    ...(overview.groupComparison ?? []).filter((row) => row.risk !== "LOW").map((row) => ({
      key: `group-risk:${row.groupId}`,
      tone: row.risk === "HIGH" ? "danger" : "warning",
      title: `${row.departmentName} / ${row.groupName} 转化或利润异常`,
      detail: `D7添加数据开单率 ${percentage(row.matureOrderRate)} · 计入业绩 ${money(row.profitCents)}`,
      href: groupHref(row.groupId),
    })),
    ...(overview.alerts.unconfirmed.length ? [{
      key: "unconfirmed",
      tone: "warning",
      title: `${overview.alerts.unconfirmed.length} 人今天尚未确认数据`,
      detail: "可能造成当天公司与小组数据不完整",
      href: buildAnalysisHref("/team-performance", filters),
    }] : []),
    ...(overview.alerts.noRecords3Days.length ? [{
      key: "no-records",
      tone: "danger",
      title: `${overview.alerts.noRecords3Days.length} 人连续3天没有录入`,
      detail: "建议由对应公司管理员或组长确认人员状态",
      href: buildAnalysisHref("/team-performance", filters),
    }] : []),
  ].slice(0, 5);

  const summary = [
    ["参与小组", ranking.groups.length, `${new Set(ranking.groups.map((row) => row.countryCode || "未设国家")).size} 个国家 · 公司与国家仅作归属`],
    ["有效数据", overview.totals.effectiveFans, `添加数据 ${overview.totals.newFans}`],
    ["开单", overview.totals.orders, `D7添加数据开单率 ${percentage(overview.summary.matureOrderRate ?? null)}`],
    ["入金", money(overview.summary.financialRechargeCents ?? overview.summary.rechargeCents), `出金 ${money(overview.summary.withdrawalCents ?? 0)}`],
    ["净业绩", money((overview.summary.financialRechargeCents ?? overview.summary.rechargeCents) - (overview.summary.withdrawalCents ?? 0)), "入金－出金"],
    ["计入业绩", money(overview.summary.profitCents), `已扣成本 ${money(overview.summary.costCents)}、返点 ${money(overview.summary.rebateCents ?? 0)}`],
  ] as const;

  return <div className="hq-command-center space-y-3">
    <section className="panel overflow-hidden" aria-label="总公司经营总览">
      <div className="hq-section-heading">
        <div><h2>总公司经营总览</h2><p>先按号码导入日期筛选，再看这些号码后续实际产生的流程和业绩；不展示客户号码。</p></div>
        <Link href="/performance-leaderboard">查看完整业绩榜 <ArrowRight size={15} /></Link>
      </div>
      <div className="hq-summary-grid">{summary.map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>)}</div>
    </section>

    <section className="panel overflow-hidden" aria-label="全部小组业绩排行">
      <div className="hq-section-heading"><div><h2>全部小组业绩排行</h2><p>所有公司、国家的小组统一排序；公司和国家只用于识别归属，不参与排名。</p></div><span>{ranking.groups.length} 个小组</span></div>
      <div className="data-table-wrap"><table className="data-table hq-table"><thead><tr><th>排名</th><th>下属公司</th><th>国家</th><th>小组</th><th>有效数据</th><th>开单</th><th>D7添加数据开单率</th><th>原始净入金</th><th>计入业绩</th><th>操作</th></tr></thead><tbody>
        {ranking.groups.map((group) => <tr key={group.groupId}><td><Rank value={group.rank} /></td><td className="text-slate-700">{group.departmentName}</td><td>{countryName(group.countryCode)}</td><td className="font-semibold text-slate-900">{group.groupName}</td><td>{group.effectiveFans}</td><td>{group.orders}</td><td>{percentage(group.matureOrderRate)}</td><td className="font-semibold text-blue-700">{money(group.netPerformanceCents)}</td><td className={group.profitCents !== null && group.profitCents < 0 ? "font-semibold text-red-700" : "font-semibold"}>{money(group.profitCents)}</td><td><Link className="hq-table-action" href={groupHref(group.groupId)}>查看小组 <ArrowRight size={14} /></Link></td></tr>)}
        {!ranking.groups.length ? <tr><td colSpan={10} className="empty-state">当前时间范围还没有小组数据</td></tr> : null}
      </tbody></table></div>
    </section>

    <section className="panel overflow-hidden" aria-label="小组流程对比">
      <div className="hq-section-heading"><div><h2>小组流程对比</h2><p>按公司、国家、小组查看流程卡点；比较主体始终是小组。</p></div></div>
      <div className="data-table-wrap"><table className="data-table hq-table hq-conversion-table"><thead><tr><th>下属公司</th><th>国家</th><th>小组</th><th>回复率</th><th>进群率</th><th>异常退群率</th><th>推专家率</th><th>联系率</th><th>注册率</th><th>开单率</th></tr></thead><tbody>
        {ranking.groups.map((group) => <tr key={group.groupId}><td>{group.departmentName}</td><td>{countryName(group.countryCode)}</td><td><Link href={groupHref(group.groupId)}>{group.groupName}</Link></td><td>{rate(group.replies ?? 0, group.effectiveFans)}</td><td>{rate(group.groupJoin ?? 0, group.replies ?? 0)}</td><td>{rate(group.abnormalGroupLeave ?? 0, group.groupJoin ?? 0)}</td><td>{rate(group.expertIntro ?? 0, group.groupJoin ?? 0)}</td><td>{rate(group.expertContacted ?? 0, group.expertIntro ?? 0)}</td><td>{rate(group.registration ?? 0, group.expertContacted ?? 0)}</td><td>{rate(group.orders, group.registration ?? 0)}</td></tr>)}
        {!ranking.groups.length ? <tr><td colSpan={10} className="empty-state">暂无可比较的小组</td></tr> : null}
      </tbody></table></div>
    </section>

    <section className="panel overflow-hidden" aria-label="总公司待处理事项">
      <div className="hq-section-heading"><div><h2>需要总公司关注</h2><p>只列最重要的5项，其余问题交给公司管理员和组长处理。</p></div>{alerts.length ? <WarningCircle size={20} className="text-amber-600" /> : <CheckCircle size={20} className="text-emerald-600" />}</div>
      {alerts.length ? <div className="hq-alert-list">{alerts.map((item) => <div key={item.key} className="hq-alert-row"><span className="analysis-status" data-tone={item.tone}>{item.tone === "danger" ? "高" : "中"}</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><Link href={item.href}>查看原因 <ArrowRight size={14} /></Link></div>)}</div> : <div className="hq-empty-success"><CheckCircle size={18} weight="fill" />当前没有需要总公司优先介入的问题</div>}
    </section>
  </div>;
}
