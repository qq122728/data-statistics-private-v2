"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import type { CompanyGroupHealth, CompanyRoleMetric, CompanyWorkspace } from "../../../lib/analytics/company-workspace";
import type { ManagementOverview } from "../../../lib/analytics/overview";
import { buildAnalysisHref } from "../../../lib/analytics/scope";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import { conversionGradeLabels, type ConversionGrade } from "../../../lib/conversion-standards";
import { formatUsdOr } from "../../../lib/money";

const money = (cents: number | null | undefined) => formatUsdOr(cents, "待定价");
const percent = (value: number | null | undefined) => value === null || value === undefined ? "样本不足" : `${(value * 100).toFixed(1)}%`;
const gradeTone: Record<ConversionGrade, "neutral" | "danger" | "warning" | "success"> = {
  NO_SAMPLE: "neutral",
  BELOW_PASS: "danger",
  PASS: "warning",
  GOOD: "success",
  EXCELLENT: "success",
};
const statusLabel = { NORMAL: "正常", WARNING: "需关注", DANGER: "异常", INSUFFICIENT: "样本不足" } as const;
const statusTone = { NORMAL: "success", WARNING: "warning", DANGER: "danger", INSUFFICIENT: "neutral" } as const;

function RoleCell({ metric }: { metric: CompanyRoleMetric }) {
  return <div className="company-role-cell">
    <div><strong>{percent(metric.rate)}</strong><span className="analysis-status" data-tone={gradeTone[metric.grade]}>{conversionGradeLabels[metric.grade]}</span></div>
    <small>{metric.completed} / {metric.eligible}</small>
  </div>;
}

function ResourceCell({ group }: { group: CompanyGroupHealth }) {
  return <div className="company-role-cell">
    <div><strong>{percent(group.effectiveRate)}</strong><span className="analysis-status" data-tone={statusTone[group.resourceStatus]}>{statusLabel[group.resourceStatus]}</span></div>
    <small>号码有效率</small>
  </div>;
}

export function CompanyCommandCenter({
  overview,
  workspace,
  filters,
}: {
  overview: ManagementOverview;
  workspace: CompanyWorkspace;
  filters: Partial<AnalysisFilters>;
}) {
  const quality = workspace.resource.quality;
  const flow = [
    ["添加数据", quality.submitted],
    ["有效数据", quality.effective],
    ["回复", overview.totals.replies],
    ["进群", overview.totals.groupJoin],
    ["推专家", overview.totals.expertIntro],
    ["注册", overview.totals.registration],
    ["开单", overview.totals.orders],
  ] as const;
  return <div className="company-command-center space-y-3">
    <section className="panel overflow-hidden" aria-label="公司经营概况">
      <div className="company-kpi-strip">
        <div><span>入金</span><strong>{money(overview.summary.financialRechargeCents ?? overview.summary.rechargeCents)}</strong><small>资金实际发生</small></div>
        <div><span>净业绩</span><strong>{money((overview.summary.financialRechargeCents ?? overview.summary.rechargeCents) - (overview.summary.withdrawalCents ?? 0))}</strong><small>入金－出金</small></div>
        <div><span>D7添加数据开单率</span><strong>{percent(quality.matureOrderRate)}</strong><small>开单 {quality.matureOrders} / 成熟 {quality.matureSample}</small></div>
        <div><span>严重超时客户率</span><strong>{percent(workspace.seriousOverdue.rate)}</strong><small>{workspace.seriousOverdue.count} / 到期 {workspace.seriousOverdue.eligible}</small></div>
      </div>
    </section>

    <section className="panel overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">整体流程</h2><p className="panel-subtitle">按当前公司和所选来源范围，快速查看客户流转</p></div></div>
      <div className="company-flow-strip">
        {flow.map(([label, value], index) => {
          const previous = index ? flow[index - 1][1] : null;
          const rate = previous ? value / previous : null;
          return <div className="company-flow-step" key={label}>
            {index ? <div className="company-flow-arrow"><span>→</span><small>{percent(rate)}</small></div> : null}
            <div><span>{label}</span><strong>{value.toLocaleString("zh-CN")}</strong></div>
          </div>;
        })}
      </div>
    </section>

    <div className="company-health-layout">
      <section className="panel min-w-0 overflow-hidden">
        <div className="panel-header"><div><h2 className="panel-title">小组健康表</h2><p className="panel-subtitle">默认将异常和严重超时较多的小组排在前面</p></div></div>
        <div className="data-table-wrap"><table className="data-table company-health-table">
          <thead><tr><th>小组</th><th>资源质量</th><th>进群率</th><th>第3天推专家率</th><th>第2天开单率</th><th>净业绩</th><th>严重超时</th><th>状态</th></tr></thead>
          <tbody>{workspace.groups.map((group) => <tr key={group.groupId}>
            <td><Link className="font-semibold text-blue-700" href={buildAnalysisHref("/team-performance", filters, { groupId: group.groupId })}>{group.groupName}</Link></td>
            <td><ResourceCell group={group} /></td>
            <td><RoleCell metric={group.reception} /></td>
            <td><RoleCell metric={group.operator} /></td>
            <td><RoleCell metric={group.expert} /></td>
            <td className={group.netPerformanceCents < 0 ? "font-semibold text-red-700" : "font-semibold"}>{money(group.netPerformanceCents)}</td>
            <td><strong className={group.seriousOverdue ? "text-red-700" : "text-emerald-700"}>{group.seriousOverdue}</strong></td>
            <td><span className="analysis-status" data-tone={statusTone[group.status]}>{statusLabel[group.status]}</span></td>
          </tr>)}{!workspace.groups.length ? <tr><td colSpan={8} className="empty-state">当前范围没有小组数据</td></tr> : null}</tbody>
        </table></div>
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-header"><div><h2 className="panel-title">重点关注</h2><p className="panel-subtitle">只保留最需要公司介入的3项</p></div></div>
        {workspace.attention.length ? <div className="management-attention-list">{workspace.attention.map((item) => <div className="management-attention-row" key={item.key}>
          <span className="analysis-status" data-tone={item.tone}>{item.tone === "danger" ? "高" : "中"}</span>
          <div><strong>{item.title}</strong><span>{item.detail}</span></div>
          <Link className="management-attention-action" href={buildAnalysisHref("/team-performance", filters, { groupId: item.groupId })}>查看小组 <ArrowRight size={15} aria-hidden="true" /></Link>
        </div>)}</div> : <p className="empty-state">当前没有需要公司优先介入的问题</p>}
      </section>
    </div>
  </div>;
}
