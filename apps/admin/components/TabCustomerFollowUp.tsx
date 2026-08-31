"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { FinanceDrawer } from "./FinanceDrawer";
import { Modal } from "./Modal";
import { IconCheck, IconEdit, IconPlus } from "./Icons";
import {
  CATEGORY_META, CATEGORY_ORDER, CLAIM_BASELINE_META, CLAIM_BASELINE_ORDER, EXPERT_STAGE_ORDER, EXPERT_STAGE_WARN,
  LEAD_NAME, MAIN_CHAIN_REVERT, TODAY, effectiveExpertId, memberById, money,
  type ClaimBaseline, type DownstreamCategory, type DownstreamLead, type ExpertStage, type Member, type MoneyEvent, type RepliedPendingGroupCustomer,
} from "@/lib/mock-data";

type SubTab = "reception" | "group" | "expert";

function Chip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 999,
      cursor: "pointer", fontSize: 13, fontWeight: 600,
      border: `1px solid ${active ? "var(--accent)" : "var(--line-strong)"}`,
      background: active ? "var(--accent-soft)" : "var(--surface)",
      color: active ? "var(--accent)" : "var(--ink-2)",
    }}>
      {label}
      <span className="tnum" style={{ fontSize: 12, color: active ? "var(--accent)" : "var(--ink-3)" }}>{count}</span>
    </button>
  );
}

function InfoRow({ label, children, warn }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 12.5 }}>
      <span style={{ color: "var(--ink-3)", flexShrink: 0 }}>{label}</span>
      <span style={{ color: warn ? "var(--warn)" : "var(--ink-2)", fontWeight: warn ? 700 : 400 }}>{children}</span>
    </div>
  );
}

function MoneyCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 11, color: "var(--ink-3)" }}>{label}</p>
      <p className="tnum" style={{ margin: "1px 0 0", fontSize: 13, fontWeight: 600 }}>{value}</p>
    </div>
  );
}

/** 客户/交接与负责人/最新进度/资金与业绩 4列——炒群进度（只读）和专家管理（自己名下的
 *  可操作）共用同一套结构，跟组员自己的炒群/专家工作台是同一张表，只是专家管理多一列"操作"，
 *  而且分给组长自己的客户，"专家情况"这块可以点开编辑——跟专家工作台里 canManageExpert
 *  能编辑专家情况是同一个道理，组长在这些客户上就是那个专家。"炒群最新进度"不归专家管，
 *  这边不能编。 */
function DownstreamRow({
  d, actions, editableExpertNote, editingNote, onStartEditNote, onSaveNote,
}: {
  d: DownstreamLead;
  actions?: React.ReactNode;
  editableExpertNote?: boolean;
  editingNote?: boolean;
  onStartEditNote?: () => void;
  onSaveNote?: (value: string) => void;
}) {
  return (
    <tr>
      <td>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 700 }}>{d.code}</span>
          {d.misrecorded ? <span className="badge" data-tone="bad">误录</span> : null}
        </div>
        <div style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13, marginTop: 2 }}>{d.statusPhrase}</div>
        <div style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 2 }}>{d.daysNote}</div>
      </td>
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <InfoRow label="粉的归属">{memberById(d.attributionOwnerId)?.name}</InfoRow>
          <InfoRow label="炒群负责人">{memberById(d.groupOperatorId)?.name}</InfoRow>
          <InfoRow label="专家负责人">{memberById(effectiveExpertId(d))?.name}{!d.expertOwnerId ? "（默认组长）" : ""}</InfoRow>
          <InfoRow label="专家当前阶段" warn={EXPERT_STAGE_WARN[d.expertStage]}>{d.expertStage}</InfoRow>
        </div>
      </td>
      <td>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>炒群最新进度</p>
          <p style={{ margin: 0, fontSize: 13, color: d.groupProgressNote ? "var(--ink)" : "var(--ink-3)" }}>
            {d.groupProgressNote || "暂无"}
          </p>
        </div>
        <div style={{ margin: "8px 0", borderTop: "1px dashed var(--line)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>专家情况</p>
            {editableExpertNote ? (
              <button
                onClick={onStartEditNote} title="点击编辑"
                style={{ all: "unset", cursor: "pointer", display: "inline-flex", color: "var(--ink-3)", padding: 2, borderRadius: 4 }}
              >
                <IconEdit size={12} />
              </button>
            ) : null}
          </div>
          {editableExpertNote && editingNote ? (
            <textarea
              autoFocus className="field" style={{ width: "100%", minHeight: 52, padding: "5px 11px", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
              defaultValue={d.expertNote}
              onBlur={(e) => onSaveNote?.(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") onSaveNote?.(d.expertNote); }}
            />
          ) : (
            <p
              onClick={editableExpertNote ? onStartEditNote : undefined}
              title={editableExpertNote ? "点击编辑" : undefined}
              style={{
                margin: 0, fontSize: 13, color: d.expertNote ? "var(--ink)" : "var(--ink-3)",
                cursor: editableExpertNote ? "text" : "default",
                borderBottom: editableExpertNote ? "1.5px dashed var(--line-strong)" : "none",
              }}
            >
              {d.expertNote || (editableExpertNote ? "点击填写专家情况" : "暂无")}
            </p>
          )}
        </div>
      </td>
      <td>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px 10px" }}>
          <MoneyCell label="首充" value={money(d.depositUsd)} />
          <MoneyCell label="续充" value={`${d.continuationCount} 次 · ${money(d.continuationUsd)}`} />
          <MoneyCell label="出金" value={money(d.withdrawalUsd)} />
        </div>
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600 }}>当前净业绩</span>
            <span className="tnum" style={{ fontSize: 14.5, fontWeight: 700, color: d.netUsd >= 0 ? "var(--ok)" : "var(--bad)" }}>
              {d.netUsd >= 0 ? "" : "-"}{money(Math.abs(d.netUsd))}
            </span>
          </div>
          <p style={{ margin: "3px 0 0", fontSize: 12, color: "var(--ink-3)" }}>{d.summaryLine}</p>
        </div>
      </td>
      {actions !== undefined ? (
        <td style={{ textAlign: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
            {actions || <span className="muted" style={{ fontSize: 12.5 }}>只读</span>}
          </div>
        </td>
      ) : null}
    </tr>
  );
}

/** 客户跟进——组长看全组客户在三段流水线上的进度，跟组员自己的接粉/炒群/专家工作台是
 *  同一份数据、同一套视觉，只是这里聚合了全组每个人的客户。接粉进度/炒群进度一律只读
 *  （一线自己的日常操作，组长看进度不代操作）；专家管理比较特殊：炒群推专家没指定具体
 *  的人时，默认是组长本人接（需求文档5.4），这部分归组长自己操作，跟其他专家名下的客户
 *  共用同一张表、同一份 DOWNSTREAM 数据，只是"操作"这一列只对分给自己的客户开放。 */
export function TabCustomerFollowUp({
  repliedPendingGroup, downstream, members, onAdvanceExpertStage, onClaimHistorical,
  onAddContinuation, onAddWithdrawal, onUndoLastMoneyEvent, onCancelOrder,
  onEditMoneyEvent, onEditFirstCharge, onUpdateExpertNote, onConfirm, readOnly = false,
}: {
  repliedPendingGroup: RepliedPendingGroupCustomer[];
  downstream: DownstreamLead[];
  members: Member[];
  onAdvanceExpertStage: (id: string, stage: ExpertStage, extra?: { firstChargeUsd?: number; firstChargeDate?: string }) => void;
  onClaimHistorical: (draft: {
    phone: string; name: string; channel: string; sourceDate: string;
    attributionOwnerId: string; groupOperatorId: string; expertOwnerId: string;
    baseline: ClaimBaseline; daysInGroup: number; stageEventDate: string;
    firstChargeUsd?: number; firstChargeDate?: string;
  }) => void;
  onUpdateExpertNote: (id: string, note: string) => void;
  onAddContinuation: (id: string, amountUsd: number, date: string) => void;
  onAddWithdrawal: (id: string, amountUsd: number, date: string) => void;
  onUndoLastMoneyEvent: (id: string) => void;
  onCancelOrder: (id: string) => void;
  onEditMoneyEvent: (id: string, eventId: string, amountUsd: number, date: string) => void;
  onEditFirstCharge: (id: string, amountUsd: number, date: string) => void;
  onConfirm: (c: Confirm) => void;
  /** 部门/公司/总公司管理员点进来只看——组长自己用这个组件时不传，走原来的可操作逻辑。
   *  为true时隐藏"认领老客户"、隐藏"操作"这一整列、专家情况也不能编辑，其它全部照旧。 */
  readOnly?: boolean;
}) {
  const [sub, setSub] = useState<SubTab>("reception");
  const [groupFilter, setGroupFilter] = useState<DownstreamCategory | "all">("all");
  const [expertStageFilter, setExpertStageFilter] = useState<ExpertStage | "all">("all");
  const [claimOpen, setClaimOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [financeDrawerId, setFinanceDrawerId] = useState<string | null>(null);
  const receptions = members.filter((m) => m.positions.includes("RECEPTION"));
  const groupOperators = members.filter((m) => m.positions.includes("GROUP_OPERATOR"));
  const experts = members.filter((m) => m.positions.includes("EXPERT"));
  const [claimDraft, setClaimDraft] = useState({
    phone: "", name: "", channel: "德国短信 A", sourceDate: TODAY,
    attributionOwnerId: receptions[0]?.id ?? "", groupOperatorId: groupOperators[0]?.id ?? "", expertOwnerId: "",
    baseline: "INTRODUCED" as ClaimBaseline, daysInGroup: "1", stageEventDate: "",
    firstChargeAmount: "", firstChargeDate: TODAY,
  });

  function askAdvance(d: DownstreamLead, toStage: ExpertStage, opts?: { needMoney?: boolean }) {
    if (opts?.needMoney) {
      onConfirm({
        title: "登记开单", confirmLabel: "确认登记", target: `${d.code}`,
        desc: "登记后客户状态转为「已开单」，首充金额会正式计入这个客户的资金记录。",
        dateLabel: "首充日期", defaultDate: TODAY,
        numberLabel: "首充金额（USD）",
        onConfirm: (_reason, num, _kind, date) => {
          onAdvanceExpertStage(d.id, toStage, { firstChargeUsd: num, firstChargeDate: date });
        },
      });
      return;
    }
    onConfirm({
      title: `标记：${toStage}`, confirmLabel: "确认", target: `${d.code}`,
      desc: `客户状态从「${d.expertStage}」推进到「${toStage}」，保存后立刻生效。`,
      onConfirm: () => onAdvanceExpertStage(d.id, toStage),
    });
  }

  function askRevert(d: DownstreamLead) {
    const back = MAIN_CHAIN_REVERT[d.expertStage];
    if (!back) return;
    onConfirm({
      title: "撤回上一步", confirmLabel: "确认撤回", target: `${d.code}`, danger: true,
      desc: `把状态从「${d.expertStage}」撤回到「${back}」，点错了能用这个改回来。`,
      onConfirm: () => onAdvanceExpertStage(d.id, back),
    });
  }

  function askAddContinuation(d: DownstreamLead) {
    onConfirm({
      title: "登记续充", confirmLabel: "确认登记", target: `${d.code}`,
      desc: "记一笔续充金额，会计入这位客户的续充合计和净业绩。",
      dateLabel: "续充日期", defaultDate: TODAY, numberLabel: "续充金额（USD）",
      onConfirm: (_reason, num, _kind, date) => {
        if (num) onAddContinuation(d.id, num, date ?? TODAY);
      },
    });
  }

  function askAddWithdrawal(d: DownstreamLead) {
    onConfirm({
      title: "登记出金", confirmLabel: "确认登记", target: `${d.code}`, danger: true,
      desc: "记一笔出金金额，会从这位客户的净业绩里扣除。",
      dateLabel: "出金日期", defaultDate: TODAY, numberLabel: "出金金额（USD）",
      onConfirm: (_reason, num, _kind, date) => {
        if (num) onAddWithdrawal(d.id, num, date ?? TODAY);
      },
    });
  }

  function askUndoLastMoneyEvent(d: DownstreamLead) {
    const events = d.moneyEvents ?? [];
    const last = events[events.length - 1];
    if (!last) return;
    onConfirm({
      title: `撤销最近一笔${last.kind}`, confirmLabel: "确认撤销", target: `${d.code}`, danger: true,
      desc: `会把 ${last.date} 录入的这笔${last.kind} $${last.amountUsd} 冲正。`,
      onConfirm: () => onUndoLastMoneyEvent(d.id),
    });
  }

  function askCancelOrder(d: DownstreamLead) {
    onConfirm({
      title: "撤销开单", confirmLabel: "确认撤销", target: `${d.code}`, danger: true,
      desc: `会把首充 $${d.firstChargeUsd ?? d.depositUsd} 从业绩里冲正，客户退回「待开单」。仅用于登记开单本身填错了的情况。`,
      onConfirm: () => onCancelOrder(d.id),
    });
  }

  function askEditFirstCharge(d: DownstreamLead) {
    onConfirm({
      title: "编辑这笔首充记录", confirmLabel: "保存修改", target: `${d.code}`, danger: true,
      desc: "修改这笔首充记录的金额和日期，保存后立刻影响这位客户的资金合计，请仔细核对。",
      dateLabel: "日期", defaultDate: d.firstChargeDate,
      numberLabel: "首充金额（USD）", defaultNumber: String(d.firstChargeUsd ?? 0),
      onConfirm: (_reason, num, _kind, date) => {
        onEditFirstCharge(d.id, num ?? d.firstChargeUsd ?? 0, date ?? d.firstChargeDate ?? TODAY);
      },
    });
  }

  function askEditMoneyEvent(d: DownstreamLead, event: MoneyEvent) {
    onConfirm({
      title: `编辑这笔${event.kind}记录`, confirmLabel: "保存修改", target: `${d.code}`, danger: true,
      desc: `修改这笔${event.kind}记录的金额和日期，保存后立刻影响这位客户的资金合计，请仔细核对。`,
      dateLabel: "日期", defaultDate: event.date,
      numberLabel: `${event.kind}金额（USD）`, defaultNumber: String(event.amountUsd),
      onConfirm: (_reason, num, _kind, date) => {
        onEditMoneyEvent(d.id, event.id, num ?? event.amountUsd, date ?? event.date);
      },
    });
  }

  function expertActions(d: DownstreamLead) {
    if (effectiveExpertId(d) !== "m-lead") return null;
    if (d.expertStage === "排队中") {
      return <button className="btn" data-size="sm" data-variant="primary" onClick={() => askAdvance(d, "交资料")}>开始接待</button>;
    }
    if (d.expertStage === "交资料") {
      return <>
        <button className="btn" data-size="sm" data-variant="primary" onClick={() => askAdvance(d, "追踪中")}>资料已交 · 开始追踪</button>
        <button className="btn" data-size="sm" onClick={() => askRevert(d)}>撤回上一步</button>
      </>;
    }
    if (d.expertStage === "追踪中") {
      return <>
        <button className="btn" data-size="sm" data-variant="primary" onClick={() => askAdvance(d, "待注册")}>转为待注册</button>
        <button className="btn" data-size="sm" onClick={() => askRevert(d)}>撤回上一步</button>
      </>;
    }
    if (d.expertStage === "待注册") {
      return <>
        <button className="btn" data-size="sm" data-variant="primary" onClick={() => askAdvance(d, "待开单")}>标记已注册</button>
        <button className="btn" data-size="sm" onClick={() => askRevert(d)}>撤回上一步</button>
      </>;
    }
    if (d.expertStage === "待开单") {
      return <>
        <button className="btn" data-size="sm" data-variant="primary" onClick={() => askAdvance(d, "已开单", { needMoney: true })}>
          <IconCheck size={13} />登记开单
        </button>
        <button className="btn" data-size="sm" onClick={() => askAdvance(d, "未成交")}>不首充</button>
        <button className="btn" data-size="sm" onClick={() => askRevert(d)}>撤回上一步</button>
      </>;
    }
    if (d.expertStage === "未成交") {
      return <button className="btn" data-size="sm" data-variant="primary" onClick={() => askAdvance(d, "待开单")}>恢复首充跟进</button>;
    }
    if (d.expertStage === "已开单") {
      const hasEvents = (d.moneyEvents ?? []).length > 0;
      return <>
        <button className="btn" data-size="sm" data-variant="primary" onClick={() => setFinanceDrawerId(d.id)}>财务明细</button>
        <button className="btn" data-size="sm" onClick={() => askAddContinuation(d)}>+ 续充</button>
        <button className="btn" data-size="sm" onClick={() => askAddWithdrawal(d)}>+ 出金</button>
        {hasEvents ? <button className="btn" data-size="sm" onClick={() => askUndoLastMoneyEvent(d)}>撤销上一笔</button> : null}
        {d.firstChargeUsd ? <button className="btn" data-size="sm" onClick={() => askCancelOrder(d)}>撤销开单</button> : null}
        <button className="btn" data-size="sm" onClick={() => askAdvance(d, "停止维护")}>停止维护</button>
      </>;
    }
    if (d.expertStage === "停止维护") {
      return <button className="btn" data-size="sm" data-variant="primary" onClick={() => askAdvance(d, "已开单")}>恢复跟进</button>;
    }
    return null;
  }

  function submitClaim() {
    const phone = claimDraft.phone.trim();
    if (!phone) return;
    const needMoney = claimDraft.baseline === "ORDERED";
    const firstChargeAmount = Number(claimDraft.firstChargeAmount);
    if (needMoney && !(firstChargeAmount > 0)) return;
    const meta = CLAIM_BASELINE_META[claimDraft.baseline];
    onConfirm({
      title: "确认认领老客户", confirmLabel: "确认认领", target: `${claimDraft.name || phone}（${meta.label}）`,
      desc: `认领后直接进入「${meta.stage}」，可以正常继续跟进。`,
      onConfirm: () => {
        onClaimHistorical({
          phone, name: claimDraft.name.trim(), channel: claimDraft.channel, sourceDate: claimDraft.sourceDate,
          attributionOwnerId: claimDraft.attributionOwnerId, groupOperatorId: claimDraft.groupOperatorId,
          expertOwnerId: claimDraft.expertOwnerId,
          baseline: claimDraft.baseline, daysInGroup: Number(claimDraft.daysInGroup) || 1,
          stageEventDate: claimDraft.stageEventDate,
          firstChargeUsd: needMoney ? firstChargeAmount : undefined,
          firstChargeDate: needMoney ? claimDraft.firstChargeDate : undefined,
        });
        setClaimOpen(false);
        setClaimDraft({
          phone: "", name: "", channel: "德国短信 A", sourceDate: TODAY,
          attributionOwnerId: receptions[0]?.id ?? "", groupOperatorId: groupOperators[0]?.id ?? "", expertOwnerId: "",
          baseline: "INTRODUCED", daysInGroup: "1", stageEventDate: "",
          firstChargeAmount: "", firstChargeDate: TODAY,
        });
      },
    });
  }

  const groupFiltered = groupFilter === "all" ? downstream : downstream.filter((d) => d.category === groupFilter);
  const groupCounts = CATEGORY_ORDER.reduce((acc, c) => {
    acc[c] = downstream.filter((d) => d.category === c).length;
    return acc;
  }, {} as Record<DownstreamCategory, number>);

  const expertEligible = downstream.filter((d) => d.category === "expertQueue" || d.category === "expertWorking" || d.category === "ordered");
  const expertRows = expertStageFilter === "all" ? expertEligible : expertEligible.filter((d) => d.expertStage === expertStageFilter);
  const expertStageCounts = EXPERT_STAGE_ORDER.reduce((acc, s) => {
    acc[s] = expertEligible.filter((d) => d.expertStage === s).length;
    return acc;
  }, {} as Record<ExpertStage, number>);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* data-size="sm" ——这一排是"客户进度"这个一级标签下面的二级标签（接粉/炒群/
          专家管理），外层 GroupBusinessTabs 的三个一级标签用的是常规尺寸按钮，这里刻意
          缩小一档 + 外层再包一层缩进边框，让两级标签在视觉上分得开，不是六个按钮平铺
          在一起。 */}
      <div style={{ display: "flex", gap: 8 }}>
        {([["reception", "接粉进度"], ["group", "炒群进度"], ["expert", "专家管理"]] as const).map(([id, label]) => (
          <button key={id} className="btn" data-size="sm" data-variant={sub === id ? "primary" : undefined} onClick={() => setSub(id)}>
            {label}
          </button>
        ))}
      </div>

      {sub === "reception" ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="card-head">
            <div>
              <h2 className="card-title">接粉进度</h2>
              <p className="card-note">组员已经回复、还没拉群的客户——只读，接粉自己在工作台里操作确认入群</p>
            </div>
            <span className="badge" data-tone="mute">只读</span>
          </div>
          <div className="table-scroll">
            <table className="grid-table">
              <thead>
                <tr>
                  <th style={{ width: 132, textAlign: "center" }}>手机号</th>
                  <th style={{ width: 118, textAlign: "center" }}>来源</th>
                  <th style={{ width: 220 }}>客户资料</th>
                  <th style={{ width: 190 }}>客户情况</th>
                  <th style={{ width: 100, textAlign: "center" }}>已回复</th>
                  <th style={{ width: 110, textAlign: "center" }}>接粉负责人</th>
                  <th style={{ width: 110, textAlign: "center" }}>炒群负责人</th>
                </tr>
              </thead>
              <tbody>
                {repliedPendingGroup.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700, whiteSpace: "nowrap", textAlign: "center" }}>{c.code}</td>
                    <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap", fontSize: 12.5, textAlign: "center" }}>
                      {c.channel}<br /><span style={{ color: "var(--ink-3)" }}>{c.sourceDate}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        <strong style={{ fontSize: 13.5 }}>{c.name}</strong>
                        <InfoRow label="邮箱">{c.email}</InfoRow>
                        <InfoRow label="金额">{money(c.amountUsd)}</InfoRow>
                        <InfoRow label="平台">{c.platform}</InfoRow>
                      </div>
                    </td>
                    <td style={{ color: "var(--ink-2)", fontSize: 13 }}>{c.note}</td>
                    <td style={{ textAlign: "center", color: "var(--ink-2)", fontSize: 13 }}>{c.repliedAt}</td>
                    <td style={{ textAlign: "center", fontSize: 13 }}>{memberById(c.attributionOwnerId)?.name}</td>
                    <td style={{ textAlign: "center", fontSize: 13 }}>{memberById(c.groupOperatorId)?.name}</td>
                  </tr>
                ))}
                {!repliedPendingGroup.length ? (
                  <tr><td colSpan={7} style={{ padding: "44px 0", textAlign: "center", color: "var(--ink-3)" }}>暂无数据</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {sub === "group" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Chip active={groupFilter === "all"} label="全部" count={downstream.length} onClick={() => setGroupFilter("all")} />
            {CATEGORY_ORDER.map((c) => (
              <Chip key={c} active={groupFilter === c} label={CATEGORY_META[c]} count={groupCounts[c]} onClick={() => setGroupFilter(c)} />
            ))}
            <span className="badge" data-tone="mute" style={{ marginLeft: "auto" }}>全部只读</span>
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="table-scroll">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>客户</th>
                    <th style={{ width: 190 }}>交接与负责人</th>
                    <th style={{ width: 260 }}>最新进度</th>
                    <th style={{ width: 210 }}>资金与业绩</th>
                  </tr>
                </thead>
                <tbody>
                  {groupFiltered.map((d) => <DownstreamRow key={d.id} d={d} />)}
                  {!groupFiltered.length ? (
                    <tr><td colSpan={4} style={{ padding: "44px 0", textAlign: "center", color: "var(--ink-3)" }}>这个分类下没有客户</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {sub === "expert" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Chip active={expertStageFilter === "all"} label="全部" count={expertEligible.length} onClick={() => setExpertStageFilter("all")} />
            {EXPERT_STAGE_ORDER.map((s) => (
              <Chip key={s} active={expertStageFilter === s} label={s} count={expertStageCounts[s]} onClick={() => setExpertStageFilter(s)} />
            ))}
            {!readOnly ? (
              <button className="btn" data-size="sm" onClick={() => setClaimOpen(true)}>
                <IconPlus size={13} />认领老客户
              </button>
            ) : null}
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
            {readOnly
              ? "炒群没指定专家时默认组长接——这里只读，看不到操作按钮"
              : `炒群没指定专家时默认我（${LEAD_NAME}）接——只有分给我的客户能操作，其他专家名下的只能看`}
          </p>
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="table-scroll">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>客户</th>
                    <th style={{ width: 190 }}>交接与负责人</th>
                    <th style={{ width: 240 }}>最新进度</th>
                    <th style={{ width: 200 }}>资金与业绩</th>
                    {!readOnly ? <th style={{ width: 150, textAlign: "center" }}>操作</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {expertRows.map((d) => (
                    <DownstreamRow key={d.id} d={d} actions={readOnly ? undefined : expertActions(d)}
                      editableExpertNote={!readOnly && effectiveExpertId(d) === "m-lead"}
                      editingNote={editingNoteId === d.id}
                      onStartEditNote={() => setEditingNoteId(d.id)}
                      onSaveNote={(value) => { onUpdateExpertNote(d.id, value); setEditingNoteId(null); }}
                    />
                  ))}
                  {!expertRows.length ? (
                    <tr><td colSpan={5} style={{ padding: "44px 0", textAlign: "center", color: "var(--ink-3)" }}>这个阶段下没有客户</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      <Modal open={claimOpen} onClose={() => setClaimOpen(false)} title="认领老客户" width={520}
        note="认领系统启用前就已经推过专家的老客户，认领之后直接进入对应真实状态，可以正常继续跟进。">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="label">手机号 *</label>
              <input className="field" style={{ width: "100%" }} placeholder="必填"
                value={claimDraft.phone} onChange={(e) => setClaimDraft({ ...claimDraft, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">姓名</label>
              <input className="field" style={{ width: "100%" }}
                value={claimDraft.name} onChange={(e) => setClaimDraft({ ...claimDraft, name: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">客户阶段 *</label>
            <div style={{ display: "flex", gap: 6 }}>
              {CLAIM_BASELINE_ORDER.map((b) => (
                <button key={b} type="button" className="btn" data-size="sm"
                  data-variant={claimDraft.baseline === b ? "primary" : undefined}
                  onClick={() => setClaimDraft({ ...claimDraft, baseline: b })}>
                  {CLAIM_BASELINE_META[b].label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label className="label">接粉归属</label>
              <select className="field" style={{ width: "100%" }}
                value={claimDraft.attributionOwnerId} onChange={(e) => setClaimDraft({ ...claimDraft, attributionOwnerId: e.target.value })}>
                {receptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">炒群归属</label>
              <select className="field" style={{ width: "100%" }}
                value={claimDraft.groupOperatorId} onChange={(e) => setClaimDraft({ ...claimDraft, groupOperatorId: e.target.value })}>
                {groupOperators.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">专家归属</label>
              <select className="field" style={{ width: "100%" }}
                value={claimDraft.expertOwnerId} onChange={(e) => setClaimDraft({ ...claimDraft, expertOwnerId: e.target.value })}>
                <option value="">未指定（默认我自己）</option>
                {experts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="label">在群天数</label>
              <input className="field" style={{ width: "100%" }} inputMode="numeric"
                value={claimDraft.daysInGroup} onChange={(e) => setClaimDraft({ ...claimDraft, daysInGroup: e.target.value })} />
            </div>
            <div>
              <label className="label">{claimDraft.baseline === "INTRODUCED" ? "推专家日期" : claimDraft.baseline === "REGISTERED" ? "注册日期" : "发生日期"}</label>
              <input className="field" type="date" style={{ width: "100%" }}
                value={claimDraft.stageEventDate} onChange={(e) => setClaimDraft({ ...claimDraft, stageEventDate: e.target.value })} />
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>不填日期默认今天——来源批次的日期不代表这一步真正发生的时间</p>

          {claimDraft.baseline === "ORDERED" ? (
            <div style={{ border: "1px dashed var(--line-strong)", borderRadius: "var(--radius)", padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label className="label">首充金额（USD）*</label>
                <input className="field" style={{ width: "100%" }} inputMode="numeric" placeholder="必填"
                  value={claimDraft.firstChargeAmount} onChange={(e) => setClaimDraft({ ...claimDraft, firstChargeAmount: e.target.value })} />
              </div>
              <div>
                <label className="label">首充日期 *</label>
                <input className="field" type="date" style={{ width: "100%" }}
                  value={claimDraft.firstChargeDate} onChange={(e) => setClaimDraft({ ...claimDraft, firstChargeDate: e.target.value })} />
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setClaimOpen(false)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitClaim}>
              <IconCheck size={15} />认领
            </button>
          </div>
        </div>
      </Modal>

      <FinanceDrawer
        lead={financeDrawerId ? downstream.find((x) => x.id === financeDrawerId) ?? null : null}
        onClose={() => setFinanceDrawerId(null)}
        onEditFirstCharge={askEditFirstCharge}
        onEditMoneyEvent={askEditMoneyEvent}
      />
    </div>
  );
}
