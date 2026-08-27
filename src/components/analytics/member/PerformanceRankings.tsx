"use client";

import { useMemo, useState } from "react";
import type { MemberOverviewRow } from "../../../lib/analytics/member-overview";
import type { ManagementRole } from "../../../lib/analytics/types";
import { isFormallyRanked } from "./MemberOverviewTable";
import { MemberInsightDrawer } from "./MemberInsightDrawer";
import type { MemberOverviewQuery } from "./MemberOverviewTabs";
import { formatUsdOr } from "../../../lib/money";

type RankingId = "profit" | "efficiency" | "trend";

const money = (cents: number | null) => formatUsdOr(cents, "待定价");
const percent = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const stageName = {
  TRAINING: "培训期",
  OBSERVATION: "观察期",
  FORMAL: "正式期",
  PAUSED: "暂停评价",
} as const;

const rankingOptions: Array<{ id: RankingId; label: string }> = [
  { id: "profit", label: "盈利贡献榜" },
  { id: "efficiency", label: "渠道校正效率榜" },
  { id: "trend", label: "稳定进步榜" },
];

function valueFor(row: MemberOverviewRow, ranking: RankingId): number | null {
  if (ranking === "profit") return row.financials.profitCents;
  if (ranking === "efficiency") return row.adjustedEfficiency;
  return row.trend;
}

function unrankedLabel(row: MemberOverviewRow, ranking: RankingId): string {
  if (!row.member.active) return "已停用·仅历史查看";
  if (row.adjustedState === "DATA_INVALID") return "数据待核实";
  if (row.totals.newFans === 0 && row.totals.effectiveFans === 0)
    return "无数据";
  if (row.stage !== "FORMAL") return `${stageName[row.stage]}·不正式排名`;
  if (row.pricingState === "PENDING_PRICE") return "待定价·暂停财务判断";
  if (row.adjustedState !== "READY") return "样本不足·不获得正式名次";
  if (ranking === "trend" && row.trend === null)
    return "无上周期可比数据·不获得稳定进步名次";
  return "不获得正式名次";
}

export function PerformanceRankings({
  rows,
  showGroup,
  role,
  query = {},
}: {
  rows: MemberOverviewRow[];
  showGroup: boolean;
  role: ManagementRole;
  query?: MemberOverviewQuery;
}) {
  const [selected, setSelected] = useState<MemberOverviewRow | null>(null);
  const [ranking, setRanking] = useState<RankingId>("profit");
  const displayed = useMemo(
    () =>
      [...rows].sort(
        (left, right) =>
          Number(isFormallyRanked(right) && valueFor(right, ranking) !== null) -
            Number(
              isFormallyRanked(left) && valueFor(left, ranking) !== null,
            ) ||
          (valueFor(right, ranking) ?? Number.NEGATIVE_INFINITY) -
            (valueFor(left, ranking) ?? Number.NEGATIVE_INFINITY) ||
          left.member.name.localeCompare(right.member.name, "zh-CN"),
      ),
    [ranking, rows],
  );
  let formalRank = 0;

  return (
    <section className="panel overflow-hidden" aria-label="业绩排行列表">
      <header className="panel-header member-overview-panel-header flex-wrap">
        <div>
          <h2 className="panel-title">业绩排行</h2>
          <p className="panel-subtitle">
            盈利贡献榜、渠道校正效率榜、稳定进步榜合并为一张表；连续改善天数在详情中查看。
          </p>
        </div>
        <label className="field-label member-overview-inline-field">
          排序指标
          <select
            aria-label="业绩排序指标"
            value={ranking}
            onChange={(event) => setRanking(event.target.value as RankingId)}
            className="control"
          >
            {rankingOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="data-table-wrap" data-testid="performance-desktop-table">
        <table className="data-table min-w-[1060px]">
          <thead>
            <tr>
              <th>名次</th>
              <th>组员</th>
              <th className="text-right">计入业绩</th>
              <th className="text-right">校正效率</th>
              <th className="text-right">较上周期</th>
              <th className="text-right">开单</th>
              <th className="text-right">入金</th>
              <th>评价状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((row) => {
              const ranked =
                isFormallyRanked(row) && valueFor(row, ranking) !== null;
              if (ranked) formalRank += 1;
              return (
                <tr key={row.member.id}>
                  <td className="font-semibold">
                    {ranked ? `#${formalRank}` : "—"}
                  </td>
                  <td>
                    <strong>{row.member.name}</strong>
                    {showGroup ? (
                      <span className="ml-2 text-xs text-slate-500">
                        {row.group.name}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right font-semibold text-emerald-700">
                    {money(row.financials.profitCents)}
                  </td>
                  <td className="text-right">
                    {percent(row.adjustedEfficiency)}
                  </td>
                  <td className="text-right">
                    {row.trend === null
                      ? "—"
                      : `${row.trend >= 0 ? "+" : ""}${percent(row.trend)}`}
                  </td>
                  <td className="text-right">{row.totals.orders}</td>
                  <td className="text-right">
                    {money(row.totals.rechargeCents)}
                  </td>
                  <td>
                    <span
                      className="analysis-status"
                      data-tone={ranked ? "success" : "warning"}
                    >
                      {ranked ? "可正式排名" : unrankedLabel(row, ranking)}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      aria-label={`查看详情：${row.member.name}`}
                      className="font-semibold text-blue-600"
                    >
                      查看详情
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <MemberInsightDrawer
        memberId={selected?.member.id ?? null}
        memberName={selected?.member.name ?? ""}
        role={role}
        query={{ ...query, tab: "performance" }}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
