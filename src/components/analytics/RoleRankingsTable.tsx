"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  ExpertRankingRow,
  GroupOperatorRankingRow,
  GroupRankingRow,
  ReceptionRankingRow,
  RoleRankingsResult,
} from "../../lib/analytics/role-rankings";
import {
  conversionGradeLabels,
  conversionRatePercent,
  gradeConversion,
  type GroupConversionStandards,
  type RateBand,
} from "../../lib/conversion-standards";
import { formatUsdOr } from "../../lib/money";

type View = "reception" | "operator" | "expert" | "group";
type MemberView = Exclude<View, "group">;
type MemberDetailQuery = Record<string, string | undefined>;

const money = (cents: number | null) => formatUsdOr(cents, "—");
const rate = (numerator: number, denominator: number) => denominator === 0 ? "—" : `${((numerator / denominator) * 100).toFixed(1)}%`;

function Rank({ value }: { value: number }) {
  return <span className={value <= 3 ? "font-bold text-blue-700" : "text-slate-500"}>{value}</span>;
}

function GroupBadge({ name }: { name: string }) {
  return <span className="inline-flex whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{name}</span>;
}

function countryName(code?: string | null) {
  if (!code) return "—";
  try { return new Intl.DisplayNames(["zh-CN"], { type: "region" }).of(code) ?? code; }
  catch { return code; }
}

function memberDetailHref(view: MemberView, memberId: string, query: MemberDetailQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  params.set("tab", view);
  params.set("memberId", memberId);
  return `/anomaly-ranking?${params.toString()}`;
}

function groupDailyHref(groupId: string, query: MemberDetailQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  params.append("groupIds", groupId);
  return `/group-daily-detail?${params.toString()}`;
}

function MemberName({
  name,
  memberId,
  view,
  detailQuery,
  subtitle,
}: {
  name: string;
  memberId: string;
  view: MemberView;
  detailQuery?: MemberDetailQuery;
  subtitle: string;
}) {
  const content = <><strong className="block text-slate-900">{name}</strong><span className="text-xs text-slate-500">{subtitle}</span></>;
  if (!detailQuery) return content;
  return <Link href={memberDetailHref(view, memberId, detailQuery)} className="group block no-underline">
    <span className="group-hover:text-blue-700">{content}</span>
    <span className="mt-0.5 block text-xs font-semibold text-blue-600">查看每日明细</span>
  </Link>;
}

function Rating({ completed, eligible, band }: { completed: number; eligible: number; band: RateBand }) {
  const grade = gradeConversion(completed, eligible, band);
  const percent = conversionRatePercent(completed, eligible);
  const tone = grade === "EXCELLENT" ? "success" : grade === "GOOD" ? "neutral" : grade === "PASS" ? "warning" : grade === "BELOW_PASS" ? "danger" : "neutral";
  return <div className="flex items-center gap-2"><strong>{percent === null ? "暂无样本" : `${percent.toFixed(1)}%`}</strong><span className="analysis-status" data-tone={tone}>{conversionGradeLabels[grade]}</span></div>;
}

function ReceptionTable({ rows, standards, detailQuery }: { rows: ReceptionRankingRow[]; standards: Record<string, GroupConversionStandards>; detailQuery?: MemberDetailQuery }) {
  return <table className="data-table min-w-[1900px]">
    <thead><tr><th>排名</th><th>接粉成员</th><th>小组</th><th>添加数据</th><th>撞粉</th><th>低金额</th><th>无 WS 号码</th><th>有效数据</th><th>回复</th><th>回复率</th><th>进群</th><th>进群率</th><th>退群</th><th>异常退群率</th><th>推专家</th><th>注册</th><th>注册率</th><th>开单</th><th>开单率</th><th>首充</th><th>入金</th><th>出金</th><th>净业绩</th><th>拉群评级</th></tr></thead>
    <tbody>
      {rows.map((row, index) => <tr key={row.id}>
        <td><Rank value={index + 1} /></td>
        <td><MemberName name={row.name} memberId={row.id} view="reception" detailQuery={detailQuery} subtitle="按已进群数量排名" /></td>
        <td><GroupBadge name={row.groupName} /></td><td>{row.total ?? row.valid}</td><td>{row.duplicate ?? 0}</td><td>{row.lowAmount ?? 0}</td><td>{row.noWs ?? 0}</td><td>{row.valid}</td><td>{row.replied}</td><td>{rate(row.replied, row.valid)}</td><td>{row.joined}</td><td>{rate(row.joined, row.replied)}</td><td>{row.left ?? 0}</td><td>{rate(row.abnormalLeft ?? 0, row.joined)}</td><td>{row.expertIntroduced}</td><td>{row.registered}</td><td>{rate(row.registered, row.expertContacted ?? row.expertIntroduced)}</td><td>{row.orders}</td><td>{rate(row.orders, row.registered)}</td><td>{money(row.firstDepositCents)}</td><td>{money(row.depositCents)}</td><td>{money(row.withdrawalCents)}</td><td className="font-semibold text-slate-900">{money(row.netCents)}</td>
        <td><Rating completed={row.joined} eligible={row.valid} band={standards[row.groupId]?.receptionJoin ?? { pass: 10, good: 15, excellent: 20 }} /></td>
      </tr>)}
      {!rows.length && <tr><td colSpan={24} className="empty-state">当前范围没有接粉成员数据</td></tr>}
    </tbody>
  </table>;
}

function OperatorTable({ rows, standards, detailQuery }: { rows: GroupOperatorRankingRow[]; standards: Record<string, GroupConversionStandards>; detailQuery?: MemberDetailQuery }) {
  return <table className="data-table min-w-[1580px]">
    <thead><tr><th>排名</th><th>炒群成员</th><th>小组</th><th>接手客户</th><th>当前在群</th><th>退群</th><th>异常退群率</th><th>可推专家</th><th>推专家</th><th>第3天推专家率</th><th>推专家评级</th><th>专家已联系</th><th>注册</th><th>开单</th><th>首充</th><th>入金</th><th>出金</th><th>净业绩</th></tr></thead>
    <tbody>
      {rows.map((row, index) => <tr key={row.id}>
        <td><Rank value={index + 1} /></td>
        <td><MemberName name={row.name} memberId={row.id} view="operator" detailQuery={detailQuery} subtitle="按推专家数量排名" /></td>
        <td><GroupBadge name={row.groupName} /></td><td>{row.sharedCustomerCount}</td><td>{row.currentInGroup}</td><td>{row.leaveActions}</td><td>{rate(row.abnormalLeaveActions ?? 0, row.sharedCustomerCount)}</td><td>{row.eligibleForIntroduction}</td><td className="font-semibold text-slate-900">{row.introducedEligible}</td><td>{rate(row.introducedEligible, row.eligibleForIntroduction)}</td>
        <td><Rating completed={row.introducedEligible} eligible={row.eligibleForIntroduction} band={standards[row.groupId]?.operatorExpert ?? { pass: 60, good: 70, excellent: 80 }} /></td><td>{row.downstreamContacted ?? 0}</td><td>{row.downstreamRegistered}</td><td>{row.downstreamOrders}</td><td>{money(row.firstDepositCents)}</td><td>{money(row.depositCents)}</td><td>{money(row.withdrawalCents)}</td><td className="font-semibold text-slate-900">{money(row.netCents)}</td>
      </tr>)}
      {!rows.length && <tr><td colSpan={18} className="empty-state">当前范围没有炒群成员数据</td></tr>}
    </tbody>
  </table>;
}

function ExpertTable({ rows, standards, detailQuery }: { rows: ExpertRankingRow[]; standards: Record<string, GroupConversionStandards>; detailQuery?: MemberDetailQuery }) {
  return <table className="data-table min-w-[1360px]">
    <thead><tr><th>排名</th><th>专家负责人</th><th>小组</th><th>接手客户</th><th>已联系</th><th>联系率</th><th>注册</th><th>注册率</th><th>开单</th><th>开单率</th><th>开单评级</th><th>首充</th><th>入金</th><th>出金</th><th>净业绩</th></tr></thead>
    <tbody>
      {rows.map((row, index) => <tr key={row.id}>
        <td><Rank value={index + 1} /></td>
        <td><MemberName name={row.name} memberId={row.id} view="expert" detailQuery={detailQuery} subtitle={row.role === "LEAD" ? "组长代专家" : "专家"} /></td>
        <td><GroupBadge name={row.groupName} /></td><td>{row.assigned}</td><td>{row.contacted ?? 0}</td><td>{rate(row.contacted ?? 0, row.assigned)}</td><td>{row.registered}</td><td>{rate(row.registered, row.contacted ?? 0)}</td><td>{row.orders}</td><td>{rate(row.orders, row.registered)}</td>
        <td><Rating completed={row.orderedEligible} eligible={row.eligibleForOrder} band={standards[row.groupId]?.expertOrder ?? { pass: 10, good: 15, excellent: 20 }} /></td><td>{money(row.firstDepositCents)}</td><td>{money(row.depositCents)}</td><td>{money(row.withdrawalCents)}</td><td className="font-semibold text-slate-900">{money(row.netCents)}</td>
      </tr>)}
      {!rows.length && <tr><td colSpan={15} className="empty-state">当前范围没有专家分配数据</td></tr>}
    </tbody>
  </table>;
}

function GroupTable({ rows, detailQuery }: { rows: GroupRankingRow[]; detailQuery?: MemberDetailQuery }) {
  return <table className="data-table min-w-[1680px]"><thead><tr><th>排名</th><th>下属公司</th><th>国家</th><th>小组</th><th>有效数据</th><th>回复</th><th>回复率</th><th>进群</th><th>进群率</th><th>退群</th><th>异常退群率</th><th>推专家</th><th>注册</th><th>注册率</th><th>开单</th><th>开单率</th><th>首充</th><th>入金</th><th>出金</th><th>净业绩</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id}><td><Rank value={index + 1} /></td><td>{row.departmentName ?? "—"}</td><td>{countryName(row.countryCode)}</td><td className="font-semibold text-slate-900">{detailQuery ? <Link className="text-blue-700" href={groupDailyHref(row.id, detailQuery)}>{row.name}</Link> : row.name}</td><td>{row.valid}</td><td>{row.replied}</td><td>{rate(row.replied, row.valid)}</td><td>{row.joined}</td><td>{rate(row.joined, row.replied)}</td><td>{row.left ?? 0}</td><td>{rate(row.abnormalLeft ?? 0, row.joined)}</td><td>{row.expertIntroduced}</td><td>{row.registered}</td><td>{rate(row.registered, row.expertIntroduced)}</td><td>{row.orders}</td><td>{rate(row.orders, row.registered)}</td><td>{money(row.firstDepositCents)}</td><td>{money(row.depositCents)}</td><td>{money(row.withdrawalCents)}</td><td className="font-semibold text-slate-900">{money(row.netCents)}</td></tr>)}{!rows.length && <tr><td colSpan={20} className="empty-state">当前范围没有小组数据</td></tr>}</tbody></table>;
}

export function RoleRankingsTable({ result, initialView = "reception", showTabs = true, memberDetailQuery, groupDetailQuery }: { result: RoleRankingsResult; initialView?: View; showTabs?: boolean; memberDetailQuery?: MemberDetailQuery; groupDetailQuery?: MemberDetailQuery }) {
  const [view, setView] = useState<View>(initialView);
  const tabs: Array<{ value: View; label: string; count: number }> = [
    { value: "reception", label: "接粉成员榜", count: result.reception.length },
    { value: "operator", label: "炒群成员榜", count: result.groupOperators.length },
    { value: "expert", label: "专家成员榜", count: result.experts.length },
    { value: "group", label: "小组榜", count: result.groups.length },
  ];
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    {showTabs ? <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-3 pt-2">{tabs.map((tab) => <button key={tab.value} type="button" onClick={() => setView(tab.value)} className={`border-b-2 px-3 py-2.5 text-sm font-semibold ${view === tab.value ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{tab.label} <span className="ml-1 text-xs">{tab.count}</span></button>)}</div> : null}
    <div className="border-b border-slate-100 bg-blue-50/60 px-4 py-2 text-xs leading-5 text-slate-600">
      {view === "reception" && "接粉成员榜按实际录入人统计流程和协作业绩；同一客户的首充会同时展示给接粉、炒群和专家，但小组总账只计算一次。"}
      {view === "operator" && "炒群成员榜从接手客户开始看，重点是退群、推专家和后续专家联系；首充、入金和净业绩为协作业绩，不会重复计入公司总账。"}
      {view === "expert" && "专家成员榜重点看已联系、注册、开单和净业绩；首充、入金和净业绩为协作业绩，不会重复计入公司总账。"}
      {view === "group" && "小组榜展示完整漏斗。净业绩 = 入金 − 出金。"}
    </div>
    <div className="data-table-wrap">
      {view === "reception" && <ReceptionTable rows={result.reception} standards={result.standardsByGroup} detailQuery={memberDetailQuery} />}
      {view === "operator" && <OperatorTable rows={result.groupOperators} standards={result.standardsByGroup} detailQuery={memberDetailQuery} />}
      {view === "expert" && <ExpertTable rows={result.experts} standards={result.standardsByGroup} detailQuery={memberDetailQuery} />}
      {view === "group" && <GroupTable rows={result.groups} detailQuery={groupDetailQuery} />}
    </div>
  </section>;
}
