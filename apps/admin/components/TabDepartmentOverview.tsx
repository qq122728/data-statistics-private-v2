"use client";

import {
  DEPARTMENT_MONTHLY_SUMMARY, TODAY, money,
  type Department, type DepartmentMonthlySummary,
} from "@/lib/mock-data";

const MONTH_LABEL = TODAY.slice(0, 7);

/** 部门汇总——公司管理员横向比较本公司名下的部门（需求文档 5.5）。这是固定的整月快照，
 *  没有统计区间选择器：DEPARTMENT_MONTHLY_SUMMARY 是手写的固定月度数字（照抄"团队汇总"
 *  把德国二组/三组当固定数、不搭一个实时聚合器的简化），不是从组里现算出来的，加了区间
 *  选择器也不会真的跟着变。
 *  刻意不提供"跨部门求和"的公司总计行——不同部门的"今天"/统计周期边界本来就不是同一个
 *  真实时间点（部门各自绑自己的时区），5.5 明确要求周期性汇总也不能合并，不只是"今天"
 *  这一天。 */
type RowMetrics = DepartmentMonthlySummary;

const COLUMNS: { label: string; render: (m: RowMetrics) => React.ReactNode }[] = [
  { label: "添加数据", render: (m) => m.added },
  { label: "撞粉", render: (m) => m.collision },
  { label: "低金额", render: (m) => m.lowAmount },
  { label: "无WS号码", render: (m) => m.noWs },
  { label: "有效数据", render: (m) => <strong>{m.effective}</strong> },
  { label: "回复", render: (m) => m.replied },
  { label: "进群", render: (m) => m.joined },
  { label: "正常退群", render: (m) => m.leftNormal },
  { label: "异常退群", render: (m) => m.leftAbnormal },
  { label: "当前在群", render: (m) => m.inGroup },
  { label: "推专家", render: (m) => m.pushed },
  { label: "注册", render: (m) => m.registered },
  { label: "开单", render: (m) => m.ordered },
  { label: "回复率", render: (m) => <span style={{ color: "var(--ink-3)" }}>{m.repliedRate}</span> },
  { label: "拉群率", render: (m) => <span style={{ color: "var(--ink-3)" }}>{m.joinedRate}</span> },
  { label: "退群率", render: (m) => <span style={{ color: "var(--ink-3)" }}>{m.leftAbnormalRate}</span> },
  { label: "入金", render: (m) => money(m.depositUsd) },
  { label: "出金", render: (m) => money(m.withdrawalUsd) },
  {
    label: "净业绩",
    render: (m) => (
      <span className="tnum" style={{ fontWeight: 700, color: m.netUsd >= 0 ? "var(--ok)" : "var(--bad)" }}>
        {m.netUsd >= 0 ? "" : "-"}{money(Math.abs(m.netUsd))}
      </span>
    ),
  },
];

export function TabDepartmentOverview({ departments }: { departments: Department[] }) {
  const rows = departments.map((d) => ({
    dept: d,
    metrics: DEPARTMENT_MONTHLY_SUMMARY.find((s) => s.departmentId === d.id) ?? null,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">部门汇总</h2>
            <p className="card-note">
              {MONTH_LABEL} 整月固定汇总 · 本公司 {departments.length} 个部门并排对比 —— 不合并成一行"公司总计"：
              各部门绑的时区不同，"今天"/统计周期的真实起止时间点本来就不是同一个（需求文档 5.5，周期性汇总也不例外，不只是"今天"这一天），
              硬加总会得到一个没有实际含义的数字。
            </p>
          </div>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none" }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th style={{ width: 160, position: "sticky", left: 0, zIndex: 4 }}>部门</th>
                {COLUMNS.map((c) => <th key={c.label}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ dept, metrics }) => (
                <tr key={dept.id}>
                  <td
                    style={{
                      fontWeight: 700, whiteSpace: "nowrap",
                      position: "sticky", left: 0, zIndex: 2, background: "var(--surface)",
                    }}
                  >
                    {dept.name}
                    <span style={{ marginLeft: 6, fontWeight: 500, fontSize: 11.5, color: "var(--ink-3)" }}>
                      {dept.timezone}
                    </span>
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c.label} className="tnum" style={{ textAlign: "center" }}>
                      {metrics ? c.render(metrics) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ margin: "10px 16px 14px", fontSize: 12, color: "var(--ink-3)" }}>
          每行都是固定的整月快照，不随任何统计区间变化——{rows.map(({ dept }) => dept.name).join("、")}分别绑着自己的时区，
          彼此的统计周期不是同一个时间窗口，所以本页只并排比较，永远不额外算一行跨部门合计。
        </p>
      </div>
    </div>
  );
}
