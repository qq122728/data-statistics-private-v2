"use client";

import { useState } from "react";
import type { MemberOverviewRow } from "../../../lib/analytics/member-overview";
import type { ManagementRole } from "../../../lib/analytics/types";
import type { RiskSettings } from "../../../lib/risk-settings";
import { MemberInsightDrawer } from "./MemberInsightDrawer";
import type { MemberOverviewQuery } from "./MemberOverviewTabs";

const stageName = {
  TRAINING: "培训期",
  OBSERVATION: "观察期",
  FORMAL: "正式期",
  PAUSED: "暂停评价",
} as const;
type RiskCategory = "performance" | "financial" | "data";

function sampleState(row: MemberOverviewRow): {
  label: string;
  tone: "warning" | "danger" | "success" | undefined;
} {
  if (row.adjustedState === "DATA_INVALID")
    return { label: "数据待核实", tone: "warning" };
  if (row.totals.newFans === 0 && row.totals.effectiveFans === 0)
    return { label: "无数据", tone: undefined };
  if (row.stage !== "FORMAL")
    return { label: `${stageName[row.stage]}·未进入正式评价`, tone: "warning" };
  if (row.adjustedState !== "READY")
    return { label: "样本不足", tone: "warning" };
  return { label: "样本可评价", tone: "success" };
}

function evidence(row: MemberOverviewRow, category: RiskCategory): string {
  if (category === "performance")
    return `渠道校正效率 ${row.adjustedEfficiency === null ? "—" : `${(row.adjustedEfficiency * 100).toFixed(1)}%`}，较上周期 ${row.trend === null ? "暂无可比数据" : `${row.trend >= 0 ? "+" : ""}${(row.trend * 100).toFixed(1)}%`}。`;
  if (category === "financial")
    return `成熟周期净业绩 $${(row.netPerformanceCents / 100).toFixed(2)}，入金 $${(row.totals.rechargeCents / 100).toFixed(2)}。`;
  if (row.adjustedState === "DATA_INVALID")
    return "上下游数量或有效数据拆分存在逻辑异常，必须先核实数据。";
  return "当前成熟周期没有可用的录入数据。";
}

function RiskSection({
  category,
  title,
  description,
  rows,
  role,
  onOpen,
}: {
  category: RiskCategory;
  title: string;
  description: string;
  rows: MemberOverviewRow[];
  role: ManagementRole;
  onOpen: (row: MemberOverviewRow) => void;
}) {
  const tone = category === "performance" ? "danger" : "warning";
  return (
    <section
      role="region"
      aria-label={title}
      className="member-overview-risk-section"
    >
      <header className="member-overview-risk-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className="analysis-status" data-tone={tone}>
          {rows.length} 人
        </span>
      </header>
      {rows.length ? (
        <div className="data-table-wrap">
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>组员</th>
                <th>当前状态</th>
                <th>触发证据</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = sampleState(row);
                return (
                  <tr key={row.member.id} data-testid="risk-alert">
                    <td>
                      <strong>{row.member.name}</strong>
                      <span className="ml-2 text-xs text-slate-500">
                        {row.group.name} · {stageName[row.stage]} · 有效粉{" "}
                        {row.totals.effectiveFans}
                      </span>
                    </td>
                    <td>
                      <span className="analysis-status" data-tone={state.tone}>
                        {state.label}
                      </span>
                    </td>
                    <td className="text-slate-600">
                      {evidence(row, category)}
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => onOpen(row)}
                          aria-label={`查看证据：${row.member.name}`}
                          className="font-semibold text-blue-700"
                        >
                          查看证据
                        </button>
                        {role === "LEAD" && category === "performance" ? (
                          <button
                            type="button"
                            onClick={() => onOpen(row)}
                            className="font-semibold text-slate-700"
                          >
                            安排辅导
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="member-overview-risk-empty">
          {category === "performance"
            ? "没有表现风险"
            : category === "financial"
              ? "没有财务风险"
              : "没有数据风险"}
        </p>
      )}
      {role === "ADMIN" && category === "performance" ? (
        <p className="member-overview-risk-note">
          人工确认在证据详情中操作；确认只记录管理决定，不会自动停用账号。
        </p>
      ) : null}
    </section>
  );
}

export function RiskAlerts({
  rows,
  role,
  riskSettings,
  query = {},
}: {
  rows: MemberOverviewRow[];
  role: ManagementRole;
  riskSettings: RiskSettings;
  query?: MemberOverviewQuery;
}) {
  const [selected, setSelected] = useState<MemberOverviewRow | null>(null);
  const performance = rows.filter(
    (row) =>
      row.member.active &&
      row.stage === "FORMAL" &&
      row.adjustedState === "READY" &&
      row.adjustedEfficiency !== null &&
      row.adjustedEfficiency < riskSettings.coachingEfficiency,
  );
  const financial = rows.filter(
    (row) => row.member.active && row.netPerformanceCents < 0,
  );
  const data = rows.filter(
    (row) =>
      row.member.active &&
      (row.adjustedState === "DATA_INVALID" ||
        (row.totals.newFans === 0 && row.totals.effectiveFans === 0)),
  );
  return (
    <section className="panel overflow-hidden" aria-label="风险预警列表">
      <header className="panel-header member-overview-panel-header">
        <div>
          <h2 className="panel-title">风险预警</h2>
          <p className="panel-subtitle">
            按风险类型分段显示，先处理数据问题，再看表现和财务。
          </p>
        </div>
      </header>
      <RiskSection
        category="performance"
        title="表现风险"
        description="连续偏低、辅导、限流观察和淘汰观察。"
        rows={performance}
        role={role}
        onOpen={setSelected}
      />
      <RiskSection
        category="financial"
        title="财务风险"
        description="净业绩为负或出金异常。"
        rows={financial}
        role={role}
        onOpen={setSelected}
      />
      <RiskSection
        category="data"
        title="数据风险"
        description="只标记数据待核实，不得当成销售能力差。"
        rows={data}
        role={role}
        onOpen={setSelected}
      />
      <MemberInsightDrawer
        memberId={selected?.member.id ?? null}
        memberName={selected?.member.name ?? ""}
        role={role}
        query={{ ...query, tab: "risk" }}
        onClose={() => setSelected(null)}
      />
    </section>
  );
}
