"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, ClockCountdown, Info } from "@phosphor-icons/react";
import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ManagementOverview } from "../../../lib/analytics/overview";
import { buildAnalysisHref } from "../../../lib/analytics/scope";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import { HeadquartersPerformanceLeaderboard } from "./HeadquartersPerformanceLeaderboard";
import { formatUsdOr } from "../../../lib/money";

const money = (cents: number | null) => formatUsdOr(cents, "—");
const percent = (value: number | null) => value === null ? "样本不足" : `${(value * 100).toFixed(1)}%`;
const stageNames = {
  NEW_FANS: "添加数据",
  REPLIES: "回复",
  GROUP_JOIN: "入群",
  EXPERT_INTRO: "推专家",
  REGISTRATION: "注册",
  ORDER: "开单",
} as const;

const riskText = { HIGH: "高风险", MEDIUM: "需关注", LOW: "正常" } as const;
const riskTone = { HIGH: "danger", MEDIUM: "warning", LOW: "success" } as const;

export function ManagementCommandCenter({
  overview,
  filters,
  role,
}: {
  overview: ManagementOverview;
  filters: Partial<AnalysisFilters>;
  role: "ADMIN" | "RESOURCE_MANAGER" | "COMPANY_MANAGER";
}) {
  const groupComparison = overview.groupComparison ?? [];
  const funnel = [
    { name: "添加数据", value: overview.totals.newFans, fill: "#5b94f7" },
    { name: "回复", value: overview.totals.replies, fill: "#73a5f8" },
    { name: "入群", value: overview.totals.groupJoin, fill: "#8ab5f9" },
    { name: "推专家", value: overview.totals.expertIntro, fill: "#a0c4fa" },
    { name: "注册", value: overview.totals.registration, fill: "#b6d3fb" },
    { name: "开单", value: overview.totals.orders, fill: "#cbdffb" },
  ];
  const peopleAlerts = [
    ...overview.alerts.unconfirmed,
    ...overview.alerts.noRecords3Days,
  ];
  const processAlerts = [
    ...(overview.alerts.unassignedExperts ?? []),
    ...(overview.alerts.registrationOverdue ?? []),
    ...(overview.alerts.orderOverdue ?? []),
    ...(overview.alerts.planOverdue ?? []),
  ];
  const attention = [
    ...groupComparison
      .filter((row) => row.risk !== "LOW")
      .map((row) => ({
        key: `group:${row.groupId}`,
        level: row.risk === "HIGH" ? "高" : "中",
        title: `${row.departmentName} / ${row.groupName} ${riskText[row.risk]}`,
        detail: row.netPerformanceCents < 0
          ? `当前范围净业绩 ${money(row.netPerformanceCents)}`
          : `D7添加数据开单率 ${percent(row.matureOrderRate)}`,
        href: buildAnalysisHref("/team-performance", filters, { groupId: row.groupId }),
      })),
    ...peopleAlerts.map((row) => ({
      key: `person:${row.userId}:${row.reason}`,
      level: row.reason.includes("3 天") ? "高" : "中",
      title: row.reason,
      detail: `负责人：${row.name}`,
      href: buildAnalysisHref("/team-performance", filters, { memberId: row.userId }),
    })),
    ...processAlerts.map((row) => ({
      key: `process:${row.leadId}:${row.reason}`,
      level: "高",
      title: row.reason,
      detail: `归属：${row.ownerName}（客户信息已隐藏）`,
      href: role === "ADMIN" ? "/customer-follow-up" : "/team-performance",
    })),
  ].slice(0, 3);

  return (
    <div className="management-command-center space-y-4">
      {role === "ADMIN" ? <HeadquartersPerformanceLeaderboard performanceRows={groupComparison} filters={filters} /> : null}
      <section className="management-equation" aria-label="经营结果公式">
        <div><span>入金</span><strong>{money(overview.summary.financialRechargeCents ?? overview.summary.rechargeCents)}</strong></div>
        <b aria-hidden="true">−</b>
        <div><span>出金</span><strong>{money(overview.summary.withdrawalCents ?? 0)}</strong></div>
        <b aria-hidden="true">=</b>
        <div className="management-equation-result"><span>净业绩</span><strong>{money(overview.summary.netPerformanceCents ?? null)}</strong></div>
        <div className="management-equation-rate">
          <span>D7添加数据开单率</span>
          <strong>{percent(overview.summary.matureOrderRate ?? null)}</strong>
          <small>开单 {overview.summary.matureOrders ?? 0} / 成熟添加数据 {overview.summary.matureNewFans ?? 0}</small>
        </div>
      </section>

      <div className="management-diagnosis-grid">
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">{role === "ADMIN" ? "下属公司与小组对比" : role === "COMPANY_MANAGER" ? "本公司小组对比" : "资源配置对比"}</h2>
              <p className="panel-subtitle">同一来源范围、同一成熟口径，点击小组查看明细</p>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table management-comparison-table">
              <thead><tr><th>公司 / 小组</th><th>净业绩</th><th>有效数据</th><th>D7添加数据开单率</th><th>今日确认</th><th>状态</th></tr></thead>
              <tbody>
                {groupComparison.map((row) => (
                  <tr key={row.groupId}>
                    <td><span className="block text-xs text-slate-400">{row.departmentName}</span><Link href={buildAnalysisHref("/team-performance", filters, { groupId: row.groupId })} className="font-semibold text-[#0b66ff]">{row.groupName}</Link></td>
                    <td className={row.netPerformanceCents < 0 ? "font-semibold text-red-700" : "font-semibold text-slate-800"}>{money(row.netPerformanceCents)}</td>
                    <td>{row.effectiveFans}</td>
                    <td>{percent(row.matureOrderRate)}</td>
                    <td>{row.confirmedPeople} / {row.activePeople}</td>
                    <td><span className="analysis-status" data-tone={riskTone[row.risk]}>{riskText[row.risk]}</span></td>
                  </tr>
                ))}
                {!groupComparison.length ? <tr><td colSpan={6} className="empty-state">当前范围没有可比较的小组</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">整体转化漏斗</h2>
              <p className="panel-subtitle">快速定位流失最多的环节</p>
            </div>
          </div>
          <div className="management-funnel">
            {overview.hasData ? (
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={funnel} layout="vertical" margin={{ top: 8, right: 44, bottom: 8, left: 8 }}>
                  <XAxis type="number" hide domain={[0, "dataMax"]} />
                  <YAxis type="category" dataKey="name" width={72} tick={{ fill: "#596579", fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value) => [Number(value).toLocaleString("zh-CN"), "人数"]} />
                  <Bar dataKey="value" fill="#5b94f7" radius={[0, 5, 5, 0]} minPointSize={2} isAnimationActive={false}>
                    <LabelList position="right" fill="#344054" dataKey="value" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="empty-state">当前范围没有漏斗数据</p>}
            {overview.largestDrop ? (
              <div className="management-drop-note">
                <Info size={17} aria-hidden="true" />
                最大掉点：{stageNames[overview.largestDrop.from]} → {stageNames[overview.largestDrop.to]}，流失 {overview.largestDrop.lost} 人
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div><h2 className="panel-title">需要关注</h2><p className="panel-subtitle">只显示当前最重要的 3 项，避免提醒淹没真正的问题</p></div>
          <ClockCountdown size={21} className="text-slate-400" aria-hidden="true" />
        </div>
        {attention.length ? <div className="management-attention-list">{attention.map((item) => (
          <div key={item.key} className="management-attention-row">
            <span className="analysis-status" data-tone={item.level === "高" ? "danger" : "warning"}>{item.level}</span>
            <div><strong>{item.title}</strong><span>{item.detail}</span></div>
            <Link href={item.href} className="management-attention-action">查看原因 <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
        ))}</div> : <p className="empty-state">当前没有需要优先处理的问题</p>}
      </section>
    </div>
  );
}
