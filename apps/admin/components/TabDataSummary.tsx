"use client";

import { useState } from "react";
import { SummaryTable } from "./SummaryTable";
import {
  TODAY, computeOrderedSummaryColumns, summaryDatesDesc,
  type Member,
} from "@/lib/mock-data";

const MONTH_START = `${TODAY.slice(0, 7)}-01`;

/** 数据汇总——指标做行、人做列，对应组长手头原来那张Excel台账，不是重新设计的表格。
 *  上面"当月汇总"是选定区间的累计数，区间选择器同时决定下面按天铺开的每日细表要
 *  显示哪几天（取区间内实际有数据的日期，最新的在最上面）。全表只读，没有任何编辑
 *  入口——这是给组长看数用的统计视图，不是操作台，跟"客户跟进"那种可操作的表不是
 *  一回事。 */
export function TabDataSummary({ members }: { members: Member[] }) {
  const [from, setFrom] = useState(MONTH_START);
  const [to, setTo] = useState(TODAY);

  const monthColumns = computeOrderedSummaryColumns(from, to, members);
  const daysInRange = summaryDatesDesc().filter((d) => d >= from && d <= to);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>统计区间</span>
        <input className="field" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--ink-3)" }}>至</span>
        <input className="field" type="date" value={to} min={from} max={TODAY} onChange={(e) => setTo(e.target.value)} />
        <button className="btn" data-size="sm" onClick={() => { setFrom(MONTH_START); setTo(TODAY); }}>
          本月
        </button>
        <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · 汇总口径</span>
      </div>

      <SummaryTable
        title="当月汇总"
        note={`${from} 至 ${to} 累计 · 总计列的比率按总计的分子分母重新算，不是把每个人的比率取平均`}
        columns={monthColumns}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {daysInRange.map((date) => (
          <SummaryTable key={date} title={date} columns={computeOrderedSummaryColumns(date, date, members)} />
        ))}
        {!daysInRange.length ? (
          <div className="card" style={{ padding: "44px 0", textAlign: "center", color: "var(--ink-3)" }}>
            所选区间内没有按天数据
          </div>
        ) : null}
      </div>
    </div>
  );
}
