"use client";

import { useState } from "react";
import {
  TODAY, computeOrderedSummaryColumns, money,
  type ChannelName, type GroupMonthlySummary, type Member, type TeamGroup,
} from "@/lib/mock-data";

const MONTH_START = `${TODAY.slice(0, 7)}-01`;

/** 渠道数据汇总——资源部（投流/短信两个各自只绑一个渠道的账号）横向比较全公司 3 个
 *  小组在自己这个渠道上的表现，形状照抄部门管理员"团队汇总"（组是行、指标是列），只是
 *  多了按 channel 筛这一道。
 *
 *  德国一组（hasDetailData）有真实的逐人流水数据，可以按渠道拆分、跟着上面的统计区间
 *  实时算。德国二组/三组的 GROUP_MONTHLY_SUMMARY 是"两个渠道混在一起"的固定月度数字，
 *  压根没留渠道这个维度，编不出"这个渠道单独是多少"——所以这两组整行显示"—"，配一条
 *  专门的说明（† 号，措辞跟组内明细那句"该组暂无逐人明细数据"刻意不一样）：这不是
 *  "完全没有数据"，是"有数据但颗粒度不够细，编不出一个跟真实情况对得上的分渠道数字"，
 *  两种缺口性质不同，不能用同一句话糊弄过去。 */
type RowMetrics = {
  added: number | null; collision: number | null; lowAmount: number | null; noWs: number | null; effective: number | null;
  replied: number | null; repliedRate: string;
  joined: number | null; joinedRate: string;
  leftNormal: number | null; leftAbnormal: number | null; leftAbnormalRate: string; inGroup: number | null;
  pushed: number | null; registered: number | null; ordered: number | null;
  depositUsd: number | null; withdrawalUsd: number | null; netUsd: number | null;
};

function naCell(value: number | null, render: (v: number) => React.ReactNode): React.ReactNode {
  return value === null ? "—" : render(value);
}

/** 该组没有按渠道拆分的数字——不是"没有数据"，是"有数据但拆不出这个渠道"，全部显示"—"。 */
const NA_ROW: RowMetrics = {
  added: null, collision: null, lowAmount: null, noWs: null, effective: null,
  replied: null, repliedRate: "—", joined: null, joinedRate: "—",
  leftNormal: null, leftAbnormal: null, leftAbnormalRate: "—", inGroup: null,
  pushed: null, registered: null, ordered: null,
  depositUsd: null, withdrawalUsd: null, netUsd: null,
};

/** 连"两个渠道混在一起"的固定演示数字都没有的组（刚新建、还没配数据）——真的是0，
 *  跟上面 NA_ROW 那种"有数据只是拆不出渠道"的情况不一样，不能混着用同一种占位。 */
const ZERO_ROW: RowMetrics = {
  added: 0, collision: 0, lowAmount: 0, noWs: 0, effective: 0,
  replied: 0, repliedRate: "—", joined: 0, joinedRate: "—",
  leftNormal: 0, leftAbnormal: 0, leftAbnormalRate: "—", inGroup: 0,
  pushed: 0, registered: 0, ordered: 0,
  depositUsd: 0, withdrawalUsd: 0, netUsd: 0,
};

const COLUMNS: { label: string; render: (m: RowMetrics) => React.ReactNode }[] = [
  { label: "添加数据", render: (m) => naCell(m.added, (v) => v) },
  { label: "撞粉", render: (m) => naCell(m.collision, (v) => v) },
  { label: "低金额", render: (m) => naCell(m.lowAmount, (v) => v) },
  { label: "无WS号码", render: (m) => naCell(m.noWs, (v) => v) },
  { label: "有效数据", render: (m) => naCell(m.effective, (v) => <strong>{v}</strong>) },
  { label: "回复", render: (m) => naCell(m.replied, (v) => v) },
  { label: "进群", render: (m) => naCell(m.joined, (v) => v) },
  { label: "正常退群", render: (m) => naCell(m.leftNormal, (v) => v) },
  { label: "异常退群", render: (m) => naCell(m.leftAbnormal, (v) => v) },
  { label: "当前在群", render: (m) => naCell(m.inGroup, (v) => v) },
  { label: "推专家", render: (m) => naCell(m.pushed, (v) => v) },
  { label: "注册", render: (m) => naCell(m.registered, (v) => v) },
  { label: "开单", render: (m) => naCell(m.ordered, (v) => v) },
  { label: "回复率", render: (m) => <span style={{ color: "var(--ink-3)" }}>{m.repliedRate}</span> },
  { label: "拉群率", render: (m) => <span style={{ color: "var(--ink-3)" }}>{m.joinedRate}</span> },
  { label: "退群率", render: (m) => <span style={{ color: "var(--ink-3)" }}>{m.leftAbnormalRate}</span> },
  { label: "入金", render: (m) => naCell(m.depositUsd, (v) => money(v)) },
  { label: "出金", render: (m) => naCell(m.withdrawalUsd, (v) => money(v)) },
  {
    label: "净业绩",
    render: (m) => naCell(m.netUsd, (v) => (
      <span className="tnum" style={{ fontWeight: 700, color: v >= 0 ? "var(--ok)" : "var(--bad)" }}>
        {v >= 0 ? "" : "-"}{money(Math.abs(v))}
      </span>
    )),
  },
];

export function TabResourceSummary({
  members, teamGroups, groupMonthlySummary, channel,
}: {
  members: Member[];
  teamGroups: TeamGroup[];
  groupMonthlySummary: GroupMonthlySummary[];
  channel: ChannelName;
}) {
  const [from, setFrom] = useState(MONTH_START);
  const [to, setTo] = useState(TODAY);

  const liveTotal = computeOrderedSummaryColumns(from, to, members, channel)[0]; // "总计"列，只有德国一组有这份按渠道拆开的真实数据

  const rows: { groupId: string; name: string; metrics: RowMetrics; noSplit: boolean }[] = teamGroups.map((g) => {
    if (g.hasDetailData) {
      return { groupId: g.id, name: g.name, metrics: liveTotal, noSplit: false };
    }
    const hasBlendedData = groupMonthlySummary.some((s) => s.groupId === g.id);
    return { groupId: g.id, name: g.name, metrics: hasBlendedData ? NA_ROW : ZERO_ROW, noSplit: hasBlendedData };
  });

  const detailGroupName = teamGroups.find((g) => g.hasDetailData)?.name ?? "";
  const hasNoSplitRow = rows.some((r) => r.noSplit);

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
        <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>只读 · 资源部口径</span>
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">{channel} · 全公司渠道汇总</h2>
            <p className="card-note">
              {from} 至 {to} · {detailGroupName}随统计区间实时变化；其余小组的演示数据没有留渠道这个维度，显示为"—"（见下方说明）
            </p>
          </div>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none" }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th style={{ width: 100, position: "sticky", left: 0, zIndex: 4 }}>小组</th>
                {COLUMNS.map((c) => <th key={c.label}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.groupId}>
                  <td
                    style={{
                      fontWeight: 700, whiteSpace: "nowrap",
                      position: "sticky", left: 0, zIndex: 2, background: "var(--surface)",
                    }}
                  >
                    {row.name}
                    {row.noSplit ? (
                      <sup title="该组的演示数据没有按渠道拆分，暂时无法在这里显示" style={{ marginLeft: 2, color: "var(--ink-3)" }}>†</sup>
                    ) : null}
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c.label} className="tnum" style={{ textAlign: "center" }}>
                      {c.render(row.metrics)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasNoSplitRow ? (
          <p style={{ margin: "10px 16px 14px", fontSize: 12, color: "var(--ink-3)" }}>
            † 该组的演示数据没有按渠道拆分，暂时无法在这里显示——不是"没有数据"，是本地演示数据的颗粒度不够细，编不出一个跟真实情况对得上的分渠道数字。
          </p>
        ) : null}
      </div>
    </div>
  );
}
