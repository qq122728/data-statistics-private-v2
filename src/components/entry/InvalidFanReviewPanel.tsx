"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { EntryChannel } from "./ChannelCombobox";

type Counts = { noWsCount: number; lowAmountCount: number; collisionCount: number };
type DraftCounts = { noWsCount: string; lowAmountCount: string; collisionCount: string };

type InvalidFanReport = Counts & {
  id: string;
  status: "PENDING" | "APPROVED" | "RETURNED";
  approvedNoWsCount: number | null;
  approvedLowAmountCount: number | null;
  approvedCollisionCount: number | null;
  reviewReason: string | null;
  isLeaderSupplement: boolean;
  batch: { id: string; sourceDate: string; channel: { id: string; name: string } };
  reporter: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
};

const blankDraft = (): DraftCounts => ({ noWsCount: "0", lowAmountCount: "0", collisionCount: "0" });
const statusLabel: Record<InvalidFanReport["status"], string> = { PENDING: "待组长审核", APPROVED: "已确认", RETURNED: "已退回" };

function readCounts(draft: DraftCounts): Counts | null {
  const values = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Number(value)])) as Counts;
  return Object.values(values).every((value) => Number.isInteger(value) && value >= 0) ? values : null;
}

function CountInputs({ draft, onChange, prefix, disabled = false }: {
  draft: DraftCounts;
  onChange: (next: DraftCounts) => void;
  prefix: string;
  disabled?: boolean;
}) {
  const input = (key: keyof DraftCounts, label: string, description: string, tone: "blue" | "amber" | "violet") => <label className="invalid-fan-count-card" data-tone={tone}><span className="invalid-fan-count-label">{label}</span><small>{description}</small><input aria-label={`${prefix} ${label}`} disabled={disabled} type="number" min="0" step="1" inputMode="numeric" value={draft[key]} onChange={(event) => onChange({ ...draft, [key]: event.target.value })} /></label>;
  return <div className="invalid-fan-count-grid">
    {input("collisionCount", "撞粉", "号码已重复出现", "violet")}{input("lowAmountCount", "低金额", "金额不足 $5,000", "amber")}{input("noWsCount", "无 WS 号码", "没有可用 WhatsApp", "blue")}
  </div>;
}

export function InvalidFanReportPanel({
  role,
  channels,
  sourceDate,
  channelId,
  onSourceDate,
  onChannelId,
  onRefresh,
}: {
  role: "RECEPTION" | "LEAD";
  channels: EntryChannel[];
  sourceDate: string;
  channelId: string;
  onSourceDate?: (value: string) => void;
  onChannelId?: (value: string) => void;
  onRefresh?: () => void;
}) {
  const [reports, setReports] = useState<InvalidFanReport[]>([]);
  const [draft, setDraft] = useState<DraftCounts>(blankDraft);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, DraftCounts>>({});
  const [reviewReasons, setReviewReasons] = useState<Record<string, string>>({});
  const [supplementReason, setSupplementReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const selectedChannel = channels.find((channel) => channel.id === channelId);

  const reportsForSource = useMemo(() => reports.filter((report) => report.batch.channel.id === channelId && report.batch.sourceDate === sourceDate), [reports, channelId, sourceDate]);

  async function loadReports() {
    const response = await fetch("/api/invalid-fan-reports");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "无效粉数据加载失败");
    setReports(result.reports as InvalidFanReport[]);
  }

  useEffect(() => {
    void loadReports().catch((reason) => setError(reason instanceof Error ? reason.message : "无效粉数据加载失败"));
  }, []);

  async function submit(action: "report" | "supplement") {
    const counts = readCounts(draft);
    if (!counts) {
      setError("撞粉、低金额、无 WS 号码必须填写大于或等于 0 的整数");
      return;
    }
    if (!channelId || !sourceDate) {
      setError("请先在上方选择导入日期和来源渠道");
      return;
    }
    if (action === "supplement" && !supplementReason.trim()) {
      setError("组长补录必须填写原因");
      return;
    }
    setBusy(action);
    setError("");
    try {
      const response = await fetch("/api/invalid-fan-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, channelId, sourceDate, ...counts, ...(action === "supplement" ? { reason: supplementReason.trim() } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "扣粉登记保存失败");
      setMessage(action === "supplement" ? "组长补录已确认并计入正式统计" : "无效粉已提交，等待组长审核后才会计入正式统计");
      setDraft(blankDraft());
      setSupplementReason("");
      await loadReports();
      onRefresh?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "扣粉登记保存失败");
    } finally {
      setBusy("");
    }
  }

  async function review(report: InvalidFanReport, action: "approve" | "return") {
    const values = reviewDrafts[report.id] ?? {
      noWsCount: String(report.noWsCount),
      lowAmountCount: String(report.lowAmountCount),
      collisionCount: String(report.collisionCount),
    };
    const counts = readCounts(values);
    if (action === "approve" && !counts) {
      setError("确认数量必须是大于或等于 0 的整数");
      return;
    }
    setBusy(`${action}-${report.id}`);
    setError("");
    try {
      const response = await fetch(`/api/invalid-fan-reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(counts ? counts : {}), reason: reviewReasons[report.id]?.trim() || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "审核失败");
      setMessage(action === "approve" ? "扣粉数据已确认，已进入正式统计" : "已退回给接粉员修改，暂不计入正式统计");
      await loadReports();
      onRefresh?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "审核失败");
    } finally {
      setBusy("");
    }
  }

  return <section className="member-panel invalid-fan-report-panel">
    <div className="member-panel-title"><div><p>{role === "LEAD" ? "本组审核" : "单独登记"}</p><h3>{role === "LEAD" ? "扣粉审核" : "扣粉登记"}</h3></div><span>撞粉、低金额、无 WS 号码只填数量，不创建客户；组长审核后才会进入正式统计。</span></div>
    <div className="invalid-fan-entry-card">
      <div className="invalid-fan-entry-heading"><div><strong>登记数据</strong><span>先选择这批名单的日期和渠道，再填写三个扣粉数量。</span></div><em>不会创建客户</em></div>
      <div className="invalid-fan-report-source">{role === "LEAD" || onSourceDate || onChannelId ? <><label><span>统计日期</span><input aria-label={role === "LEAD" ? "审核统计日期" : "无效粉统计日期"} type="date" value={sourceDate} onChange={(event) => onSourceDate?.(event.target.value)} /></label><label><span>来源渠道</span><select aria-label={role === "LEAD" ? "审核来源渠道" : "无效粉来源渠道"} value={channelId} onChange={(event) => onChannelId?.(event.target.value)}><option value="">请选择渠道</option>{channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label></> : <><label><span>统计日期</span><strong>{sourceDate || "请先选择日期"}</strong></label><label><span>来源渠道</span><strong>{selectedChannel ? selectedChannel.name : "请先选择渠道"}</strong></label></>}</div>
    {(message || error) ? <p role={error ? "alert" : "status"} className={`member-feedback ${error ? "is-error" : ""}`}>{error || message}</p> : null}
    {role === "RECEPTION" ? <>
      <CountInputs prefix="扣粉登记" draft={draft} onChange={setDraft} />
      <div className="invalid-fan-submit-row"><span>可修改本人尚未审核的记录；确认后如需更正，请联系组长。</span><button type="button" className="member-primary" disabled={!channelId || busy === "report"} onClick={() => { void submit("report"); }}>{busy === "report" ? "提交中…" : "提交给组长审核"}</button></div>
    </> : <>
      <div className="invalid-fan-supplement"><div><strong>组长补录</strong><small>用于补充组员漏报的数据；提交即确认并计入正式统计，必须说明原因。</small></div><CountInputs prefix="组长补录" draft={draft} onChange={setDraft} /><label>补录原因<input aria-label="组长补录原因" value={supplementReason} onChange={(event) => setSupplementReason(event.target.value)} placeholder="例如：组员漏报的 8 月 20 日名单" /></label><button type="button" className="member-secondary" disabled={!channelId || busy === "supplement"} onClick={() => { void submit("supplement"); }}>{busy === "supplement" ? "补录中…" : "确认补录"}</button></div>
    </>}
    </div>
    <section className="invalid-fan-history"><div className="invalid-fan-history-heading"><div><strong>登记记录</strong><span>{role === "LEAD" ? "核对组员提交的数据，确认后才进入正式统计。" : "只显示当前日期和渠道的登记记录。"}</span></div><span>{role === "LEAD" ? `${reports.length} 条` : `${reportsForSource.length} 条`}</span></div><ReportTable reports={role === "LEAD" ? reports : reportsForSource} role={role} reviewDrafts={reviewDrafts} setReviewDrafts={setReviewDrafts} reviewReasons={reviewReasons} setReviewReasons={setReviewReasons} busy={busy} onReview={review} /></section>
  </section>;
}

function ReportTable({ reports, role, reviewDrafts, setReviewDrafts, reviewReasons, setReviewReasons, busy, onReview }: {
  reports: InvalidFanReport[];
  role: "RECEPTION" | "LEAD";
  reviewDrafts: Record<string, DraftCounts>;
  setReviewDrafts: (rows: Record<string, DraftCounts>) => void;
  reviewReasons: Record<string, string>;
  setReviewReasons: (rows: Record<string, string>) => void;
  busy: string;
  onReview: (report: InvalidFanReport, action: "approve" | "return") => Promise<void>;
}) {
  return <div className="member-table-wrap mt-4"><table className="member-table"><thead><tr><th>日期 / 渠道</th>{role === "LEAD" ? <th>填报人</th> : null}<th>撞粉</th><th>低金额</th><th>无 WS 号码</th><th>状态</th>{role === "LEAD" ? <th>审核操作</th> : <th>审核说明</th>}</tr></thead><tbody>{reports.map((report) => {
    const draft = reviewDrafts[report.id] ?? { noWsCount: String(report.noWsCount), lowAmountCount: String(report.lowAmountCount), collisionCount: String(report.collisionCount) };
    const editable = role === "LEAD" && report.status === "PENDING";
    return <tr key={report.id}><td>{report.batch.sourceDate}<small className="block">{report.batch.channel.name}</small></td>{role === "LEAD" ? <td>{report.reporter.name}{report.isLeaderSupplement ? <small className="block">组长补录</small> : null}</td> : null}<td>{editable ? <input aria-label={`${report.id} 撞粉`} type="number" min="0" value={draft.collisionCount} onChange={(event) => setReviewDrafts({ ...reviewDrafts, [report.id]: { ...draft, collisionCount: event.target.value } })} /> : report.approvedCollisionCount ?? report.collisionCount}</td><td>{editable ? <input aria-label={`${report.id} 低金额`} type="number" min="0" value={draft.lowAmountCount} onChange={(event) => setReviewDrafts({ ...reviewDrafts, [report.id]: { ...draft, lowAmountCount: event.target.value } })} /> : report.approvedLowAmountCount ?? report.lowAmountCount}</td><td>{editable ? <input aria-label={`${report.id} 无 WS 号码`} type="number" min="0" value={draft.noWsCount} onChange={(event) => setReviewDrafts({ ...reviewDrafts, [report.id]: { ...draft, noWsCount: event.target.value } })} /> : report.approvedNoWsCount ?? report.noWsCount}</td><td><strong>{statusLabel[report.status]}</strong></td>{role === "LEAD" ? <td>{editable ? <div className="member-actions"><input aria-label={`${report.id} 审核原因`} value={reviewReasons[report.id] ?? ""} onChange={(event) => setReviewReasons({ ...reviewReasons, [report.id]: event.target.value })} placeholder="更正或退回时必填原因" /><button type="button" className="member-primary small" disabled={busy === `approve-${report.id}`} onClick={() => { void onReview(report, "approve"); }}>确认</button><button type="button" className="member-text-action danger" disabled={busy === `return-${report.id}`} onClick={() => { void onReview(report, "return"); }}>退回</button></div> : <span>{report.reviewReason ?? (report.reviewedBy ? `已由 ${report.reviewedBy.name} 确认` : "—")}</span>}</td> : <td>{report.reviewReason ?? (report.status === "PENDING" ? "等待组长审核" : "—")}</td>}</tr>;
  })}{!reports.length ? <tr><td colSpan={role === "LEAD" ? 7 : 6}>暂无扣粉登记</td></tr> : null}</tbody></table></div>;
}
