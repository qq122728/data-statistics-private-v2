import React from "react";
import { formatUsd } from "../../../lib/money";
import type { MemberDailyDetail as MemberDailyDetailData } from "../../../lib/analytics/member-daily-detail";

function ReceptionRows({ detail }: { detail: MemberDailyDetailData }) {
  return <table className="data-table min-w-[900px]"><thead><tr><th>日期</th><th>添加数据</th><th>撞粉</th><th>低金额</th><th>无 WS 号码</th><th>有效数据</th><th>回复</th><th>进群</th></tr></thead><tbody>{detail.rows.map((row) => <tr key={row.date}><td className="font-semibold text-slate-900">{row.date}</td><td>{row.added}</td><td>{row.duplicate ?? 0}</td><td>{row.lowAmount}</td><td>{row.noWs}</td><td className="font-semibold text-slate-900">{row.valid}</td><td>{row.replied}</td><td>{row.joined}</td></tr>)}</tbody></table>;
}

function OperatorRows({ detail }: { detail: MemberDailyDetailData }) {
  return <table className="data-table min-w-[820px]"><thead><tr><th>日期</th><th>当日在群</th><th>当天进群</th><th>当天退群</th><th>可推专家</th><th>当天推专家</th></tr></thead><tbody>{detail.rows.map((row) => <tr key={row.date}><td className="font-semibold text-slate-900">{row.date}</td><td>{row.inGroup}</td><td>{row.joined}</td><td>{row.left}</td><td>{row.eligibleForExpert}</td><td>{row.introduced}</td></tr>)}</tbody></table>;
}

function ExpertRows({ detail }: { detail: MemberDailyDetailData }) {
  return <table className="data-table min-w-[900px]"><thead><tr><th>日期</th><th>已联系</th><th>注册</th><th>开单</th><th>入金</th><th>出金</th><th>净业绩</th></tr></thead><tbody>{detail.rows.map((row) => <tr key={row.date}><td className="font-semibold text-slate-900">{row.date}</td><td>{row.contacted}</td><td>{row.registered}</td><td>{row.ordered}</td><td>{formatUsd(row.depositCents)}</td><td>{formatUsd(row.withdrawalCents)}</td><td className="font-semibold text-slate-900">{formatUsd(row.netCents)}</td></tr>)}</tbody></table>;
}

const roleLabel = {
  RECEPTION: "接粉",
  GROUP_OPERATOR: "炒群",
  EXPERT: "专家",
} as const;

export function MemberDailyDetail({ detail }: { detail: MemberDailyDetailData }) {
  return <section className="member-daily-detail overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 className="m-0 text-base font-semibold text-slate-900">{detail.member.name} · 每日明细</h2>
        <p className="mb-0 mt-1 text-xs text-slate-500">{roleLabel[detail.member.role]} · {detail.member.groupName} · {detail.from} 至 {detail.to}</p>
      </div>
      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">只统计该岗位实际负责的动作</span>
    </div>
    <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
      {detail.member.role === "RECEPTION" ? "添加与有效数据按导入日统计；回复、进群按实际发生日统计。" : null}
      {detail.member.role === "GROUP_OPERATOR" ? "可推专家：已进群满 2 天、当天仍在群且尚未推专家的客户。" : null}
      {detail.member.role === "EXPERT" ? "入金包含首充和续充；净业绩 = 入金 − 出金。" : null}
    </div>
    <div className="data-table-wrap">
      {detail.member.role === "RECEPTION" ? <ReceptionRows detail={detail} /> : null}
      {detail.member.role === "GROUP_OPERATOR" ? <OperatorRows detail={detail} /> : null}
      {detail.member.role === "EXPERT" ? <ExpertRows detail={detail} /> : null}
    </div>
  </section>;
}
