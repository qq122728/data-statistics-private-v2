"use client";

import { useState } from "react";
import { FUNNEL_CHIPS, type FunnelRow } from "@/lib/funnel";

function FunnelChip({ label, value, tone, big }: { label: string; value: string; tone?: "ok" | "bad"; big?: boolean }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "var(--ink)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: big ? 5 : 4, minWidth: 0 }}>
      <span style={{ fontSize: big ? 12.5 : 12, color: "var(--ink-3)", fontWeight: 500, whiteSpace: "nowrap" }}>{label}</span>
      <span className="tnum" style={{ fontSize: big ? 18 : 15, fontWeight: 700, color, lineHeight: 1.25 }}>{value}</span>
    </div>
  );
}

const FUNNEL_GRID_COLUMNS = {
  big: "repeat(auto-fill, minmax(112px, 1fr))",
  compact: "repeat(auto-fill, minmax(96px, 1fr))",
} as const;

export function RealPerformanceFunnel({
  summary, daily, currentInGroup, rangeStart, rangeEnd, monthStart, monthEnd, loading, onRangeChange,
}: {
  summary: FunnelRow;
  daily: Array<{ date: string; row: FunnelRow }>;
  currentInGroup: number;
  rangeStart: string;
  rangeEnd: string;
  monthStart: string;
  monthEnd: string;
  loading: boolean;
  onRangeChange: (from: string, to: string) => void;
}) {
  const [showDaily, setShowDaily] = useState(false);
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div>
          <h2 className="card-title">
            客户漏斗数据
            <span className="badge" data-tone="mute" style={{ marginLeft: 8, verticalAlign: 2 }}>仅供参考</span>
            <span className="badge" data-tone="ok" style={{ marginLeft: 8, verticalAlign: 2 }}>当前在群 {currentInGroup} 位</span>
          </h2>
          <p className="card-note">从添加到开单的完整漏斗——下游人员填写的后续成果会显示在本人和对应配对业务线中，但不会重复增加岗位排名。</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
          <input aria-label="开始日期" className="field" type="date" style={{ width: 148 }} value={rangeStart}
            onChange={(event) => onRangeChange(event.target.value, rangeEnd)} />
          <span style={{ color: "var(--ink-3)" }}>至</span>
          <input aria-label="结束日期" className="field" type="date" style={{ width: 148 }} value={rangeEnd}
            onChange={(event) => onRangeChange(rangeStart, event.target.value)} />
          <button className="btn" data-size="sm" onClick={() => onRangeChange(monthStart, monthEnd)}>本月</button>
        </div>
      </div>

      <div style={{
        padding: "18px 20px", display: "grid", gridTemplateColumns: FUNNEL_GRID_COLUMNS.big,
        gap: "16px 20px", background: "var(--ok-soft)", opacity: loading ? 0.6 : 1,
      }}>
        {FUNNEL_CHIPS.map((chip) => (
          <FunnelChip key={chip.key} label={chip.label} value={chip.render(summary)} tone={chip.tone?.(summary)} big />
        ))}
      </div>

      <div style={{ padding: "10px 18px", borderTop: "1px solid var(--line)" }}>
        <button className="btn" data-size="sm" onClick={() => setShowDaily((value) => !value)}>
          {showDaily ? "收起每日明细" : `展开每日明细（${daily.length} 天有数据）`}
        </button>
      </div>

      {showDaily ? (
        <div style={{ maxHeight: 420, overflowY: "auto", borderTop: "1px solid var(--line)" }}>
          {daily.map(({ date, row }) => (
            <div key={date} style={{ display: "flex", alignItems: "flex-start", gap: 16, padding: "16px 18px", borderBottom: "1px solid var(--line)" }}>
              <span className="tnum" style={{ fontSize: 13, fontWeight: 700, minWidth: 84, paddingTop: 3, color: "var(--ink-2)" }}>{date}</span>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateColumns: FUNNEL_GRID_COLUMNS.compact, gap: "12px 16px" }}>
                {FUNNEL_CHIPS.map((chip) => (
                  <FunnelChip key={chip.key} label={chip.label} value={chip.render(row)} tone={chip.tone?.(row)} />
                ))}
              </div>
            </div>
          ))}
          {!daily.length ? <div style={{ padding: "30px 0", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>这个时间范围内没有数据</div> : null}
        </div>
      ) : null}

      <p style={{ margin: 0, padding: "10px 18px", fontSize: 12, color: "var(--ink-3)" }}>
        说明：有效数据 = 总下发粉数量 − 撞粉 − 低金额 − 无WS号码。当前在群按每条来源业务线取截止日期最近一次正式快照，不跨天相加。入金包含首充和续充。
      </p>
    </div>
  );
}
