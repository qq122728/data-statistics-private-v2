"use client";

import { useCallback, useEffect, useState } from "react";
import { requestJson } from "@/lib/backend";
import { ConfirmDialog, type Confirm } from "./ConfirmDialog";
import { IconCheck, IconClock, IconMinus, IconUsers } from "./Icons";

type HistoricalStage = "NOT_REPLIED" | "REPLIED" | "JOINED" | "INTRODUCED" | "REGISTERED";
type Person = { id: string; name: string } | null;
type HistoricalClaim = {
  id: string;
  phone: string;
  customerName: string | null;
  historicalSourceName: string | null;
  historicalBaselineStage: HistoricalStage | null;
  notes: string | null;
  createdAt: string;
  owner: Person;
  groupOperatorOwner: Person;
  expertOwner: Person;
  batch: { sourceDate: string };
};

type ClaimsResponse = { claims: HistoricalClaim[] };
type ReviewResponse = { status: number; reviewStatus: "APPROVED" | "RETURNED" };

const stageMeta: Record<HistoricalStage, { label: string; role: string; todo: string }> = {
  NOT_REPLIED: { label: "待回复", role: "接粉", todo: "审核后进入接粉待回复" },
  REPLIED: { label: "已回复、待入群", role: "接粉", todo: "审核后进入接粉待入群" },
  JOINED: { label: "已进群", role: "炒群", todo: "审核后进入炒群待推专家" },
  INTRODUCED: { label: "已推专家", role: "专家", todo: "审核后进入专家待注册" },
  REGISTERED: { label: "已注册", role: "专家", todo: "审核后进入专家待开单" },
};

function currentOwner(claim: HistoricalClaim) {
  const stage = claim.historicalBaselineStage;
  if (stage === "NOT_REPLIED" || stage === "REPLIED") return claim.owner;
  if (stage === "JOINED") return claim.groupOperatorOwner;
  return claim.expertOwner;
}

function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 组长的真实历史客户审核队列。
 *
 * 这是独立组件，主页面只需在组长审核页渲染 <RealHistoricalCustomerReview />；
 * 数据范围与权限完全由后端按当前登录组长的小组重新校验。
 */
export function RealHistoricalCustomerReview() {
  const [claims, setClaims] = useState<HistoricalClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const loadClaims = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await requestJson<ClaimsResponse>("/api/historical-claims/review");
      setClaims(payload.claims);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "历史客户审核列表加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadClaims(); }, [loadClaims]);

  async function submitReview(claim: HistoricalClaim, decision: "APPROVE" | "RETURN", reason = "") {
    if (busyId) return;
    setBusyId(claim.id);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson<ReviewResponse>("/api/historical-claims/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: claim.id, decision, ...(reason ? { reason } : {}) }),
      });
      setClaims((rows) => rows.filter((row) => row.id !== claim.id));
      setNotice(result.reviewStatus === "APPROVED"
        ? `${claim.customerName || claim.phone} 已审核通过，现已进入对应岗位待办。`
        : `${claim.customerName || claim.phone} 已退回，不会进入待办或业绩。`);
      setConfirm(null);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "审核失败，请刷新后重试");
      setConfirm(null);
    } finally {
      setBusyId(null);
    }
  }

  function askApprove(claim: HistoricalClaim) {
    const meta = claim.historicalBaselineStage ? stageMeta[claim.historicalBaselineStage] : null;
    setConfirm({
      title: "确认通过历史客户认领",
      confirmLabel: "确认通过",
      target: `${claim.customerName || "未填写姓名"} · ${claim.phone}`,
      desc: `${meta?.label ?? "未知阶段"}属于启用前历史底账，不补算以前的业绩；${meta?.todo ?? "通过后进入对应岗位待办"}，之后新发生的动作才正常计入业绩。`,
      onConfirm: () => { void submitReview(claim, "APPROVE"); },
    });
  }

  function askReturn(claim: HistoricalClaim) {
    setConfirm({
      title: "确认退回历史客户认领",
      confirmLabel: "确认退回",
      target: `${claim.customerName || "未填写姓名"} · ${claim.phone}`,
      desc: "退回后客户仍保持锁定，不进入任何人的待办、业绩或报表。提交人需要按退回原因修正。",
      danger: true,
      reasonLabel: "退回原因 *",
      reasonPlaceholder: "例如：当前阶段不对、负责人不对、历史日期需要核实",
      reasonRequired: true,
      onConfirm: (reason) => { void submitReview(claim, "RETURN", reason); },
    });
  }

  return (
    <>
      <section className="card" aria-labelledby="historical-review-title">
        <div className="card-head">
          <div>
            <h2 id="historical-review-title" className="card-title">历史客户认领审核</h2>
            <p className="card-note">这里只显示当前小组的待审核记录。审核前客户被锁住，不进待办、不算业绩。</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="badge" data-tone={claims.length ? "warn" : "ok"}>待审核 {claims.length}</span>
            <button type="button" className="btn" data-size="sm" disabled={loading || Boolean(busyId)} onClick={() => void loadClaims()}>
              {loading ? "刷新中…" : "刷新"}
            </button>
          </div>
        </div>

        {error ? (
          <div role="alert" style={{ margin: "12px 16px", padding: "10px 12px", borderRadius: "var(--radius)", background: "var(--bad-soft)", color: "var(--bad)", fontSize: 13.5 }}>
            {error} <button type="button" className="btn" data-size="sm" onClick={() => void loadClaims()}>重新加载</button>
          </div>
        ) : null}
        {notice ? (
          <div role="status" style={{ margin: "12px 16px", padding: "10px 12px", borderRadius: "var(--radius)", background: "var(--ok-soft)", color: "var(--ok)", fontSize: 13.5 }}>
            {notice}
          </div>
        ) : null}

        {loading && claims.length === 0 ? (
          <div style={{ padding: "34px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>正在读取本组待审核客户…</div>
        ) : claims.length === 0 ? (
          <div style={{ padding: "34px 16px", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>当前没有待审核的历史客户认领</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="data-table">
              <thead><tr><th>客户</th><th>认领岗位 / 当前阶段</th><th>真实归属</th><th>历史来源</th><th>备注</th><th>提交时间</th><th>操作</th></tr></thead>
              <tbody>{claims.map((claim) => {
                const stage = claim.historicalBaselineStage;
                const meta = stage ? stageMeta[stage] : null;
                const owner = currentOwner(claim);
                const busy = busyId === claim.id;
                return (
                  <tr key={claim.id}>
                    <td><strong>{claim.customerName || "未填写姓名"}</strong><div style={{ marginTop: 3, color: "var(--ink-3)" }}>{claim.phone}</div></td>
                    <td><span className="badge" data-tone="warn">{meta?.role ?? "待核实"}认领</span><div style={{ marginTop: 5 }}>{meta?.label ?? stage ?? "阶段缺失"}</div><small style={{ color: "var(--ink-3)" }}>历史日期 {claim.batch.sourceDate}</small></td>
                    <td><div style={{ display: "flex", alignItems: "center", gap: 5 }}><IconUsers size={14} />当前负责人：<strong>{owner?.name ?? "未指定"}</strong></div><small style={{ display: "block", marginTop: 4, color: "var(--ink-3)", lineHeight: 1.6 }}>接粉 {claim.owner?.name ?? "—"} · 炒群 {claim.groupOperatorOwner?.name ?? "—"} · 专家 {claim.expertOwner?.name ?? "—"}</small></td>
                    <td>{claim.historicalSourceName || "未填写"}</td>
                    <td style={{ maxWidth: 260, whiteSpace: "normal", lineHeight: 1.6 }}>{claim.notes || "—"}</td>
                    <td><div style={{ display: "flex", alignItems: "center", gap: 5 }}><IconClock size={14} />{displayTime(claim.createdAt)}</div></td>
                    <td><div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      <button type="button" className="btn" data-size="sm" data-variant="primary" disabled={busy || Boolean(busyId)} onClick={() => askApprove(claim)}><IconCheck size={13} />{busy ? "处理中…" : "通过"}</button>
                      <button type="button" className="btn" data-size="sm" disabled={busy || Boolean(busyId)} onClick={() => askReturn(claim)}><IconMinus size={13} />退回</button>
                    </div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        )}
      </section>
      <ConfirmDialog confirm={confirm} onClose={() => { if (!busyId) setConfirm(null); }} />
    </>
  );
}
