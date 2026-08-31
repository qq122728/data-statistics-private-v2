"use client";

import { useState } from "react";
import {
  TODAY, computeOrderedSummaryColumns, money,
  type GroupMonthlySummary, type Member, type TeamGroup,
} from "@/lib/mock-data";

const MONTH_START = `${TODAY.slice(0, 7)}-01`;

/** 团队汇总跟渠道数据核对/数据汇总用的是同一套 18 个指标，只是这里"组"是行、指标是列
 *  （SummaryTable 反过来，指标是行、人是列）——3 个组放一张表方便横向比较，不需要
 *  照抄 SummaryTable 那种"指标行×人列"的宽表结构，另起一个组件更直接。 */
/** 跟 SummaryColumn 保持一样的"可能不适用就是 null"的类型形状（去掉 memberId/name/
 *  role/unitKey/registeredRate/orderedRate），这样德国一组的实时"总计"列（SummaryColumn）
 *  和德国二组/三组的固定演示数据（GroupMonthlySummary，字段全是实打实的数字）都能直接
 *  塞进来，不用另外转换。总计列这几个字段实际永远不会是 null，但类型上要跟 naCell
 *  的判断口径保持一致，照抄 SummaryTable 的 naCell 写法。 */
type RowMetrics = {
  added: number | null; collision: number | null; lowAmount: number | null; noWs: number | null; effective: number | null;
  replied: number | null; repliedRate: string;
  joined: number | null; joinedRate: string;
  leftNormal: number | null; leftAbnormal: number | null; leftAbnormalRate: string; inGroup: number | null;
  pushed: number; registered: number; ordered: number;
  depositUsd: number | null; withdrawalUsd: number | null; netUsd: number | null;
};

function naCell(value: number | null, render: (v: number) => React.ReactNode): React.ReactNode {
  return value === null ? "—" : render(value);
}

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
  { label: "推专家", render: (m) => m.pushed },
  { label: "注册", render: (m) => m.registered },
  { label: "开单", render: (m) => m.ordered },
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

/** 团队汇总——部门管理员横向比较本部门 3 个小组。德国一组有真实底层数据，跟着上面
 *  的统计区间选择器实时算；德国二组/三组是固定的演示月度数字，不随区间变化（用 *
 *  号标出来，避免误导成"也是按区间实时算的"）。全表只读，没有任何编辑入口——部门
 *  管理员对客户数据本身没有操作权，这里纯粹是看数。 */
export function TabTeamOverview({
  members, teamGroups, groupMonthlySummary,
}: {
  members: Member[];
  teamGroups: TeamGroup[];
  groupMonthlySummary: GroupMonthlySummary[];
}) {
  const [from, setFrom] = useState(MONTH_START);
  const [to, setTo] = useState(TODAY);

  const liveTotal = computeOrderedSummaryColumns(from, to, members)[0]; // "总计"列，只有德国一组有这份真实数据

  /** 没有 hasDetailData 又找不到固定演示数据的组（刚新建、还没数据）—— 全部显示 0，
   *  不能借用德国一组的实时总计，否则一个空组会看起来有业绩。 */
  const emptyMetrics: RowMetrics = {
    added: 0, collision: 0, lowAmount: 0, noWs: 0, effective: 0,
    replied: 0, repliedRate: "—", joined: 0, joinedRate: "—",
    leftNormal: 0, leftAbnormal: 0, leftAbnormalRate: "—", inGroup: 0,
    pushed: 0, registered: 0, ordered: 0,
    depositUsd: 0, withdrawalUsd: 0, netUsd: 0,
  };

  const rows: { groupId: string; name: string; metrics: RowMetrics; fixed: boolean }[] = teamGroups.map((g) => {
    if (g.hasDetailData) {
      return { groupId: g.id, name: g.name, metrics: liveTotal, fixed: false };
    }
    const fixed = groupMonthlySummary.find((s) => s.groupId === g.id);
    return { groupId: g.id, name: g.name, metrics: fixed ?? emptyMetrics, fixed: true };
  });

  const detailGroupName = teamGroups.find((g) => g.hasDetailData)?.name ?? "";
  const fixedCount = rows.filter((r) => r.fixed).length;
  /** 部门明细里公司管理员可能选到一个全是演示数据、没有任何一组有实时逐人数据的部门
   *  （比如美国部），这时候不能沿用"XX组随统计区间实时变化"这句——句子里的主语会
   *  是空字符串，读起来断头。按有没有实时组两套文案。 */
  const rangeNote = detailGroupName
    ? `${from} 至 ${to} · ${detailGroupName}随统计区间实时变化；其余${fixedCount}组是本地演示数据，固定为本月（表格里带 * 号的行）`
    : `本页${rows.length}个小组都是本地演示数据，固定为本月，不随上方统计区间变化（表格里带 * 号的行）`;
  const footNote = detailGroupName
    ? `* 演示数据，固定为本月，不随上方统计区间变化——本地演示数据范围限制，只有${detailGroupName}保留完整的逐人流水数据。`
    : `* 演示数据，固定为本月，不随上方统计区间变化——本地演示数据范围限制，这几个小组都还没有完整的逐人流水数据。`;

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
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">团队汇总</h2>
            <p className="card-note">{rangeNote}</p>
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
                    {row.fixed ? <sup title="演示数据，固定为本月，不随统计区间变化" style={{ marginLeft: 2, color: "var(--ink-3)" }}>*</sup> : null}
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
        <p style={{ margin: "10px 16px 14px", fontSize: 12, color: "var(--ink-3)" }}>{footNote}</p>
      </div>
    </div>
  );
}
