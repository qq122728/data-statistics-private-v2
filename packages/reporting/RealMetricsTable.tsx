"use client";
import styles from "./RealMetricsTable.module.css";

export type RealMetrics = {
  lawyerRealCase?: number;
  lawyerAdded?: number;
  lawyerExpertAdded?: number;
  customerServicePush?: number;
  bankDepositCents?: number;
  cryptoDepositCents?: number;
  added: number;
  collision: number;
  lowAmount: number;
  noWs: number;
  manualInvalid?: number;
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
  initialDepositCents?: number;
  rechargeCents?: number;
  withdrawalCents: number;
  netCents: number;
};

export type RealMetricRates = {
  replyRate?: number | null;
  groupRate?: number | null;
  leaveRate?: number | null;
  abnormalLeaveRate?: number | null;
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
  { label: "人工无效", render: ({ metrics }) => metrics.manualInvalid ?? 0 },
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
  { label: "异常退群率", render: ({ rates }) => <span className="muted">{percent(rates.abnormalLeaveRate ?? rates.leaveRate)}</span> },
  { label: "首充", render: ({ metrics }) => money(metrics.initialDepositCents ?? metrics.depositCents) },
  { label: "续充", render: ({ metrics }) => money(metrics.rechargeCents ?? 0) },
  { label: "出金", render: ({ metrics }) => money(metrics.withdrawalCents) },
  { label: "净业绩", render: ({ metrics }) => <strong style={{ color: metrics.netCents >= 0 ? "var(--ok)" : "var(--bad)" }}>{money(metrics.netCents)}</strong> },
];


const LAWYER_ROWS: typeof METRIC_ROWS = [
  {label:"接粉",render:({metrics:m})=>m.added},
  {label:"回复",render:({metrics:m})=>m.replied},
  {label:"未回复",render:({metrics:m})=>m.added-m.replied},
  {label:"接粉小金额",render:({metrics:m})=>m.lowAmount},
  {label:"接粉真实案件",render:({metrics:m})=>m.lawyerRealCase??0},
  {label:"添加律师",render:({metrics:m})=>m.lawyerAdded??0},
  {label:"添加专家",render:({metrics:m})=>m.lawyerExpertAdded??0},
  {label:"总推客服数量",render:({metrics:m})=>m.customerServicePush??0},
  {label:"总注册数量",render:({metrics:m})=>m.registered},
  {label:"总开单数量",render:({metrics:m})=>m.ordered},
  {label:"银行卡充值",render:({metrics:m})=>money(m.bankDepositCents??0)},
  {label:"加密货币充值",render:({metrics:m})=>money(m.cryptoDepositCents??0)},
  {label:"出金",render:({metrics:m})=>money(m.withdrawalCents)},
  {label:"净业绩",render:({metrics:m})=>money(m.netCents)},
];

export function RealMetricMatrix({ title, note, columns, groupType }: { title: string; note?: string; columns: RealMetricColumn[]; groupType?: "HACKER" | "LAWYER" }) {
  return <MetricComparison title={title} note={note} columns={columns} groupType={groupType}/>;
}

export function RealEntityMetricsTable({ title, note, entityLabel, rows, badge, groupType }: {
  title: string;
  note?: string;
  entityLabel: string;
  rows: Array<RealMetricColumn & { sub?: string }>;
  badge?: React.ReactNode;
  groupType?: "HACKER" | "LAWYER";
}) {
  return <MetricComparison title={title} note={note} columns={rows} badge={badge} entityLabel={entityLabel} groupType={groupType}/>;
}

function MetricComparison({title,note,columns,badge,entityLabel="对象",groupType}:{title:string;note?:string;columns:Array<RealMetricColumn & {sub?:string}>;badge?:React.ReactNode;entityLabel?:string;groupType?:"HACKER"|"LAWYER"}) {
  const ratio=(n:number,d:number)=>d>0?n/d:null;
  const lawyer=groupType==="LAWYER";
  const metricRows = lawyer ? LAWYER_ROWS : METRIC_ROWS.filter(m=>!m.label.endsWith("率"));
  const rateLabels=lawyer?["回复率","添加律师率","添加专家率"]:["回复率","进群率","异常退群率","注册率","开单率"];
  const rateValues=(c:RealMetricColumn)=>lawyer?[ratio(c.metrics.replied,c.metrics.added),ratio(c.metrics.lawyerAdded??0,c.metrics.added),ratio(c.metrics.lawyerExpertAdded??0,c.metrics.added)]:[c.rates.replyRate,c.rates.groupRate,c.rates.abnormalLeaveRate??c.rates.leaveRate,ratio(c.metrics.registered,c.metrics.pushed),ratio(c.metrics.ordered,c.metrics.registered)];

  return <section className="card" style={{overflow:"hidden"}}>
    <div className="card-head"><div><h2 className="card-title">{title}</h2>{note&&<p className="card-note">{note}</p>}</div>{badge}</div>
    {!columns.length?<p className={styles.empty}>当前范围暂无数据</p>:<>
      <p className={styles.label}>比率 · 自动计算</p>
      <div className={styles.wrap}><table className={`${styles.table} ${styles.rates}`} aria-label={`${title}比率`}><thead><tr><th>{entityLabel}</th>{rateLabels.map(label=><th key={label}>{label}</th>)}</tr></thead><tbody>{columns.map(c=><tr key={c.id}><th className={c.total?styles.total:undefined}>{c.name}</th>{rateValues(c).map((v,i)=><td className={c.total?styles.total:undefined} key={i}>{percent(v)}</td>)}</tr>)}</tbody></table></div>
      <p className={styles.label}>数量与资金 · 按指标对比</p>
      <div className={styles.wrap}><table className={styles.table} aria-label={`${title}数量与资金`}><thead><tr><th>数据指标</th>{columns.map(c=><th className={c.total?styles.total:undefined} key={c.id}>{c.name}{c.sub&&<small style={{display:"block",fontWeight:400}}>{c.sub}</small>}</th>)}</tr></thead><tbody>{metricRows.map(m=><tr key={m.label}><th scope="row">{m.label}</th>{columns.map(c=><td className={c.total?styles.total:undefined} key={c.id}>{m.render(c)}</td>)}</tr>)}</tbody></table></div>
    </>}
  </section>;
}
