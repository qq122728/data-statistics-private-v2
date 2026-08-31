"use client";

export type RealMetrics = {
  added: number;
  collision: number;
  lowAmount: number;
  noWs: number;
  effective: number;
  replied: number;
  joined: number;
  leftNormal: number;
  leftAbnormal: number;
  inGroup: number;
  pushed: number;
  registered: number;
  ordered: number;
  depositCents: number;
  withdrawalCents: number;
  netCents: number;
};

export type RealMetricRates = {
  replyRate?: number | null;
  groupRate?: number | null;
  leaveRate?: number | null;
};

export type RealMetricColumn = {
  id: string;
  name: string;
  metrics: RealMetrics;
  rates: RealMetricRates;
  total?: boolean;
};

const money = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(cents / 100);

const percent = (value: number | null | undefined) => value == null ? "—" : `${(value * 100).toFixed(1)}%`;

const METRIC_ROWS: Array<{ label: string; render: (column: RealMetricColumn) => React.ReactNode }> = [
  { label: "添加数据", render: ({ metrics }) => metrics.added },
  { label: "撞粉", render: ({ metrics }) => metrics.collision },
  { label: "低金额", render: ({ metrics }) => metrics.lowAmount },
  { label: "无WS号码", render: ({ metrics }) => metrics.noWs },
  { label: "有效数据", render: ({ metrics }) => <strong>{metrics.effective}</strong> },
  { label: "回复", render: ({ metrics }) => metrics.replied },
  { label: "进群", render: ({ metrics }) => metrics.joined },
  { label: "正常退群", render: ({ metrics }) => metrics.leftNormal },
  { label: "异常退群", render: ({ metrics }) => metrics.leftAbnormal },
  { label: "当前在群", render: ({ metrics }) => metrics.inGroup },
  { label: "推专家", render: ({ metrics }) => metrics.pushed },
  { label: "注册", render: ({ metrics }) => metrics.registered },
  { label: "开单", render: ({ metrics }) => metrics.ordered },
  { label: "回复率", render: ({ rates }) => <span className="muted">{percent(rates.replyRate)}</span> },
  { label: "拉群率", render: ({ rates }) => <span className="muted">{percent(rates.groupRate)}</span> },
  { label: "退群率", render: ({ rates }) => <span className="muted">{percent(rates.leaveRate)}</span> },
  { label: "入金", render: ({ metrics }) => money(metrics.depositCents) },
  { label: "出金", render: ({ metrics }) => money(metrics.withdrawalCents) },
  { label: "净业绩", render: ({ metrics }) => <strong style={{ color: metrics.netCents >= 0 ? "var(--ok)" : "var(--bad)" }}>{money(metrics.netCents)}</strong> },
];

export function RealMetricMatrix({ title, note, columns }: { title: string; note?: string; columns: RealMetricColumn[] }) {
  return <section className="card" style={{ overflow: "hidden" }}>
    <div className="card-head"><div><h2 className="card-title">{title}</h2>{note ? <p className="card-note">{note}</p> : null}</div></div>
    <div className="table-scroll" style={{ maxHeight: "none" }}>
      <table className="grid-table" style={{ minWidth: Math.max(900, 140 + columns.length * 108) }}>
        <thead><tr><th style={{ width: 140, position: "sticky", left: 0, zIndex: 4 }}>指标</th>{columns.map((column) => <th key={column.id} style={{ minWidth: 108, background: column.total ? "var(--surface-sunken)" : undefined }}>{column.name}</th>)}</tr></thead>
        <tbody>{METRIC_ROWS.map((row) => <tr key={row.label}>
          <td style={{ fontWeight: 600, whiteSpace: "nowrap", position: "sticky", left: 0, zIndex: 2, background: "var(--surface)" }}>{row.label}</td>
          {columns.map((column) => <td key={`${column.id}-${row.label}`} className="tnum" style={{ textAlign: "center", background: column.total ? "var(--surface-sunken)" : undefined, fontWeight: column.total ? 600 : undefined }}>{row.render(column)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

export function RealEntityMetricsTable({ title, note, entityLabel, rows, badge }: {
  title: string;
  note?: string;
  entityLabel: string;
  rows: Array<RealMetricColumn & { sub?: string }>;
  badge?: React.ReactNode;
}) {
  return <section className="card" style={{ overflow: "hidden" }}>
    <div className="card-head"><div><h2 className="card-title">{title}</h2>{note ? <p className="card-note">{note}</p> : null}</div>{badge}</div>
    <div className="table-scroll" style={{ maxHeight: "none" }}>
      <table className="grid-table metrics-entity-table" data-density="compact" data-sticky-edges="true" style={{ minWidth: 990 }}>
        <colgroup><col style={{ width: 112 }} />{METRIC_ROWS.map((row) => <col key={row.label} style={{ width: ["入金", "出金", "净业绩"].includes(row.label) ? 68 : 42 }} />)}</colgroup>
        <thead><tr><th style={{ position: "sticky", left: 0, zIndex: 4 }}>{entityLabel}</th>{METRIC_ROWS.map((row) => <th key={row.label}>{row.label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id}>
          <td style={{ fontWeight: 700, position: "sticky", left: 0, zIndex: 2, background: "var(--surface)" }}>{row.name}{row.sub ? <div className="muted metrics-entity-sub" style={{ fontWeight: 400 }}>{row.sub}</div> : null}</td>
          {METRIC_ROWS.map((metric) => <td key={`${row.id}-${metric.label}`} className="tnum" style={{ textAlign: "center" }}>{metric.render(row)}</td>)}
        </tr>)}{!rows.length ? <tr><td colSpan={20} style={{ padding: 44, textAlign: "center", color: "var(--ink-3)" }}>当前范围暂无数据</td></tr> : null}</tbody>
      </table>
    </div>
  </section>;
}
