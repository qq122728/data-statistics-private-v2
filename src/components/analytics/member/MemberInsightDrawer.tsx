"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MemberEvidenceResult } from "../../../lib/analytics/member-evidence";
import type { ManagementRole } from "../../../lib/analytics/types";
import { calculateConversionRates } from "../../../lib/metrics";
import { Drawer } from "../../ui/Drawer";
import { FunnelSummary } from "../FunnelSummary";
import { RiskDecisionDialog, type RiskDecisionLevel, type SavedRiskDecision } from "./RiskDecisionDialog";
import { memberOverviewHref, type MemberOverviewQuery } from "./MemberOverviewTabs";
import { formatUsdOr } from "../../../lib/money";

type ClientEvidence = Omit<MemberEvidenceResult, "latestDecision"> & {
  latestDecision: (Omit<NonNullable<MemberEvidenceResult["latestDecision"]>, "createdAt"> & { createdAt: string }) | null;
};

const stageName = { TRAINING: "培训期", OBSERVATION: "观察期", FORMAL: "正式期", PAUSED: "暂停评价" } as const;
const performanceName = { NONE: "暂无表现风险", COACHING: "需要辅导", LIMIT_WATCH: "限流观察", ELIMINATION_WATCH: "淘汰观察" } as const;
const dataRiskName = {
  UNCONFIRMED: "今日数据未确认",
  LONG_NO_RECORD: "长时间无记录",
  DOWNSTREAM_EXCEEDS_UPSTREAM: "下游数量大于上游",
  LEAVE_EXCEEDS_JOIN: "退群数大于入群数",
  FREQUENT_HISTORY_EDITS: "频繁修改历史",
  PENDING_PRICE: "渠道待定价",
} as const;
const financialRiskName = {
  SUSTAINED_LOSS: "持续亏损",
  SIGNIFICANT_PROFIT_DROP: "计入业绩显著下降",
  WITHDRAWAL_ANOMALY: "出金或消耗异常",
} as const;

const money = (cents: number | null) => formatUsdOr(cents, "待定价");
const percent = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;

function batchHref(batchId: string, memberId: string, query: MemberOverviewQuery) {
  const base = memberOverviewHref(query, { tab: undefined, memberId });
  const params = base.includes("?") ? base.slice(base.indexOf("?")) : "";
  return `/batch-tracking/${batchId}${params}`;
}

export function MemberInsightDrawer({ memberId, memberName, role, query, onClose }: {
  memberId: string | null;
  memberName: string;
  role: ManagementRole;
  query: MemberOverviewQuery;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [evidence, setEvidence] = useState<ClientEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [decisionLevel, setDecisionLevel] = useState<RiskDecisionLevel | null>(null);
  const [decisionNotice, setDecisionNotice] = useState("");
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => setMounted(true), []);
  useLayoutEffect(() => {
    if (memberId && document.activeElement instanceof HTMLElement) returnFocusRef.current = document.activeElement;
  }, [memberId]);
  useEffect(() => {
    if (!memberId) {
      setEvidence(null);
      setError("");
      setDecisionLevel(null);
      setDecisionNotice("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setEvidence(null);
    fetch(`/api/member-overview/${encodeURIComponent(memberId)}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as ClientEvidence & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "加载组员详情失败");
        return body;
      })
      .then(setEvidence)
      .catch((caught) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "加载组员详情失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [memberId, reloadKey]);
  useEffect(() => {
    if (!memberId || !mounted) return;
    const background = document.querySelector<HTMLElement>(".app-shell");
    const wasInert = background?.hasAttribute("inert") ?? false;
    background?.setAttribute("inert", "");
    return () => { if (!wasInert) background?.removeAttribute("inert"); };
  }, [memberId, mounted]);

  const evidenceThrough = evidence?.evaluations.at(-1)?.evaluationDate ?? "";
  const confirmableLevel = evidence?.risks.performance.level === "LIMIT_WATCH" || evidence?.risks.performance.level === "ELIMINATION_WATCH"
    ? evidence.risks.performance.level
    : null;
  const funnelRates = useMemo(() => evidence ? calculateConversionRates(evidence.funnel) : null, [evidence]);
  const closeDrawer = useCallback(() => {
    const returnFocus = returnFocusRef.current;
    document.querySelector<HTMLElement>(".app-shell")?.removeAttribute("inert");
    onClose();
    requestAnimationFrame(() => returnFocus?.focus());
  }, [onClose]);
  const drawer = <Drawer title={evidence ? `${evidence.member.name}·组员详情` : `${memberName}·组员详情`} open={Boolean(memberId)} onClose={closeDrawer} className="member-insight-drawer max-w-2xl max-sm:max-w-none">
    {loading ? <div role="status" aria-live="polite" className="space-y-3 p-5"><p className="text-sm text-slate-600">正在加载详情…</p>{Array.from({ length: 7 }, (_, index) => <div key={index} className="page-loading-skeleton h-12" data-skeleton="true" />)}</div> : null}
    {error ? <div className="p-5"><section className="rounded-xl border border-red-200 bg-red-50 p-4"><h3 className="font-semibold text-red-900">详情加载失败</h3><p className="mt-2 text-sm text-red-700">{error}</p><button type="button" onClick={() => setReloadKey((value) => value + 1)} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700">重新加载</button></section></div> : null}
    {evidence && funnelRates ? <div className="space-y-6 p-5">
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="m-0 text-lg font-bold text-slate-950">{evidence.member.name}</h3><p className="mt-1 text-sm text-slate-600">{evidence.member.group.name} · {evidence.member.role === "LEAD" ? "组长" : "成员"} · {stageName[evidence.member.stage]}</p></div><span className="analysis-status" data-tone={evidence.member.active ? "success" : "warning"}>{evidence.member.active ? "启用中" : "已停用"}</span></div>{evidence.member.employmentDay !== null ? <p className="mt-2 text-xs text-slate-500">入职第 {evidence.member.employmentDay} 天 · {evidence.member.stageSource === "OVERRIDE" ? "管理员手动阶段" : "系统自动阶段"}</p> : null}</section>

      <section><h3 className="font-semibold text-slate-950">完整漏斗与最大掉点</h3><div className="mt-3"><FunnelSummary totals={evidence.funnel} rates={funnelRates} largestDrop={evidence.largestDrop} /></div><p className="mt-2 text-xs text-slate-500">回复率：{evidence.funnel.effectiveFans === 0 ? <span title="缺少有效分母">—（缺少有效分母）</span> : `${(evidence.funnel.replies / evidence.funnel.effectiveFans * 100).toFixed(1)}%`}</p></section>

      <section><h3 className="font-semibold text-slate-950">渠道构成与固定单价</h3><div className="mt-3 space-y-2">{evidence.channels.length ? evidence.channels.map((channel) => <article key={channel.channel.id} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{channel.channel.name}</strong><span className={channel.effectiveFanPriceCents === null ? "text-amber-700" : "text-slate-600"}>{channel.effectiveFanPriceCents === null ? "待定价" : `${money(channel.effectiveFanPriceCents)} / 有效数据`}</span></div><p className="mt-1 text-xs text-slate-500">有效数据 {channel.totals.effectiveFans} · 开单 {channel.totals.orders} · 计入业绩 {money(channel.financials.profitCents)}</p></article>) : <p className="text-sm text-slate-500">无渠道数据</p>}</div></section>

      <section><h3 className="font-semibold text-slate-950">财务计算过程</h3><div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700"><p className="m-0">数据成本 = {evidence.financialFormula.costTerms.length ? evidence.financialFormula.costTerms.map((term) => `${term.effectiveFans} 有效数据 × ${term.effectiveFanPriceCents === null ? "待定价" : money(term.effectiveFanPriceCents)}`).join(" + ") : "无数据"} = <strong>{money(evidence.financialFormula.costCents)}</strong></p><p className="m-0">净业绩 = 入金 {money(evidence.financialFormula.rechargeCents)} − 出金 {money(evidence.financialFormula.withdrawalCents)} = <strong>{money(evidence.financialFormula.netPerformanceCents)}</strong></p><p className="m-0">计入业绩 = 净业绩 − 数据成本 {evidence.financialFormula.rebateCents ? `− 渠道返点 ${money(evidence.financialFormula.rebateCents)}` : ""} = <strong>{money(evidence.financialFormula.profitCents)}</strong></p></div></section>

      <section><h3 className="font-semibold text-slate-950">趋势</h3><div className="analysis-detail-grid mt-3"><p className="rounded-lg bg-slate-50 p-3 text-sm">渠道校正效率变化<strong className="mt-1 block text-lg">{percent(evidence.trend.adjustedEfficiencyChange)}</strong></p><p className="rounded-lg bg-slate-50 p-3 text-sm">计入业绩变化<strong className="mt-1 block text-lg">{money(evidence.trend.profitChangeCents)}</strong></p></div></section>

      <section><h3 className="font-semibold text-slate-950">异常证据</h3><div className="mt-3 space-y-2"><article className={`rounded-lg border p-3 ${evidence.risks.performance.level === "NONE" ? "border-slate-200" : "border-red-200 bg-red-50"}`}><strong>表现风险：{performanceName[evidence.risks.performance.level]}</strong><p className="mt-1 text-xs text-slate-600">连续偏低天数：辅导 {evidence.risks.performance.lowDays.coaching} · 限流 {evidence.risks.performance.lowDays.limit} · 淘汰 {evidence.risks.performance.lowDays.elimination}</p></article>{evidence.risks.financial.map((risk) => <article key={risk.code} className="rounded-lg border border-amber-200 bg-amber-50 p-3"><strong>财务风险：{financialRiskName[risk.code]}</strong><p className="mt-1 break-words text-xs text-slate-600">证据：{JSON.stringify(risk.evidence)}</p></article>)}{evidence.risks.data.map((risk) => <article key={risk.code} className="rounded-lg border border-sky-200 bg-sky-50 p-3"><strong>数据待核实：{dataRiskName[risk.code]}</strong><p className="mt-1 break-words text-xs text-slate-600">证据：{JSON.stringify(risk.evidence)}</p></article>)}</div>
        {role === "ADMIN" && confirmableLevel ? <button type="button" onClick={() => setDecisionLevel(confirmableLevel)} className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-semibold text-red-700">人工确认{performanceName[confirmableLevel]}</button> : null}
        {role === "LEAD" && evidence.risks.performance.level !== "NONE" ? <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800">建议：安排辅导并持续跟进证据。</p> : null}
        {decisionNotice ? <p role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{decisionNotice}</p> : null}
        {evidence.latestDecision ? <p className="mt-3 text-xs text-slate-500">最新人工确认：{performanceName[evidence.latestDecision.level]}，证据截止 {evidence.latestDecision.evidenceThrough}，原因“{evidence.latestDecision.reason}”。</p> : null}
      </section>

      <section><h3 className="font-semibold text-slate-950">相关成熟批次</h3><div className="mt-3 space-y-2">{evidence.matureBatches.length ? evidence.matureBatches.map((batch) => <Link key={batch.id} href={batchHref(batch.id, evidence.member.id, query)} className="flex justify-between rounded-lg border border-slate-200 p-3 text-sm no-underline hover:border-blue-300"><span>{batch.sourceDate} · {batch.channel.name}</span><span className="font-semibold text-blue-600">查看批次</span></Link>) : <p className="text-sm text-slate-500">无成熟批次</p>}</div></section>
    </div> : null}
    {evidence && decisionLevel ? <RiskDecisionDialog open memberId={evidence.member.id} memberName={evidence.member.name} level={decisionLevel} evidenceThrough={evidenceThrough} onClose={() => setDecisionLevel(null)} onConfirmed={(decision: SavedRiskDecision) => { setEvidence((current) => current ? { ...current, latestDecision: { ...decision, actor: { id: "current", name: "当前管理员" } } } : current); setDecisionNotice("已记录人工确认；组员账号仍保持原状态。"); }} /> : null}
  </Drawer>;
  return memberId && mounted ? createPortal(drawer, document.body) : null;
}
