"use client";

import { memberById, money, type DownstreamLead, type MoneyEvent } from "@/lib/mock-data";

const MONEY_KIND_TONE: Record<string, "ok" | "bad"> = { 首充: "ok", 续充: "ok", 出金: "bad" };

/** 财务明细——组长点"已开单"客户的这个入口，看这位客户每一笔首充/续充/出金，金额或日期
 *  录错了可以逐笔编辑（不是只能撤销最近一笔）。跟专家工作台的财务明细是同一套结构。 */
export function FinanceDrawer({
  lead, onClose, onEditFirstCharge, onEditMoneyEvent,
}: {
  lead: DownstreamLead | null;
  onClose: () => void;
  onEditFirstCharge: (lead: DownstreamLead) => void;
  onEditMoneyEvent: (lead: DownstreamLead, event: MoneyEvent) => void;
}) {
  if (!lead) return null;
  const events = lead.moneyEvents ?? [];
  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(19,24,36,.35)", display: "flex", justifyContent: "flex-end" }}
    >
      <aside
        role="dialog" aria-modal="true"
        style={{
          width: "min(440px, 100%)", height: "100%", background: "var(--surface)",
          borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column",
          boxShadow: "-14px 0 40px rgba(19,24,36,.14)",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{lead.code} · 财务明细</h3>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--ink-3)" }}>
              首充 {money(lead.depositUsd)} · 续充 {lead.continuationCount} 次 {money(lead.continuationUsd)} · 出金 {money(lead.withdrawalUsd)}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
              专家：{memberById(lead.expertOwnerId ?? "m-lead")?.name}{!lead.expertOwnerId ? "（默认组长）" : ""}
            </p>
          </div>
          <button className="btn" data-size="sm" onClick={onClose}>关闭</button>
        </header>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px" }}>
          {lead.firstChargeUsd ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="badge" data-tone={MONEY_KIND_TONE.首充}>首充</span>
                <div>
                  <p className="tnum" style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{money(lead.firstChargeUsd)}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{lead.firstChargeDate}</p>
                </div>
              </div>
              <button className="btn" data-size="sm" onClick={() => onEditFirstCharge(lead)}>编辑</button>
            </div>
          ) : null}
          {events.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="badge" data-tone={MONEY_KIND_TONE[e.kind]}>{e.kind}</span>
                <div>
                  <p className="tnum" style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{money(e.amountUsd)}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{e.date}</p>
                </div>
              </div>
              <button className="btn" data-size="sm" onClick={() => onEditMoneyEvent(lead, e)}>编辑</button>
            </div>
          ))}
          {!lead.firstChargeUsd && !events.length ? (
            <p style={{ padding: "20px 0", color: "var(--ink-3)", fontSize: 13.5, lineHeight: 1.6 }}>
              没有逐笔流水——这个客户的首充/续充/出金没有单独记录，暂时不支持编辑。
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
