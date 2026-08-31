"use client";

import {
  COMPANY_MONTHLY_SUMMARY, TODAY, money,
  type Company, type CompanyMonthlySummary,
} from "@/lib/mock-data";

const MONTH_LABEL = TODAY.slice(0, 7);

/** 公司汇总——总公司管理员横向比较全总公司的公司（需求文档 5.2、5.5）。跟"部门汇总"
 *  （TabDepartmentOverview）一模一样的形状，只是再往上一级：固定的整月快照，没有统计
 *  区间选择器——COMPANY_MONTHLY_SUMMARY 是手写的固定月度数字，不是从部门里现算出来的。
 *  刻意不提供"跨公司求和"的总公司总计行——不同公司名下部门绑的时区更不可能是同一个
 *  真实时间点，5.5 明确要求周期性汇总也不能合并，不只是"今天"这一天；这跟部门汇总
 *  不合并成公司总计是同一条规则，只是往上延伸了一级。 */
type RowMetrics = CompanyMonthlySummary;

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

export function TabCompanyOverview({ companies }: { companies: Company[] }) {
  const rows = companies.map((c) => ({
    company: c,
    metrics: COMPANY_MONTHLY_SUMMARY.find((s) => s.companyId === c.id) ?? null,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="card-head">
          <div>
            <h2 className="card-title">公司汇总</h2>
            <p className="card-note">
              {MONTH_LABEL} 整月固定汇总 · 全总公司 {companies.length} 家公司并排对比 —— 不合并成一行"总公司总计"：
              各公司名下部门绑的时区不同，"今天"/统计周期的真实起止时间点本来就不是同一个（需求文档 5.5，周期性汇总也不例外，不只是"今天"这一天），
              硬加总会得到一个没有实际含义的数字。
            </p>
          </div>
          <span className="badge" data-tone="mute">只读 · 总公司口径 · 固定月度</span>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none" }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th style={{ width: 160, position: "sticky", left: 0, zIndex: 4 }}>公司</th>
                {COLUMNS.map((c) => <th key={c.label}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ company, metrics }) => (
                <tr key={company.id}>
                  <td
                    style={{
                      fontWeight: 700, whiteSpace: "nowrap",
                      position: "sticky", left: 0, zIndex: 2, background: "var(--surface)",
                    }}
                  >
                    {company.name}
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
          每行都是固定的整月快照，不随任何统计区间变化——{rows.map(({ company }) => company.name).join("、")}名下的部门分别绑着自己的时区，
          彼此的统计周期不是同一个时间窗口，所以本页只并排比较，永远不额外算一行跨公司合计。
        </p>
      </div>
    </div>
  );
}
