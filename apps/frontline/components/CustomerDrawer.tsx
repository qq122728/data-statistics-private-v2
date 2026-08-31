"use client";

import { useEffect } from "react";
import { money, nextStepOf, stageOf, type Lead } from "@/lib/mock-data";

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 500 }}>{label}</dt>
      <dd style={{ margin: "2px 0 0", fontSize: 13.5, fontWeight: 500, wordBreak: "break-word" }}>
        {value}
      </dd>
    </div>
  );
}

function Section({ title, tint, children }: { title: string; tint?: boolean; children: React.ReactNode }) {
  return (
    <section
      style={{
        border: `1px solid ${tint ? "#cfdcf8" : "var(--line)"}`,
        background: tint ? "var(--accent-soft)" : "var(--surface-sunken)",
        borderRadius: "var(--radius)",
        padding: 15,
      }}
    >
      <h4 style={{ margin: "0 0 11px", fontSize: 13.5, fontWeight: 700 }}>{title}</h4>
      {children}
    </section>
  );
}

export function CustomerDrawer({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  useEffect(() => {
    if (!lead) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lead, onClose]);

  if (!lead) return null;
  const stage = stageOf(lead);

  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(19,24,36,.35)", display: "flex", justifyContent: "flex-end" }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(520px, 100%)", height: "100%", background: "var(--surface)",
          borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column",
          boxShadow: "-14px 0 40px rgba(19,24,36,.14)",
        }}
      >
        <header
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            padding: "16px 20px", borderBottom: "1px solid var(--line)",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{lead.phone}</h3>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--ink-3)" }}>
              {lead.name || "未填写姓名"} · 客户资料
            </p>
          </div>
          <button className="btn" data-size="sm" onClick={onClose}>关闭</button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <Section title="客户基本资料">
            <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 18px", margin: 0 }}>
              <Item label="客户编号" value={lead.phone} />
              <Item label="客户姓名" value={lead.name || <span className="muted">未填写</span>} />
              <Item label="客户邮箱" value={lead.email || <span className="muted">未填写</span>} />
              <Item label="接粉设备" value={lead.device || <span className="muted">未填写</span>} />
              <Item label="客户金额" value={money(lead.amountUsd)} />
              <Item label="客户平台" value={lead.platform || <span className="muted">未填写</span>} />
              <Item label="来源渠道" value={`${lead.sourceDate} · ${lead.channel}`} />
              <Item label="粉的归属" value={lead.attributionOwner ?? "陈小雨（我自己）"} />
            </dl>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
              <span style={{ color: "var(--ink-3)" }}>客户情况（接粉填写）：</span>
              <span>{lead.lastVisitNote ?? <span className="muted">未填写</span>}</span>
            </div>
          </Section>

          <Section title="当前交接情况" tint>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 18px", margin: 0 }}>
              <Item
                label="当前状态"
                value={<span className="badge" data-tone={stage.tone}>{stage.label}</span>}
              />
              <Item label="下一步" value={<strong style={{ color: "var(--accent)" }}>{nextStepOf(lead)}</strong>} />
              <Item label="炒群负责人" value={lead.groupOperator ?? <span className="muted">待分配</span>} />
              <Item label="专家负责人" value={lead.expertOwner ?? <span className="muted">尚未分配</span>} />
            </dl>
          </Section>

          <Section title="操作记录">
            {lead.history?.length ? (
              <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 9 }}>
                {lead.history.map((h, i) => (
                  <li key={i} style={{ fontSize: 13.5 }}>
                    <strong style={{ color: h.undone ? "var(--warn)" : "var(--ok)" }}>{h.action}</strong>
                    <span style={{ color: "var(--ink-2)" }}>
                      {" · "}{h.date} · {h.actor}
                      {h.note ? ` · ${h.note}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-3)" }}>还没有操作记录。</p>
            )}
          </Section>
        </div>
      </aside>
    </div>
  );
}
