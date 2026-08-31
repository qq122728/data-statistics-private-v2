"use client";

import { useState } from "react";
import { TODAY, type DownstreamLead, type Lead } from "@/lib/mock-data";
import {
  FUNNEL_CHIPS, computeFunnelRow, countCurrentlyInGroup, datesInRange, monthStart,
} from "@/lib/funnel";

function FunnelChip({ label, value, tone, big }: { label: string; value: string; tone?: "ok" | "bad"; big?: boolean }) {
  const color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--bad)" : "var(--ink)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: big ? 5 : 4, minWidth: 0 }}>
      <span style={{ fontSize: big ? 12.5 : 12, color: "var(--ink-3)", fontWeight: 500, whiteSpace: "nowrap" }}>{label}</span>
      <span className="tnum" style={{ fontSize: big ? 18 : 15, fontWeight: 700, color, lineHeight: 1.25 }}>{value}</span>
    </div>
  );
}

/** 每日明细 / 汇总行共用的网格列——固定最小列宽 + 1fr 拉伸，宽度不够就自动换行到下一行，绝不左右滚动 */
const FUNNEL_GRID_COLUMNS = {
  big: "repeat(auto-fill, minmax(112px, 1fr))",
  compact: "repeat(auto-fill, minmax(96px, 1fr))",
} as const;

/**
 * 客户漏斗数据——接粉/炒群/专家共用的同一张卡片，只是各自传进来的 activeLeads/downstreamLeads
 * 范围不同（接粉按自己名下号码筛，炒群按自己带的群筛，专家按自己接待的客户筛）。所有数据都是有
 * 利益关系的，所以三个岗位看到的口径必须一致——都是这同一份计算逻辑，不是各岗位各写一套。
 */
export function FunnelPanel({
  activeLeads, downstreamLeads, title = "客户漏斗数据", note,
}: {
  activeLeads: Lead[];
  downstreamLeads: DownstreamLead[];
  title?: string;
  note?: string;
}) {
  const [rangeStart, setRangeStart] = useState(monthStart(TODAY));
  const [rangeEnd, setRangeEnd] = useState(TODAY);
  const [showDaily, setShowDaily] = useState(false);

  const currentlyInGroup = countCurrentlyInGroup(downstreamLeads);
  const funnelSummary = computeFunnelRow(activeLeads, downstreamLeads, (d) => d >= rangeStart && d <= rangeEnd);
  const funnelDays = datesInRange(rangeStart, rangeEnd)
    .map((date) => ({ date, row: computeFunnelRow(activeLeads, downstreamLeads, (d) => d === date) }))
    .filter(({ row }) => Object.values(row).some((v) => v !== 0));

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="card-head">
        <div>
          <h2 className="card-title">
            {title}
            <span className="badge" data-tone="mute" style={{ marginLeft: 8, verticalAlign: 2 }}>仅供参考</span>
            <span className="badge" data-tone="ok" style={{ marginLeft: 8, verticalAlign: 2 }}>
              当前在群 {currentlyInGroup} 位
            </span>
          </h2>
          <p className="card-note">{note ?? "从添加到开单的完整漏斗，所有岗位对这份数据都有利益关系"}</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
          <input className="field" type="date" style={{ width: 148 }}
            value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
          <span style={{ color: "var(--ink-3)" }}>至</span>
          <input className="field" type="date" style={{ width: 148 }}
            value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
          <button className="btn" data-size="sm"
            onClick={() => { setRangeStart(monthStart(TODAY)); setRangeEnd(TODAY); }}>
            本月
          </button>
        </div>
      </div>

      <div style={{
        padding: "18px 20px", display: "grid", gridTemplateColumns: FUNNEL_GRID_COLUMNS.big,
        gap: "16px 20px", background: "var(--ok-soft)",
      }}>
        {FUNNEL_CHIPS.map((c) => (
          <FunnelChip key={c.key} label={c.label} value={c.render(funnelSummary)} tone={c.tone?.(funnelSummary)} big />
        ))}
      </div>

      <div style={{ padding: "10px 18px", borderTop: "1px solid var(--line)" }}>
        <button className="btn" data-size="sm" onClick={() => setShowDaily((v) => !v)}>
          {showDaily ? "收起每日明细" : `展开每日明细（${funnelDays.length} 天有数据）`}
        </button>
      </div>

      {showDaily ? (
        <div style={{ maxHeight: 420, overflowY: "auto", borderTop: "1px solid var(--line)" }}>
          {funnelDays.map(({ date, row }) => (
            <div key={date} style={{
              display: "flex", alignItems: "flex-start", gap: 16,
              padding: "16px 18px", borderBottom: "1px solid var(--line)",
            }}>
              <span className="tnum" style={{ fontSize: 13, fontWeight: 700, minWidth: 84, paddingTop: 3, color: "var(--ink-2)" }}>{date}</span>
              <div style={{
                flex: 1, minWidth: 0, display: "grid",
                gridTemplateColumns: FUNNEL_GRID_COLUMNS.compact, gap: "12px 16px",
              }}>
                {FUNNEL_CHIPS.map((c) => (
                  <FunnelChip key={c.key} label={c.label} value={c.render(row)} tone={c.tone?.(row)} />
                ))}
              </div>
            </div>
          ))}
          {!funnelDays.length ? (
            <div style={{ padding: "30px 0", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
              这个时间范围内没有数据
            </div>
          ) : null}
        </div>
      ) : null}

      <p style={{ margin: 0, padding: "10px 18px", fontSize: 12, color: "var(--ink-3)" }}>
        说明：有效数据 = 总下发粉数量 − 撞粉 − 低金额 − 无WS号码。
        当前在群是此刻的快照，不受上面时间范围筛选影响。入金/出金/净业绩只反映当天实际发生的资金流水，不含数据成本摊销。
      </p>
    </div>
  );
}
