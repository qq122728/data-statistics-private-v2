import React from "react";
import { conversionGradeLabels } from "../../lib/conversion-standards";
import type { LeadBottleneckRow, LeadRoleGradeCard } from "../../lib/lead-management-summary";

const cardTone = { NO_SAMPLE: "neutral", BELOW_PASS: "danger", PASS: "warning", GOOD: "neutral", EXCELLENT: "success" } as const;
const rowTone = { NO_SAMPLE: "neutral", NORMAL: "success", WARNING: "warning", DANGER: "danger" } as const;
const rowLabel = { NO_SAMPLE: "暂无到期", NORMAL: "正常", WARNING: "需关注", DANGER: "严重积压" } as const;

export function LeadManagementSummary({ cards, rows }: { cards: LeadRoleGradeCard[]; rows: LeadBottleneckRow[] }) {
  return <>
    <section className="grid gap-3 lg:grid-cols-3">
      {cards.map((card) => <a href={card.href} key={card.key} className="panel lead-grade-card">
        <div className="flex items-start justify-between gap-3"><div><span className="text-xs font-semibold text-slate-500">{card.label}</span><h2 className="mt-1 text-base font-bold text-slate-900">{card.metricLabel}</h2></div><span className="analysis-status" data-tone={cardTone[card.grade]}>{conversionGradeLabels[card.grade]}</span></div>
        <div className="mt-3 flex items-end justify-between gap-4"><strong className="text-3xl text-slate-950">{card.rate === null ? "—" : `${card.rate.toFixed(1)}%`}</strong><span className="text-sm text-slate-600">{card.completed} / {card.eligible}</span></div>
        <p className="mb-0 mt-2 text-xs text-slate-500">{card.note}</p>
        <p className="mb-0 mt-1 text-xs text-slate-500">标准：及格 {card.band.pass}% · 良好 {card.band.good}% · 优秀 {card.band.excellent}%</p>
      </a>)}
    </section>
    <section className="panel lead-dashboard-section overflow-hidden">
      <div className="panel-header"><div><h2 className="panel-title">流程卡点矩阵</h2><p className="panel-subtitle">只看各环节是否堵塞，不展示客户号码；具体客户由对应岗位处理</p></div><a href="/role-rankings" className="text-sm font-semibold text-blue-700">查看岗位榜单</a></div>
      <div className="data-table-wrap"><table className="data-table lead-bottleneck-table"><thead><tr><th>岗位</th><th>流程节点</th><th>已到处理时间</th><th>已完成</th><th>超时未完成</th><th>当前完成率</th><th>最长超时</th><th>状态</th><th>规则</th></tr></thead><tbody>{rows.map((item) => <tr key={item.key}><td><strong>{item.role}</strong></td><td>{item.label}</td><td>{item.eligible}</td><td>{item.completed}</td><td><strong className={item.overdue ? "text-red-700" : "text-emerald-700"}>{item.overdue}</strong></td><td>{item.completionRate === null ? "—" : `${item.completionRate.toFixed(1)}%`}</td><td>{item.overdue ? `${item.longestOverdueDays} 天` : "—"}</td><td><span className="analysis-status" data-tone={rowTone[item.status]}>{rowLabel[item.status]}</span></td><td><span className="text-xs text-slate-500">{item.rule}</span></td></tr>)}</tbody></table></div>
    </section>
  </>;
}
