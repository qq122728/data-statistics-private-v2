"use client";

import React from "react";
import { Trophy, UsersThree } from "@phosphor-icons/react";
import type { ManagementOverview } from "../../../lib/analytics/overview";
import { buildHeadquartersPerformance } from "../../../lib/analytics/headquarters-performance";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import { formatUsdOr } from "../../../lib/money";

type EliteRow = { key: string; name: string; subtitle: string; orders: number; netPerformanceCents: number };
const money = (cents: number | null) => formatUsdOr(cents, "—");

function EliteCard({ row, rank, kind }: { row?: EliteRow; rank: 1 | 2 | 3; kind: "orders" | "performance" }) {
  const tones = { 1: "border-amber-300 bg-amber-50", 2: "border-slate-300 bg-slate-50", 3: "border-orange-200 bg-orange-50" } as const;
  const labels = { 1: "第一名", 2: "第二名", 3: "第三名" } as const;
  const value = row ? kind === "orders" ? `${row.orders} 单` : money(row.netPerformanceCents) : null;
  return <article className={`leaderboard-podium-card ${tones[rank]}`} data-rank={rank}>
    <div className="leaderboard-podium-rank"><Trophy size={rank === 1 ? 24 : 20} weight="fill" aria-hidden="true" /><span>{labels[rank]}</span></div>
    {row ? <><div className="leaderboard-identity-icon"><UsersThree size={22} aria-hidden="true" /></div><strong title={row.name}>{row.name}</strong><small>{row.subtitle}</small><b>{value}</b></> : null}
  </article>;
}

function EliteSection({ title, description, rows, kind }: { title: string; description: string; rows: EliteRow[]; kind: "orders" | "performance" }) {
  const podium = rows.slice(0, 3);
  const podiumOrder = [{ rank: 2 as const, row: podium[1] }, { rank: 1 as const, row: podium[0] }, { rank: 3 as const, row: podium[2] }].filter((item): item is { rank: 1 | 2 | 3; row: EliteRow } => Boolean(item.row));
  return <section className="panel leaderboard-podium-section" aria-label={title}>
    <div className="leaderboard-section-title"><div><h2><Trophy size={20} weight="fill" aria-hidden="true" />{title}</h2><p>{description}</p></div></div>
    <div className="leaderboard-podium-grid">{podiumOrder.map((item) => <EliteCard key={item.rank} rank={item.rank} row={item.row} kind={kind} />)}</div>
  </section>;
}

/** 面向全员的公开精英榜：按小组跨公司、跨国家统一排名，不带客户或个人明细。 */
export function HeadquartersPerformanceLeaderboard({ performanceRows, updatedAtLabel }: { performanceRows: NonNullable<ManagementOverview["groupComparison"]>; filters?: Partial<AnalysisFilters>; allowDrilldown?: boolean; updatedAtLabel?: string }) {
  const ranking = buildHeadquartersPerformance(performanceRows);
  const rows: EliteRow[] = ranking.groups.map((row) => ({ key: row.groupId, name: row.groupName, subtitle: [row.departmentName, row.countryCode || "未设国家"].join(" · "), orders: row.orders, netPerformanceCents: row.netPerformanceCents }));
  const byOrders = [...rows].sort((left, right) => right.orders - left.orders || left.name.localeCompare(right.name, "zh-CN"));
  const byPerformance = [...rows].sort((left, right) => right.netPerformanceCents - left.netPerformanceCents || right.orders - left.orders || left.name.localeCompare(right.name, "zh-CN"));
  return <div className="leaderboard-workspace space-y-3">
    <section className="leaderboard-summary" aria-label="精英榜概览"><div><span>参与国家</span><strong>{new Set(ranking.groups.map((row) => row.countryCode || "未设国家")).size}</strong><small>仅作归属标识，不参与排名</small></div><div><span>参与小组</span><strong>{ranking.groups.length}</strong><small>全部公司、国家统一排名</small></div><div><span>数据更新</span><strong className="leaderboard-update-time">{updatedAtLabel ?? "刚刚"}</strong><small>按各组业务日期汇总</small></div></section>
    <EliteSection title="小组单量榜 TOP 3" description="按小组已开单数量排名；所有公司、国家的小组参与同一榜单。" rows={byOrders} kind="orders" />
    <EliteSection title="小组业绩榜 TOP 3" description="按小组净业绩排名：入金－出金。" rows={byPerformance} kind="performance" />
  </div>;
}
