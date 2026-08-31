"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { IconCheck, IconMinus } from "./Icons";
import { memberById, type ReviewItem } from "@/lib/mock-data";

/** 审核中心——废号审核（3.2：接粉报的数量必须组长确认才计入正式统计）和历史客户补录
 *  审核（7.3：统一由组长补录，必须组长审核才生效），两种都是 PENDING/APPROVED/RETURNED，
 *  合并成一个队列，未审核前都不进任何报表。 */
export function TabReview({
  queue, onApprove, onReturn, onConfirm,
}: {
  queue: ReviewItem[];
  onApprove: (id: string, note: string, corrected?: { noWs: number; lowAmount: number; collision: number }) => void;
  onReturn: (id: string, reason: string) => void;
  onConfirm: (c: Confirm) => void;
}) {
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [editingCorrection, setEditingCorrection] = useState<Record<string, { noWs: string; lowAmount: string; collision: string }>>({});

  const rows = filter === "pending" ? queue.filter((r) => r.status === "PENDING") : queue;

  function askApprove(item: ReviewItem) {
    if (item.kind === "INVALID_FAN_BATCH") {
      const corr = editingCorrection[item.id];
      const noWs = corr ? Number(corr.noWs) : item.reportedNoWs;
      const lowAmount = corr ? Number(corr.lowAmount) : item.reportedLowAmount;
      const collision = corr ? Number(corr.collision) : item.reportedCollision;
      const changed = noWs !== item.reportedNoWs || lowAmount !== item.reportedLowAmount || collision !== item.reportedCollision;
      onConfirm({
        title: "确认审核通过", confirmLabel: "确认通过", target: item.batchLabel,
        desc: changed
          ? `数量有修正：无WS ${item.reportedNoWs}→${noWs}，低金额 ${item.reportedLowAmount}→${lowAmount}，撞粉 ${item.reportedCollision}→${collision}。通过后计入正式统计。`
          : "数量无修改，按原样通过，计入正式统计。",
        reasonLabel: changed ? "修正说明 *" : undefined, reasonRequired: true,
        onConfirm: (reason) => {
          onApprove(item.id, reason, { noWs, lowAmount, collision });
        },
      });
    } else {
      onConfirm({
        title: "确认审核通过", confirmLabel: "确认通过", target: `${item.customerName} · ${item.customerPhone}`,
        desc: `补录前状态"${item.baselineStage}"（${item.baselineDate}）只作背景记录，不计入业绩；通过后这条记录才会正式生效，之后的推进正常计入业绩。`,
        onConfirm: () => onApprove(item.id, ""),
      });
    }
  }

  function askReturn(item: ReviewItem) {
    onConfirm({
      title: "确认退回", confirmLabel: "确认退回", target: item.kind === "INVALID_FAN_BATCH" ? item.batchLabel : item.customerName,
      danger: true, desc: "退回后不计入统计，提交人需要修正后重新提交。",
      reasonLabel: "退回原因 *", reasonRequired: true,
      onConfirm: (reason) => onReturn(item.id, reason),
    });
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">审核中心</h2>
          <p className="card-note">废号数量审核 + 历史客户补录审核——都是未审核不计入任何报表，只有组长能审。</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn" data-size="sm" data-variant={filter === "pending" ? "primary" : undefined} onClick={() => setFilter("pending")}>
            待审核 {queue.filter((r) => r.status === "PENDING").length}
          </button>
          <button className="btn" data-size="sm" data-variant={filter === "all" ? "primary" : undefined} onClick={() => setFilter("all")}>
            全部
          </button>
        </div>
      </div>

      <div>
        {rows.length ? rows.map((item) => {
          const submitter = memberById(item.kind === "INVALID_FAN_BATCH" ? item.reporterId : item.submitterId);
          const corr = item.kind === "INVALID_FAN_BATCH" ? editingCorrection[item.id] : undefined;
          return (
            <div key={item.id} style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="badge" data-tone="mute">{item.kind === "INVALID_FAN_BATCH" ? "废号审核" : "历史补录"}</span>
                <strong style={{ fontSize: 14 }}>
                  {item.kind === "INVALID_FAN_BATCH" ? item.batchLabel : `${item.customerName} · ${item.customerPhone}`}
                </strong>
                <span className="badge" data-tone={item.status === "PENDING" ? "warn" : item.status === "APPROVED" ? "ok" : "bad"}>
                  {item.status === "PENDING" ? "待审核" : item.status === "APPROVED" ? "已通过" : "已退回"}
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
                {submitter?.name} 提交 · {item.submittedAt}
              </p>

              {item.kind === "INVALID_FAN_BATCH" ? (
                item.status === "PENDING" ? (
                  <div style={{ marginTop: 8, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
                    {([["无WS号码", "noWs", item.reportedNoWs], ["低金额", "lowAmount", item.reportedLowAmount], ["撞粉", "collision", item.reportedCollision]] as const).map(([label, key, reported]) => (
                      <div key={key}>
                        <label className="label">{label}（报 {reported}）</label>
                        <input className="field" style={{ width: 90 }} inputMode="numeric"
                          value={corr ? corr[key] : String(reported)}
                          onChange={(e) => {
                            const base = editingCorrection[item.id]
                              ?? { noWs: String(item.reportedNoWs), lowAmount: String(item.reportedLowAmount), collision: String(item.reportedCollision) };
                            setEditingCorrection({ ...editingCorrection, [item.id]: { ...base, [key]: e.target.value } });
                          }} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: "6px 0 0", fontSize: 13 }}>
                    无WS {item.approvedNoWs ?? item.reportedNoWs} · 低金额 {item.approvedLowAmount ?? item.reportedLowAmount} · 撞粉 {item.approvedCollision ?? item.reportedCollision}
                    {item.reviewReason ? <span style={{ color: "var(--ink-3)" }}>（{item.reviewReason}）</span> : null}
                  </p>
                )
              ) : (
                <p style={{ margin: "6px 0 0", fontSize: 13 }}>
                  补录前状态：{item.baselineStage} · {item.baselineDate}（只作背景，不计入业绩）
                  {item.reviewReason ? <span style={{ color: "var(--ink-3)" }}> · {item.reviewReason}</span> : null}
                </p>
              )}

              {item.status === "PENDING" ? (
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <button className="btn" data-size="sm" data-variant="primary" onClick={() => askApprove(item)}>
                    <IconCheck size={13} />通过
                  </button>
                  <button className="btn" data-size="sm" onClick={() => askReturn(item)}>
                    <IconMinus size={13} />退回
                  </button>
                </div>
              ) : null}
            </div>
          );
        }) : (
          <div style={{ padding: "30px 0", textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
            没有待审核的记录
          </div>
        )}
      </div>
    </div>
  );
}
