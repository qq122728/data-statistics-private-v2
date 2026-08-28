import type {
  ExpertRankingRow,
  GroupOperatorRankingRow,
  ReceptionRankingRow,
  RoleRankingsResult,
} from "./analytics/role-rankings";
import { formatUsdOr } from "./money";

export type MemberPerformanceReportRow = {
  group: string;
  name: string;
  role: string;
  added: number | "—";
  lowAmount: number | "—";
  noWs: number | "—";
  duplicate: number | "—";
  effective: number | "—";
  replied: number | "—";
  replyRate: string;
  joined: number | "—";
  joinRate: string;
  left: number | "—";
  leaveRate: string;
  introduced: number | "—";
  contacted: number | "—";
  registered: number | "—";
  registrationRate: string;
  orders: number | "—";
  orderRate: string;
  firstDeposit: string;
  deposit: string;
  withdrawal: string;
  netPerformance: string;
};

const rate = (numerator: number, denominator: number) => denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "—";
const money = (value: number | null) => formatUsdOr(value, "—");

function receptionRow(row: ReceptionRankingRow): MemberPerformanceReportRow {
  const total = row.total ?? row.valid;
  return {
    group: row.groupName, name: row.name, role: "前台接粉",
    added: total, lowAmount: row.lowAmount ?? 0, noWs: row.noWs ?? 0, duplicate: row.duplicate ?? 0,
    effective: row.valid, replied: row.replied, replyRate: rate(row.replied, row.valid),
    joined: row.joined, joinRate: rate(row.joined, row.replied), left: row.left ?? 0,
    leaveRate: rate(row.abnormalLeft ?? 0, row.joined), introduced: row.expertIntroduced,
    contacted: row.expertContacted ?? 0, registered: row.registered,
    registrationRate: rate(row.registered, row.expertContacted ?? row.expertIntroduced),
    orders: row.orders, orderRate: rate(row.orders, row.registered),
    firstDeposit: money(row.firstDepositCents), deposit: money(row.depositCents), withdrawal: money(row.withdrawalCents),
    netPerformance: money(row.netCents),
  };
}

function operatorRow(row: GroupOperatorRankingRow): MemberPerformanceReportRow {
  return {
    group: row.groupName, name: row.name, role: "前台炒群",
    added: "—", lowAmount: "—", noWs: "—", duplicate: "—", effective: "—", replied: "—", replyRate: "—",
    // 跟异常退群率共用同一批人：接手客户数，不是不受日期范围限制的当前在群快照。
    joined: row.sharedCustomerCount, joinRate: "—", left: row.leaveActions, leaveRate: rate(row.abnormalLeaveActions ?? 0, row.sharedCustomerCount),
    introduced: row.introducedActions, contacted: row.downstreamContacted ?? 0,
    registered: row.downstreamRegistered, registrationRate: rate(row.downstreamRegistered, row.downstreamContacted ?? 0),
    orders: row.downstreamOrders, orderRate: rate(row.downstreamOrders, row.downstreamRegistered),
    firstDeposit: money(row.firstDepositCents), deposit: money(row.depositCents), withdrawal: money(row.withdrawalCents), netPerformance: money(row.netCents),
  };
}

function expertRow(row: ExpertRankingRow): MemberPerformanceReportRow {
  return {
    group: row.groupName, name: row.name, role: row.role === "LEAD" ? "组长（兼专家）" : "前台专家",
    added: "—", lowAmount: "—", noWs: "—", duplicate: "—", effective: "—", replied: "—", replyRate: "—",
    joined: "—", joinRate: "—", left: "—", leaveRate: "—", introduced: row.assigned,
    contacted: row.contacted ?? 0, registered: row.registered, registrationRate: rate(row.registered, row.contacted ?? row.assigned),
    orders: row.orders, orderRate: rate(row.orders, row.registered),
    firstDeposit: money(row.firstDepositCents), deposit: money(row.depositCents), withdrawal: money(row.withdrawalCents), netPerformance: money(row.netCents),
  };
}

export function memberPerformanceReportRows(result: RoleRankingsResult): MemberPerformanceReportRow[] {
  return [
    ...result.reception.map(receptionRow),
    ...result.groupOperators.map(operatorRow),
    ...result.experts.map(expertRow),
  ];
}

const columns: Array<[keyof MemberPerformanceReportRow, string]> = [
  ["group", "小组"], ["name", "姓名"], ["role", "岗位"],
  ["added", "添加数据"], ["duplicate", "撞粉"], ["lowAmount", "低金额"], ["noWs", "无 WS 号码"], ["effective", "有效数据"],
  ["replied", "回复"], ["replyRate", "回复率"], ["joined", "进群"], ["joinRate", "进群率"], ["left", "退群"], ["leaveRate", "异常退群率"],
  ["introduced", "推专家"], ["contacted", "专家已联系"], ["registered", "注册"], ["registrationRate", "注册率"],
    ["orders", "开单"], ["orderRate", "开单率"], ["firstDeposit", "首充（美元）"], ["deposit", "入金（美元）"], ["withdrawal", "出金（美元）"], ["netPerformance", "净业绩（美元）"],
];

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function memberPerformanceCsv(input: {
  from: string;
  to: string;
  rows: MemberPerformanceReportRow[];
}) {
  const title = `组员业绩报表（${input.from} 至 ${input.to}；不同岗位按各自实际负责的环节统计）`;
  const header = columns.map(([, label]) => label).join(",");
  const records = input.rows.map((row) => columns.map(([key]) => csvCell(row[key])).join(","));
  return `\uFEFF${title}\n${header}\n${records.join("\n")}\n`;
}
