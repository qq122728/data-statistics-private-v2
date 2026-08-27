"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MemberOverviewRow } from "../../../lib/analytics/member-overview";
import type { ManagementRole } from "../../../lib/analytics/types";
import { MemberInsightDrawer } from "./MemberInsightDrawer";
import {
  memberOverviewHref,
  type MemberOverviewQuery,
} from "./MemberOverviewTabs";
import { formatUsdOr } from "../../../lib/money";

export type MemberOverviewSort =
  "profit" | "orderRate" | "efficiency" | "trend";

const money = (cents: number | null) => formatUsdOr(cents, "—");
const percent = (value: number | null) =>
  value === null ? null : `${(value * 100).toFixed(1)}%`;
const roleName = { LEAD: "组长", RECEPTION: "成员" } as const;
const stageName = {
  TRAINING: "培训期",
  OBSERVATION: "观察期",
  FORMAL: "正式期",
  PAUSED: "暂停评价",
} as const;

export function isFormallyRanked(row: MemberOverviewRow): boolean {
  return (
    row.member.active &&
    row.stage === "FORMAL" &&
    row.pricingState === "PRICED" &&
    row.adjustedState === "READY"
  );
}

function numberFor(row: MemberOverviewRow, sort: MemberOverviewSort): number {
  if (!isFormallyRanked(row)) return Number.NEGATIVE_INFINITY;
  if (sort === "orderRate") return row.orderRate ?? Number.NEGATIVE_INFINITY;
  if (sort === "efficiency")
    return row.adjustedEfficiency ?? Number.NEGATIVE_INFINITY;
  if (sort === "trend") return row.trend ?? Number.NEGATIVE_INFINITY;
  return row.financials.profitCents ?? Number.NEGATIVE_INFINITY;
}

function sortedRows(
  rows: readonly MemberOverviewRow[],
  sort: MemberOverviewSort,
): MemberOverviewRow[] {
  return [...rows].sort(
    (left, right) =>
      Number(isFormallyRanked(right)) - Number(isFormallyRanked(left)) ||
      numberFor(right, sort) - numberFor(left, sort) ||
      left.member.name.localeCompare(right.member.name, "zh-CN"),
  );
}

function sampleLabel(row: MemberOverviewRow): string {
  if (!row.member.active) return "已停用·仅历史查看";
  if (row.stage !== "FORMAL") return `${stageName[row.stage]}·不正式排名`;
  if (row.adjustedState === "DATA_INVALID") return "数据待核实·不排名";
  if (row.pricingState === "PENDING_PRICE") return "待定价·暂停财务排名";
  if (row.adjustedState !== "READY") return "样本不足·不正式排名";
  return "可正式排名";
}

function recommendation(row: MemberOverviewRow): string {
  if (!row.member.active) return "仅查看历史";
  if (row.adjustedState === "DATA_INVALID") return "先核实数据";
  if (row.pricingState === "PENDING_PRICE") return "等待管理员定价";
  if (row.stage !== "FORMAL") return "按阶段辅导，不下结论";
  if (row.adjustedEfficiency !== null && row.adjustedEfficiency < 0.8)
    return "关注转化并安排辅导";
  if (row.trend !== null && row.trend > 0) return "表现改善，保持节奏";
  return "持续观察";
}

function NullableValue({ value }: { value: string | null }) {
  return value === null ? (
    <span title="缺少有效分母" aria-label="缺少有效分母">
      —
    </span>
  ) : (
    <>{value}</>
  );
}

export function MemberOverviewTable({
  rows,
  showGroup,
  sort,
  query,
  role,
}: {
  rows: MemberOverviewRow[];
  showGroup: boolean;
  sort: MemberOverviewSort;
  query: MemberOverviewQuery;
  role: ManagementRole;
}) {
  const [selected, setSelected] = useState<MemberOverviewRow | null>(null);
  const displayed = useMemo(() => sortedRows(rows, sort), [rows, sort]);
  const rankById = new Map(
    displayed
      .filter(isFormallyRanked)
      .map((row, index) => [row.member.id, index + 1]),
  );
  const sorts: Array<{ id: MemberOverviewSort; label: string }> = [
    { id: "profit", label: "计入业绩榜" },
    { id: "orderRate", label: "开单率" },
    { id: "efficiency", label: "渠道校正效率" },
    { id: "trend", label: "进步幅度" },
  ];
  if (!rows.length)
    return (
      <section className="panel empty-state">
        <h2 className="text-base font-semibold text-slate-700">
          当前筛选下无数据
        </h2>
        <p className="mt-2">可调整周期、小组、渠道或人员后重试。</p>
      </section>
    );

  return (
    <section className="panel overflow-hidden" aria-label="组员总览列表">
      <header className="panel-header member-overview-panel-header flex-wrap">
        <div>
          <h2 className="panel-title">组员计入业绩榜</h2>
          <p className="panel-subtitle">
            净业绩 = 入金 − 出金；计入业绩 = 净业绩 − 数据成本 − 渠道返点。
          </p>
        </div>
        <div aria-label="排序方式" className="flex flex-wrap gap-1">
          {sorts.map((item) => (
            <Link
              key={item.id}
              aria-current={sort === item.id ? "true" : undefined}
              href={memberOverviewHref(query, { sort: item.id })}
              className={`rounded-lg px-3 py-2 text-sm font-semibold no-underline ${sort === item.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </header>

      <div data-testid="member-desktop-table" className="hidden md:block">
        <table className="min-w-[1380px] w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <th className="p-3 text-left">计入业绩排名</th>
              <th className="p-3 text-left">组员 / 小组</th>
              <th className="p-3 text-right">有效数据</th>
              <th className="p-3 text-right">入群数</th>
              <th className="p-3 text-center">进群率</th>
              <th className="p-3 text-right">推专家</th>
              <th className="p-3 text-right">注册</th>
              <th className="p-3 text-right">开单</th>
              <th className="p-3 text-right">入金</th>
              <th className="p-3 text-right">数据成本</th>
              <th className="p-3 text-right">出金</th>
              <th className="p-3 text-right">计入业绩</th>
              <th className="p-3 text-left">操作</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((row) => (
              <tr
                key={row.member.id}
                className="border-b border-slate-100 align-top last:border-0"
              >
                <td className="p-3 font-semibold">
                  {rankById.get(row.member.id) ?? "—"}
                </td>
                <td className="p-3">
                  <strong className="block text-slate-900">
                    {row.member.name}
                  </strong>
                  <span className="mt-1 block text-xs text-slate-500">
                    {showGroup ? `${row.group.name}·` : ""}
                    {roleName[row.member.role]}
                  </span>
                  <span className="mt-1 block text-xs text-amber-700">
                    {sampleLabel(row)}
                  </span>
                </td>
                <td className="p-3 text-right font-semibold">
                  {row.totals.effectiveFans}
                </td>
                <td className="p-3 text-right">{row.totals.groupJoin}</td>
                <td className="p-3 text-center">
                  <NullableValue
                    value={percent(
                      row.totals.replies === 0
                        ? null
                        : row.totals.groupJoin / row.totals.replies,
                    )}
                  />
                </td>
                <td className="p-3 text-right">{row.totals.expertIntro}</td>
                <td className="p-3 text-right">{row.totals.registration}</td>
                <td className="p-3 text-right font-semibold">
                  {row.totals.orders}
                </td>
                <td className="p-3 text-right">
                  {money(row.totals.rechargeCents)}
                </td>
                <td className="p-3 text-right">
                  {money(row.financials.costCents)}
                </td>
                <td className="p-3 text-right">
                  {money(row.totals.withdrawalCents)}
                </td>
                <td
                  className={`p-3 text-right font-bold ${row.financials.profitCents !== null && row.financials.profitCents < 0 ? "text-red-700" : "text-emerald-700"}`}
                >
                  {money(row.financials.profitCents)}
                </td>
                <td className="p-3">
                  <button
                    type="button"
                    onClick={() => setSelected(row)}
                    aria-label={`查看详情：${row.member.name}`}
                    className="font-semibold text-blue-600 hover:text-blue-800"
                  >
                    查看详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 p-3 md:hidden">
        {displayed.map((row) => (
          <article
            key={row.member.id}
            data-testid="member-mobile-card"
            className="rounded-xl border border-slate-200 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <strong className="text-base text-slate-950">
                  {row.member.name}
                </strong>
                <p className="mt-1 text-xs text-slate-500">
                  {showGroup ? `${row.group.name}·` : ""}
                  {roleName[row.member.role]}·{stageName[row.stage]}
                </p>
              </div>
              <span
                className="analysis-status"
                data-tone={isFormallyRanked(row) ? "success" : "warning"}
              >
                {rankById.has(row.member.id)
                  ? `#${rankById.get(row.member.id)}`
                  : "不排名"}
              </span>
            </div>
            <p className="mt-2 text-xs text-amber-700">{sampleLabel(row)}</p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-slate-50 p-2">
                <dt className="text-xs text-slate-500">有效数据</dt>
                <dd className="mt-1 font-semibold">
                  {row.totals.effectiveFans} ·{" "}
                  <NullableValue value={percent(row.effectiveRate)} />
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <dt className="text-xs text-slate-500">开单</dt>
                <dd className="mt-1 font-semibold">
                  {row.totals.orders} ·{" "}
                  <NullableValue value={percent(row.orderRate)} />
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <dt className="text-xs text-slate-500">计入业绩</dt>
                <dd className="mt-1 font-semibold">
                  {money(row.financials.profitCents)}
                </dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-2">
                <dt className="text-xs text-slate-500">校正效率</dt>
                <dd className="mt-1 font-semibold">
                  <NullableValue value={percent(row.adjustedEfficiency)} />
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-slate-600">{recommendation(row)}</p>
            <button
              type="button"
              onClick={() => setSelected(row)}
              aria-label={`查看详情：${row.member.name}`}
              className="mt-3 w-full rounded-lg border border-blue-200 px-3 py-2 font-semibold text-blue-700"
            >
              查看详情
            </button>
          </article>
        ))}
      </div>
      <MemberInsightDrawer
        memberId={selected?.member.id ?? null}
        memberName={selected?.member.name ?? ""}
        role={role}
        query={query}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
