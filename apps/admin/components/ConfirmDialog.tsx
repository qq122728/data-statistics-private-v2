"use client";

import { useEffect, useRef, useState } from "react";
import { IconAlert } from "./Icons";

export type Confirm = {
  title: string;
  desc: string;
  confirmLabel: string;
  target?: string;
  danger?: boolean;
  /** 需要填原因时给出标签；旧系统里撤销/归档/误录都必须填 */
  reasonLabel?: string;
  reasonPlaceholder?: string;
  /** 默认必填；原因下拉已经选了分类、只是想补充说明时，把这个设成 false */
  reasonRequired?: boolean;
  /** 需要填数字时给出标签（手动归档要填实际回访次数） */
  numberLabel?: string;
  defaultNumber?: string;
  /** 需要用户明确选一个分类时给出选项——不要从填的原因文字里猜（改判无效库分低金额/无WhatsApp两种） */
  kindLabel?: string;
  kindOptions?: Array<{ value: string; label: string }>;
  defaultKind?: string;
  /** 需要填日期时给出标签——专家阶段推进大多要求实际发生日期，不是系统自动盖章 */
  dateLabel?: string;
  defaultDate?: string;
  onConfirm: (reason: string, num?: number, kind?: string, date?: string) => void;
};

export function ConfirmDialog({
  confirm,
  onClose,
}: {
  confirm: Confirm | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [num, setNum] = useState("");
  const [kind, setKind] = useState("");
  const [date, setDate] = useState("");
  const [phase, setPhase] = useState<"form" | "review">("form");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setReason("");
    setNum(confirm?.defaultNumber ?? "");
    setKind(confirm?.defaultKind ?? confirm?.kindOptions?.[0]?.value ?? "");
    setDate(confirm?.defaultDate ?? "");
    setPhase("form");
  }, [confirm]);

  useEffect(() => {
    if (!confirm) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => {
      boxRef.current?.querySelector<HTMLElement>("textarea, input, button")?.focus();
    }, 0);
    return () => { window.removeEventListener("keydown", onKey); clearTimeout(t); };
  }, [confirm, onClose]);

  if (!confirm) return null;

  const needReason = Boolean(confirm.reasonLabel);
  const needNum = Boolean(confirm.numberLabel);
  const needDate = Boolean(confirm.dateLabel);
  const reasonBad = needReason && confirm.reasonRequired !== false && !reason.trim();
  const numBad = needNum && !/^\d+$/.test(num);
  const dateBad = needDate && !date;

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
        background: "rgba(19,24,36,.42)",
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        style={{
          width: "100%", maxWidth: 420, background: "var(--surface)",
          border: "1px solid var(--line)", borderRadius: "var(--radius-lg)",
          boxShadow: "0 20px 50px rgba(19,24,36,.22)",
        }}
      >
        <div style={{ display: "flex", gap: 12, padding: "18px 20px 14px" }}>
          <span
            style={{
              width: 32, height: 32, borderRadius: 999, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: confirm.danger ? "var(--bad-soft)" : "var(--accent-soft)",
              color: confirm.danger ? "var(--bad)" : "var(--accent)",
            }}
          >
            <IconAlert size={18} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700 }}>{confirm.title}</h3>
            <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
              {confirm.desc}
            </p>
          </div>
        </div>

        {phase === "form" ? (
          <div style={{ padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            {confirm.target ? (
              <div
                style={{
                  padding: "9px 12px", borderRadius: "var(--radius)",
                  background: "var(--surface-sunken)", border: "1px solid var(--line)",
                  fontSize: 13.5,
                }}
              >
                <span style={{ color: "var(--ink-3)" }}>本次操作：</span>
                <strong>{confirm.target}</strong>
              </div>
            ) : null}

            {confirm.kindOptions?.length ? (
              <div>
                <label className="label">{confirm.kindLabel ?? "类型"}</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {confirm.kindOptions.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setKind(o.value)}
                      style={{
                        height: 30, padding: "0 12px", borderRadius: 999, cursor: "pointer",
                        fontSize: 13, fontWeight: 600,
                        border: `1px solid ${kind === o.value ? "var(--accent)" : "var(--line-strong)"}`,
                        background: kind === o.value ? "var(--accent-soft)" : "var(--surface)",
                        color: kind === o.value ? "var(--accent)" : "var(--ink-2)",
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {needDate ? (
              <div>
                <label className="label">{confirm.dateLabel}</label>
                <input
                  className="field" style={{ width: "100%" }} type="date"
                  value={date} onChange={(e) => setDate(e.target.value)}
                />
              </div>
            ) : null}

            {needNum ? (
              <div>
                <label className="label">{confirm.numberLabel}</label>
                <input
                  className="field" style={{ width: "100%" }} inputMode="numeric"
                  value={num} onChange={(e) => setNum(e.target.value)}
                />
              </div>
            ) : null}

            {needReason ? (
              <div>
                <label className="label">{confirm.reasonLabel}</label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={confirm.reasonPlaceholder ?? "填写原因，方便以后核对"}
                  rows={3}
                  style={{
                    width: "100%", padding: "9px 11px", resize: "vertical",
                    border: "1px solid var(--line-strong)", borderRadius: "var(--radius)",
                    fontSize: 13.5, outline: "none",
                  }}
                />
              </div>
            ) : null}

            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
              点下面的按钮之后才会真正保存。
            </p>
          </div>
        ) : (
          <div style={{ padding: "0 20px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
              请再确认一遍，点击「{confirm.confirmLabel}」后立刻生效：
            </p>
            <div
              style={{
                padding: "9px 12px", borderRadius: "var(--radius)",
                background: "var(--surface-sunken)", border: "1px solid var(--line)",
                display: "flex", flexDirection: "column", gap: 8,
              }}
            >
              {confirm.target ? <SummaryRow label="操作对象" value={confirm.target} /> : null}
              {confirm.kindOptions?.length ? (
                <SummaryRow
                  label={confirm.kindLabel ?? "类型"}
                  value={confirm.kindOptions.find((o) => o.value === kind)?.label ?? kind ?? "（未选）"}
                />
              ) : null}
              {needDate ? <SummaryRow label={confirm.dateLabel ?? "日期"} value={date || "（未填）"} /> : null}
              {needNum ? <SummaryRow label={confirm.numberLabel ?? "数量"} value={num || "（未填）"} /> : null}
              {needReason ? (
                <SummaryRow label={confirm.reasonLabel ?? "原因"} value={reason.trim() || "（未填）"} />
              ) : null}
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex", justifyContent: "flex-end", gap: 8,
            padding: "13px 20px", borderTop: "1px solid var(--line)",
          }}
        >
          {phase === "form" ? (
            <>
              <button className="btn" onClick={onClose}>取消</button>
              <button
                className="btn"
                data-variant="primary"
                disabled={reasonBad || numBad || dateBad}
                onClick={() => setPhase("review")}
              >
                下一步
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={() => setPhase("form")}>返回修改</button>
              <button
                className="btn"
                data-variant="primary"
                style={confirm.danger ? { background: "var(--bad)", borderColor: "var(--bad)" } : undefined}
                onClick={() => confirm.onConfirm(reason.trim(), needNum ? Number(num) : undefined, kind || undefined, date || undefined)}
              >
                {confirm.confirmLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5 }}>
      <span style={{ color: "var(--ink-3)" }}>{label}</span>
      <strong style={{ color: "var(--ink)", textAlign: "right" }}>{value}</strong>
    </div>
  );
}
