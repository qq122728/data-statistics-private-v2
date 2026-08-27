"use client";

import { useMemo, useState } from "react";
import type { TeamDailyRow } from "../../../lib/analytics/team-performance";
import { formatUsd } from "../../../lib/money";

type Metric = "effective" | "replies" | "joined" | "registered" | "orders" | "net";

const metricLabels: Record<Metric, string> = {
  effective: "有效数据",
  replies: "回复",
  joined: "进群",
  registered: "注册",
  orders: "开单",
  net: "净业绩",
};

function metricValue(row: TeamDailyRow, metric: Metric) {
  if (metric === "effective") return row.totals.effectiveFans;
  if (metric === "replies") return row.totals.replies;
  if (metric === "joined") return row.totals.groupJoin;
  if (metric === "registered") return row.totals.registration;
  if (metric === "orders") return row.totals.orders;
  return row.totals.rechargeCents - row.totals.withdrawalCents;
}

function metricDisplay(value: number, metric: Metric) {
  return metric === "net" ? formatUsd(value) : String(value);
}

/**
 * A compact, dependency-free trend view. It deliberately aggregates the same
 * rows as the table below, so the chart can never use a different metric
 * definition from the daily details.
 */
export function GroupDailyTrend({ rows }: { rows: TeamDailyRow[] }) {
  const [metric, setMetric] = useState<Metric>("effective");
  const points = useMemo(() => {
    const daily = new Map<string, number>();
    for (const row of rows) daily.set(row.occurredOn, (daily.get(row.occurredOn) ?? 0) + metricValue(row, metric));
    return [...daily.entries()].map(([date, value]) => ({ date, value })).sort((left, right) => left.date.localeCompare(right.date));
  }, [metric, rows]);
  const maximum = Math.max(...points.map((point) => Math.abs(point.value)), 1);

  return <section className="panel group-daily-trend" aria-labelledby="group-daily-trend-title">
    <div className="panel-header group-daily-trend-header">
      <div>
        <h2 id="group-daily-trend-title" className="panel-title">每日趋势</h2>
        <p className="panel-subtitle">按实际发生日期汇总所选小组；与下方每日明细使用同一口径。</p>
      </div>
      <div className="group-daily-trend-metrics" role="group" aria-label="趋势指标">
        {(Object.keys(metricLabels) as Metric[]).map((item) => <button key={item} type="button" data-active={metric === item} onClick={() => setMetric(item)}>{metricLabels[item]}</button>)}
      </div>
    </div>
    {!points.length ? <p className="empty-state">当前日期范围没有每日数据</p> : <div className="group-daily-trend-chart" role="img" aria-label={`按天查看${metricLabels[metric]}趋势`}>
      {points.map((point) => {
        const height = Math.max(8, Math.round((Math.abs(point.value) / maximum) * 100));
        return <div key={point.date} className="group-daily-trend-point">
          <span className="group-daily-trend-value">{metricDisplay(point.value, metric)}</span>
          <div className="group-daily-trend-track"><span data-negative={point.value < 0} style={{ height: `${height}%` }} /></div>
          <span className="group-daily-trend-date">{point.date.slice(5)}</span>
        </div>;
      })}
    </div>}
  </section>;
}
