"use client";

import { useEffect } from "react";
import { money, type DownstreamLead } from "@/lib/mock-data";

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

/** 客户进度页的"查看资料"——照抄接粉那边 CustomerDrawer 的样子，展示 DownstreamLead 已有的字段，纯只读 */
export function DownstreamDrawer({ lead, onClose }: { lead: DownstreamLead | null; onClose: () => void }) {
  useEffect(() => {
    if (!lead) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lead, onClose]);

  if (!lead) return null;

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
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{lead.code}</h3>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--ink-3)" }}>
              {lead.statusPhrase || "客户进度"} · 客户资料
            </p>
          </div>
          <button className="btn" data-size="sm" onClick={onClose}>关闭</button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <Section title="客户基本资料">
            <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 18px", margin: 0 }}>
              <Item label="客户编号" value={lead.code} />
              <Item label="来源渠道" value={`${lead.sourceDate} · ${lead.channel}`} />
              <Item label="粉的归属（接粉）" value={lead.attributionOwner} />
              <Item label="炒群负责人" value={lead.groupOperator} />
              <Item label="专家负责人" value={lead.expertOwner} />
              <Item label="当前进度" value={lead.daysNote} />
            </dl>
          </Section>

          <Section title="炒群 / 专家情况" tint>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, margin: 0 }}>
              <Item label="炒群最新进度" value={lead.groupProgressNote} />
              {lead.groupProgressMeta ? <Item label="记录时间" value={lead.groupProgressMeta} /> : null}
              <Item
                label="专家当前阶段"
                value={<span style={{ color: lead.expertStageWarn ? "var(--warn)" : "inherit", fontWeight: lead.expertStageWarn ? 700 : 500 }}>{lead.expertStage}</span>}
              />
              <Item label="专家情况" value={lead.expertNote} />
            </dl>
          </Section>

          <Section title="资金与业绩">
            <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 18px", margin: 0 }}>
              <Item label="首充" value={money(lead.depositUsd)} />
              <Item label="续充" value={`${lead.continuationCount} 次 · ${money(lead.continuationUsd)}`} />
              <Item label="出金" value={money(lead.withdrawalUsd)} />
              <Item
                label="当前净业绩"
                value={
                  <strong style={{ color: lead.netUsd >= 0 ? "var(--ok)" : "var(--bad)" }}>
                    {lead.netUsd >= 0 ? "" : "-"}{money(Math.abs(lead.netUsd))}
                  </strong>
                }
              />
            </dl>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)", fontSize: 13.5 }}>
              <span style={{ color: "var(--ink-3)" }}>{lead.summaryLine}</span>
            </div>
          </Section>
        </div>
      </aside>
    </div>
  );
}
