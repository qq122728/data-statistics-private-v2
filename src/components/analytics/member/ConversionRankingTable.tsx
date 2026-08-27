"use client";

import { useMemo, useState } from "react";
import type { MemberOverviewRow } from "../../../lib/analytics/member-overview";
import type { ManagementRole } from "../../../lib/analytics/types";
import type { RiskSettings } from "../../../lib/risk-settings";
import { MemberInsightDrawer } from "./MemberInsightDrawer";
import type { MemberOverviewQuery } from "./MemberOverviewTabs";

export type ConversionMetric =
  | "replyRate"
  | "groupRate"
  | "leaveRate"
  | "expertRate"
  | "registrationRate"
  | "orderRate"
  | "rechargePerFan"
  | "adjustedEfficiency";
type SampleState =
  | "READY"
  | "INSUFFICIENT"
  | "NO_DENOMINATOR"
  | "DATA_INVALID"
  | "IMMATURE"
  | "INACTIVE";

const metrics: Array<{
  id: ConversionMetric;
  label: string;
  lowerIsBetter?: boolean;
}> = [
  { id: "replyRate", label: "回复率" },
  { id: "groupRate", label: "进群率" },
  { id: "leaveRate", label: "异常退群率", lowerIsBetter: true },
  { id: "expertRate", label: "进群后推专家率" },
  { id: "registrationRate", label: "推专家后注册率" },
  { id: "orderRate", label: "开单率" },
  { id: "rechargePerFan", label: "每有效数据入金" },
  { id: "adjustedEfficiency", label: "渠道校正效率" },
];

function metricValue(
  row: MemberOverviewRow,
  metric: ConversionMetric,
): { value: number | null; numerator: number; denominator: number | null } {
  const totals = row.totals;
  if (metric === "replyRate")
    return {
      value: totals.effectiveFans === 0 ? null : totals.replies / totals.effectiveFans,
      numerator: totals.replies,
      denominator: totals.effectiveFans,
    };
  if (metric === "groupRate")
    return {
      value: totals.replies === 0 ? null : totals.groupJoin / totals.replies,
      numerator: totals.groupJoin,
      denominator: totals.replies,
    };
  if (metric === "leaveRate")
    return {
      value:
        totals.groupJoin === 0 ? null : (totals.abnormalGroupLeave ?? 0) / totals.groupJoin,
      numerator: totals.abnormalGroupLeave ?? 0,
      denominator: totals.groupJoin,
    };
  if (metric === "expertRate")
    return {
      value:
        totals.groupJoin === 0 ? null : totals.expertIntro / totals.groupJoin,
      numerator: totals.expertIntro,
      denominator: totals.groupJoin,
    };
  if (metric === "registrationRate")
    return {
      value:
        totals.expertIntro === 0
          ? null
          : totals.registration / totals.expertIntro,
      numerator: totals.registration,
      denominator: totals.expertIntro,
    };
  if (metric === "orderRate")
    return {
      value: totals.registration === 0 ? null : totals.orders / totals.registration,
      numerator: totals.orders,
      denominator: totals.registration,
    };
  if (metric === "rechargePerFan")
    return {
      value: row.rechargePerEffectiveFanCents,
      numerator: totals.rechargeCents,
      denominator: totals.effectiveFans,
    };
  return {
    value: row.adjustedEfficiency,
    numerator: totals.orders,
    denominator: null,
  };
}

function threshold(metric: ConversionMetric, rules: RiskSettings): number {
  if (metric === "replyRate") return rules.replyMinNewFans;
  if (metric === "groupRate") return rules.groupMinNewFans;
  if (metric === "leaveRate") return rules.leaveMinGroupJoin;
  if (metric === "expertRate") return rules.expertMinGroupJoin;
  if (metric === "registrationRate") return rules.registrationMinExpert;
  if (metric === "orderRate") return rules.orderMinNewFans;
  return metric === "rechargePerFan" ? 1 : rules.efficiencyMinEffectiveFans;
}

function sampleState(
  row: MemberOverviewRow,
  metric: ConversionMetric,
  rules: RiskSettings,
): SampleState {
  if (row.adjustedState === "DATA_INVALID") return "DATA_INVALID";
  if (!row.member.active) return "INACTIVE";
  if (row.stage !== "FORMAL") return "IMMATURE";
  if (metric === "adjustedEfficiency") {
    if (
      row.adjustedState === "INSUFFICIENT_SAMPLE" ||
      row.totals.effectiveFans < rules.efficiencyMinEffectiveFans
    )
      return "INSUFFICIENT";
    if (row.adjustedState !== "READY") return "INSUFFICIENT";
    return row.adjustedEfficiency === null ? "NO_DENOMINATOR" : "READY";
  }
  const { denominator } = metricValue(row, metric);
  if (!denominator) return "NO_DENOMINATOR";
  return denominator < threshold(metric, rules) ? "INSUFFICIENT" : "READY";
}

const stateLabel: Record<Exclude<SampleState, "IMMATURE">, string> = {
  READY: "可正式排名",
  INSUFFICIENT: "样本不足",
  NO_DENOMINATOR: "无数据·缺少分母",
  DATA_INVALID: "数据待核实",
  INACTIVE: "已停用·仅历史查看",
};

const stageName = {
  TRAINING: "培训期",
  OBSERVATION: "观察期",
  FORMAL: "正式期",
  PAUSED: "暂停评价",
} as const;
const sampleLabel = (row: MemberOverviewRow, state: SampleState) =>
  state === "IMMATURE"
    ? `${stageName[row.stage]}·不正式排名`
    : stateLabel[state];

function formatted(
  row: MemberOverviewRow,
  metric: ConversionMetric,
): React.ReactNode {
  const value = metricValue(row, metric).value;
  if (value === null)
    return (
      <span title="缺少有效分母" aria-label="缺少有效分母">
        —
      </span>
    );
  if (metric === "rechargePerFan") return `$${(value / 100).toFixed(2)}`;
  return `${(value * 100).toFixed(1)}%`;
}

export function ConversionRankingTable({
  rows,
  metric: initialMetric,
  showGroup,
  role,
  riskSettings,
  query = {},
}: {
  rows: MemberOverviewRow[];
  metric: ConversionMetric;
  showGroup: boolean;
  role: ManagementRole;
  riskSettings: RiskSettings;
  query?: MemberOverviewQuery;
}) {
  const [metric, setMetric] = useState<ConversionMetric>(initialMetric);
  const [selected, setSelected] = useState<MemberOverviewRow | null>(null);
  const definition = metrics.find((item) => item.id === metric)!;
  const displayed = useMemo(
    () =>
      [...rows].sort((left, right) => {
        const leftState = sampleState(left, metric, riskSettings);
        const rightState = sampleState(right, metric, riskSettings);
        const leftRanked = leftState === "READY";
        const rightRanked = rightState === "READY";
        const direction = definition.lowerIsBetter ? 1 : -1;
        return (
          Number(rightRanked) - Number(leftRanked) ||
          direction *
            ((metricValue(left, metric).value ?? Number.POSITIVE_INFINITY) -
              (metricValue(right, metric).value ?? Number.POSITIVE_INFINITY)) ||
          left.member.name.localeCompare(right.member.name, "zh-CN")
        );
      }),
    [definition.lowerIsBetter, metric, riskSettings, rows],
  );
  let formalRank = 0;

  return (
    <section className="panel overflow-hidden" aria-label="转化排行列表">
      <header className="panel-header member-overview-panel-header flex-wrap">
        <div>
          <h2 className="panel-title">{definition.label}排行</h2>
          <p className="panel-subtitle">
            一次只比一个指标；
            {definition.lowerIsBetter ? "异常退群率从低到高" : "从高到低"}
            。每项按自己的分母判断可信度。
          </p>
        </div>
        <label className="field-label member-overview-inline-field">
          转化指标
          <select
            aria-label="转化排行指标"
            value={metric}
            onChange={(event) =>
              setMetric(event.target.value as ConversionMetric)
            }
            className="control min-w-44"
          >
            {metrics.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <div className="hidden md:block" data-testid="conversion-desktop-table">
        <table className="w-full table-fixed border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <th className="w-[10%] p-3">名次</th>
              <th className="w-[26%] p-3">组员</th>
              <th className="w-[20%] p-3">{definition.label}</th>
              <th className="w-[24%] p-3">有效分母 / 可信状态</th>
              <th className="w-[20%] p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((row) => {
              const state = sampleState(row, metric, riskSettings);
              const ranked = state === "READY";
              if (ranked) formalRank += 1;
              const denominator = metricValue(row, metric).denominator;
              return (
                <tr
                  key={row.member.id}
                  className="border-b border-slate-100 last:border-0"
                >
                  <td className="p-3 font-bold">
                    {ranked ? `#${formalRank}` : "—"}
                  </td>
                  <td className="p-3">
                    <strong>{row.member.name}</strong>
                    {showGroup ? (
                      <span className="ml-2 text-xs text-slate-500">
                        {row.group.name}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`p-3 text-base font-bold ${ranked ? "text-emerald-700" : "text-slate-500"}`}
                  >
                    {formatted(row, metric)}
                  </td>
                  <td className="p-3">
                    <span className="block text-xs text-slate-500">
                      {denominator === null
                        ? `有效数据 ${row.totals.effectiveFans}`
                        : `分母 ${denominator}`}
                    </span>
                    <span
                      className="analysis-status mt-1"
                      data-tone={state === "READY" ? "success" : "warning"}
                    >
                      {sampleLabel(row, state)}
                    </span>
                  </td>
                  <td className="p-3">
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
      <div className="grid gap-3 p-3 md:hidden">
        {displayed.map((row) => {
          const state = sampleState(row, metric, riskSettings);
          return (
            <article
              key={row.member.id}
              className="rounded-xl border border-slate-200 p-4"
            >
              <div className="flex justify-between gap-3">
                <div>
                  <strong>{row.member.name}</strong>
                  {showGroup ? (
                    <p className="mt-1 text-xs text-slate-500">
                      {row.group.name}
                    </p>
                  ) : null}
                </div>
                <strong
                  className={
                    state === "READY"
                      ? "text-lg text-emerald-700"
                      : "text-lg text-slate-500"
                  }
                >
                  {formatted(row, metric)}
                </strong>
              </div>
              <span
                className="analysis-status mt-3"
                data-tone={state === "READY" ? "success" : "warning"}
              >
                {sampleLabel(row, state)}
              </span>
              <button
                type="button"
                onClick={() => setSelected(row)}
                aria-label={`查看详情：${row.member.name}`}
                className="mt-3 block w-full rounded-lg border border-blue-200 px-3 py-2 font-semibold text-blue-700"
              >
                查看详情
              </button>
            </article>
          );
        })}
      </div>
      <MemberInsightDrawer
        memberId={selected?.member.id ?? null}
        memberName={selected?.member.name ?? ""}
        role={role}
        query={{ ...query, tab: "conversion" }}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
