"use client";

import { useEffect, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import { Modal } from "./Modal";

type Stage = "reception" | "group" | "expert";
type ExpertStage = "QUEUED" | "MATERIALS" | "TRACKING" | "PENDING_REGISTRATION" | "PENDING_ORDER" | "DECLINED_DEPOSIT" | "ORDERED" | "STALLED";
type Owner = { id: string; name: string } | null;
type FinanceEvent = { id: string; kind: "RECHARGE" | "WITHDRAWAL"; amountCents: number | null; occurredOn: string; continuationNumber: number | null };
type Customer = {
  id: string; phone: string; customerName: string | null; customerEmail: string | null;
  lossAmountCents: number | null; customerPlatform: string | null; notes: string | null;
  repliedOn: string | null; followUpCount: number; lastFollowedUpOn: string | null;
  groupStatus: "NOT_JOINED" | "JOINED" | "LEFT"; joinedOn: string | null; leftOn: string | null; leftNote: string | null;
  expertIntroducedOn: string | null; expertContactedOn: string | null; expertContactNote: string | null;
  expertWorkflowStage: string | null; registeredOn: string | null; nextPlan: string | null; nextFollowUpOn: string | null;
  owner: Owner; groupOperatorOwner: Owner; expertOwner: Owner;
  batch: { id: string; sourceDate: string; channel: { name: string }; group: { name: string } };
  order: null | { id: string; openedOn: string; initialDepositCents: number; rechargeCents: number; withdrawalCents: number; nextContinuationNumber: number; financeEvents: FinanceEvent[] };
  activities: Array<{ id: string; kind: string; occurredOn: string; note: string | null; actor: { name: string } }>;
};
type Response = {
  stage: Stage; page: number; pageSize: number; total: number;
  today: string; timezone: string; counts: Record<Stage, number>;
  expertStage: ExpertStage | "all"; expertCounts: Record<ExpertStage, number>; customers: Customer[];
};

const STAGES: Array<{ value: Stage; label: string }> = [
  { value: "reception", label: "接粉进度" },
  { value: "group", label: "炒群进度" },
  { value: "expert", label: "专家管理" },
];
const EXPERT_STAGES: Array<{ value: ExpertStage | "all"; label: string }> = [
  { value: "all", label: "全部" }, { value: "QUEUED", label: "排队中" }, { value: "MATERIALS", label: "交资料" },
  { value: "TRACKING", label: "追踪中" }, { value: "PENDING_REGISTRATION", label: "待注册" },
  { value: "PENDING_ORDER", label: "待开单" }, { value: "DECLINED_DEPOSIT", label: "未成交" },
  { value: "ORDERED", label: "已开单" }, { value: "STALLED", label: "停止维护" },
];

function StageChip({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{
    display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 999,
    cursor: "pointer", fontSize: 13, fontWeight: 600,
    border: `1px solid ${active ? "var(--accent)" : "var(--line-strong)"}`,
    background: active ? "var(--accent-soft)" : "var(--surface)",
    color: active ? "var(--accent)" : "var(--ink-2)",
  }}>{label}<span className="tnum" style={{ fontSize: 12, color: active ? "var(--accent)" : "var(--ink-3)" }}>{count}</span></button>;
}

function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 6, fontSize: 12.5 }}><span style={{ color: "var(--ink-3)", flexShrink: 0 }}>{label}</span><span style={{ color: "var(--ink-2)" }}>{children}</span></div>;
}

function MoneyLine({ label, value }: { label: string; value: string }) {
  return <div><p style={{ margin: 0, fontSize: 11, color: "var(--ink-3)" }}>{label}</p><p className="tnum" style={{ margin: "1px 0 0", fontSize: 13, fontWeight: 600 }}>{value}</p></div>;
}
const money = (cents: number | null | undefined) => cents == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const expertStageLabel: Record<string, string> = {
  QUEUED: "排队中", MATERIALS: "交资料", TRACKING: "追踪中", PENDING_REGISTRATION: "待注册",
  PENDING_ORDER: "待开单", DECLINED_DEPOSIT: "未成交", ORDERED: "已开单", STALLED: "停止维护",
};
type ExpertAdvanceAction = "beginExpertReception" | "beginExpertTracking" | "markPendingRegistration" | "register";
type ExpertStateAction = ExpertAdvanceAction | "markNoInitialDeposit" | "clearNoInitialDeposit" | "markExpertStalled" | "clearExpertStalled";
const expertAdvanceMeta: Record<ExpertStateAction, { button: string; confirm: string }> = {
  beginExpertReception: { button: "开始接待", confirm: "确认专家已经开始接待？" },
  beginExpertTracking: { button: "开始追踪", confirm: "确认客户资料已交，开始追踪？" },
  markPendingRegistration: { button: "转待注册", confirm: "确认追踪完成，转为待注册？" },
  register: { button: "确认注册", confirm: "确认客户已经注册？" },
  markNoInitialDeposit: { button: "标记未成交", confirm: "确认这个已注册客户暂时不再推进首充？" },
  clearNoInitialDeposit: { button: "恢复首充跟进", confirm: "确认恢复到待开单继续跟进？" },
  markExpertStalled: { button: "停止维护", confirm: "确认这个已开单客户停止维护？" },
  clearExpertStalled: { button: "恢复维护", confirm: "确认恢复这个已开单客户的维护？" },
};

function expertConfirmButtonLabel(action: ExpertStateAction) {
  return action === "register" ? "确认注册" : `确认${expertAdvanceMeta[action].button}`;
}

type FinanceAction = "order" | "recharge" | "withdrawal";
type CorrectionWorkflowAction = "undoReply" | "undoJoinGroup" | "undoLeaveGroup" | "undoIntroduceExpert" | "undoExpertContacted" | "undoRegister" | "voidOrder";
type CorrectionTarget =
  | { kind: "workflow"; action: CorrectionWorkflowAction; label: string }
  | { kind: "finance"; event: FinanceEvent; label: string };

function dollarsToCents(value: string): number | null {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, decimal = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2_147_483_647 ? cents : null;
}

function correctionTargets(customer: Customer, stage: Stage): CorrectionTarget[] {
  if (stage === "reception") {
    return customer.repliedOn && customer.groupStatus === "NOT_JOINED"
      ? [{ kind: "workflow", action: "undoReply", label: "撤销回复" }]
      : [];
  }
  if (stage === "group") {
    if (customer.groupStatus === "LEFT") return [{ kind: "workflow", action: "undoLeaveGroup", label: "撤销退群" }];
    if (customer.groupStatus === "JOINED" && !customer.expertIntroducedOn) return [{ kind: "workflow", action: "undoJoinGroup", label: "撤销入群" }];
    return [];
  }
  if (customer.order) {
    const finance = customer.order.financeEvents.map((event): CorrectionTarget => ({
      kind: "finance", event,
      label: event.kind === "WITHDRAWAL" ? `作废出金 ${money(event.amountCents)}` : `作废第 ${event.continuationNumber} 次续充 ${money(event.amountCents)}`,
    }));
    return finance.length ? finance : [{ kind: "workflow", action: "voidOrder", label: "作废开单和首充" }];
  }
  if (customer.registeredOn) return [{ kind: "workflow", action: "undoRegister", label: "撤销注册" }];
  if (customer.expertContactedOn) return [{ kind: "workflow", action: "undoExpertContacted", label: "撤销专家接待" }];
  if (customer.expertIntroducedOn) return [{ kind: "workflow", action: "undoIntroduceExpert", label: "撤销推专家" }];
  return [];
}

function correctionTargetKey(target: CorrectionTarget) {
  return target.kind === "finance" ? `finance:${target.event.id}` : `workflow:${target.action}`;
}

function nextExpertAction(customer: Customer): ExpertAdvanceAction | null {
  if (!customer.expertIntroducedOn || customer.registeredOn || customer.order) return null;
  if (!customer.expertWorkflowStage) return customer.expertContactedOn ? "beginExpertTracking" : "beginExpertReception";
  if (customer.expertWorkflowStage === "QUEUED") return "beginExpertReception";
  if (customer.expertWorkflowStage === "MATERIALS") return "beginExpertTracking";
  if (customer.expertWorkflowStage === "TRACKING") return "markPendingRegistration";
  if (customer.expertWorkflowStage === "PENDING_REGISTRATION") return "register";
  return null;
}

function stageStatus(customer: Customer, stage: Stage) {
  if (stage === "reception") return customer.repliedOn ? "已回复·待入群" : "待回复";
  if (stage === "group") return customer.groupStatus === "LEFT" ? "已退群" : customer.expertIntroducedOn ? "已推专家" : "在群跟进";
  if (customer.order) return "已开单";
  if (customer.expertWorkflowStage) return expertStageLabel[customer.expertWorkflowStage] ?? customer.expertWorkflowStage;
  if (customer.registeredOn) return "已注册·待开单";
  if (customer.expertContactedOn) return "专家跟进中";
  return "待专家接待";
}

function recentSituation(customer: Customer) {
  const latest = customer.activities[0];
  if (latest?.note) return latest.note;
  if (latest?.kind === "JOINED_GROUP") return "已确认入群";
  if (latest?.kind === "REPLIED") return "已确认回复";
  return customer.expertContactNote ?? customer.nextPlan ?? customer.notes ?? "暂无备注";
}

export function RealCustomerProgress({ members, readOnly = false, groupId, expertActorId }: { members: Array<{ id: string; name: string; positions: string[]; active: boolean }>; readOnly?: boolean; groupId?: string; expertActorId?: string }) {
  const [stage, setStage] = useState<Stage>("reception");
  const [expertStage, setExpertStage] = useState<ExpertStage | "all">("all");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [draftQuery, setDraftQuery] = useState("");
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [followUpDateDraft, setFollowUpDateDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingStageAction, setPendingStageAction] = useState<{ customer: Customer; action: "reply" | "joinGroup" } | null>(null);
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pendingGroupAction, setPendingGroupAction] = useState<{ customer: Customer; action: "leaveGroup" | "introduceExpert" } | null>(null);
  const [leaveNoteDraft, setLeaveNoteDraft] = useState("");
  const [expertOwnerDraft, setExpertOwnerDraft] = useState("");
  const [pendingExpertAction, setPendingExpertAction] = useState<{ customer: Customer; action: ExpertStateAction } | null>(null);
  const [expertDeviceNumberDraft, setExpertDeviceNumberDraft] = useState("");
  const [expertReasonDraft, setExpertReasonDraft] = useState("");
  const [pendingFinanceAction, setPendingFinanceAction] = useState<{ customer: Customer; action: FinanceAction } | null>(null);
  const [financeAmountDraft, setFinanceAmountDraft] = useState("");
  const [financeDateDraft, setFinanceDateDraft] = useState("");
  const [financeMethodDraft, setFinanceMethodDraft] = useState<"CRYPTO" | "BANK">("CRYPTO");
  const [correctionCustomer, setCorrectionCustomer] = useState<Customer | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<CorrectionTarget | null>(null);
  const [correctionReasonDraft, setCorrectionReasonDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    const params = new URLSearchParams({ stage, page: String(page) });
    if (stage === "expert" && expertStage !== "all") params.set("expertStage", expertStage);
    if (query) params.set("q", query);
    if (groupId) params.set("groupId", groupId);
    void requestJson<Response>(`/api/lead/customer-reporting?${params}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "客户进度加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [stage, expertStage, page, query, reloadKey, groupId]);

  function chooseStage(next: Stage) { setStage(next); setExpertStage("all"); setPage(1); setEditing(null); setPendingStageAction(null); setPendingGroupAction(null); setPendingExpertAction(null); setPendingFinanceAction(null); setCorrectionCustomer(null); setCorrectionTarget(null); setSaveError(""); setActionError(""); }
  function submitSearch(event: FormEvent) { event.preventDefault(); setPage(1); setQuery(draftQuery.trim()); }
  function openEditor(customer: Customer) {
    setEditing(customer);
    setPendingStageAction(null);
    setPendingGroupAction(null);
    setPendingExpertAction(null);
    setPendingFinanceAction(null);
    setCorrectionCustomer(null);
    setSaveError("");
    setFollowUpDateDraft(customer.nextFollowUpOn ?? "");
    setNoteDraft(stage === "expert"
      ? customer.nextPlan ?? ""
      : stage === "group"
        ? customer.activities.find((activity) => activity.kind === "GROUP_PROGRESS_UPDATED")?.note ?? ""
        : customer.notes ?? "");
  }
  function openExpertAction(customer: Customer, action: ExpertStateAction) {
    setEditing(null); setPendingStageAction(null); setPendingGroupAction(null); setPendingFinanceAction(null); setCorrectionCustomer(null); setActionError("");
    setExpertDeviceNumberDraft(""); setExpertReasonDraft(""); setPendingExpertAction({ customer, action });
  }
  function openFinanceAction(customer: Customer, action: FinanceAction) {
    setEditing(null); setPendingStageAction(null); setPendingGroupAction(null); setPendingExpertAction(null); setCorrectionCustomer(null); setActionError("");
    setFinanceAmountDraft(""); setFinanceDateDraft(data?.today ?? ""); setFinanceMethodDraft("CRYPTO");
    setPendingFinanceAction({ customer, action });
  }
  async function confirmFinanceAction(event: FormEvent) {
    event.preventDefault();
    if (!pendingFinanceAction) return;
    const amountCents = dollarsToCents(financeAmountDraft);
    if (amountCents === null) { setActionError("请输入大于 0 的正确美元金额，最多两位小数"); return; }
    if (!financeDateDraft) { setActionError("请选择业务日期"); return; }
    const { customer, action } = pendingFinanceAction;
    setActing(true); setActionError("");
    try {
      if (action === "order") {
        await requestJson("/api/customer-orders", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: customer.batch.id, leadId: customer.id, phone: customer.phone, openedOn: financeDateDraft, initialDepositCents: amountCents, initialDepositMethod: financeMethodDraft }),
        });
      } else {
        if (!customer.order) throw new Error("该客户还没有有效开单记录");
        await requestJson("/api/customer-finance", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customerOrderId: customer.order.id, occurredOn: financeDateDraft, kind: action === "recharge" ? "RECHARGE" : "WITHDRAWAL", amountCents, ...(action === "recharge" ? { depositMethod: financeMethodDraft, continuationNumber: customer.order.nextContinuationNumber } : {}) }),
        });
      }
      setPendingFinanceAction(null); setReloadKey((value) => value + 1);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "资金记录保存失败");
    } finally { setActing(false); }
  }
  function openCorrection(customer: Customer) {
    const targets = correctionTargets(customer, stage);
    setEditing(null); setPendingStageAction(null); setPendingGroupAction(null); setPendingExpertAction(null); setPendingFinanceAction(null);
    setActionError(""); setCorrectionReasonDraft(""); setCorrectionCustomer(customer); setCorrectionTarget(targets[0] ?? null);
  }
  async function confirmCorrection(event: FormEvent) {
    event.preventDefault();
    if (!correctionCustomer || !correctionTarget) return;
    if (!correctionReasonDraft.trim()) { setActionError("请填写纠错原因，方便以后核对"); return; }
    setActing(true); setActionError("");
    try {
      if (correctionTarget.kind === "finance") {
        await requestJson(`/api/customer-finance/${encodeURIComponent(correctionTarget.event.id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "void", reason: correctionReasonDraft.trim() }),
        });
      } else {
        await requestJson(`/api/leads/${encodeURIComponent(correctionCustomer.id)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: correctionTarget.action, reason: correctionReasonDraft.trim() }),
        });
      }
      setCorrectionCustomer(null); setCorrectionTarget(null); setReloadKey((value) => value + 1);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "纠错失败");
    } finally { setActing(false); }
  }
  async function confirmExpertAction() {
    if (!pendingExpertAction) return;
    if (pendingExpertAction.action === "beginExpertReception" && !expertDeviceNumberDraft.trim()) {
      setActionError("请输入本次专家接待使用的设备号"); return;
    }
    if (["markNoInitialDeposit", "markExpertStalled"].includes(pendingExpertAction.action) && !expertReasonDraft.trim()) {
      setActionError("请填写原因，方便以后核对"); return;
    }
    setActing(true); setActionError("");
    try {
      await requestJson(`/api/leads/${encodeURIComponent(pendingExpertAction.customer.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: pendingExpertAction.action,
          ...(pendingExpertAction.action === "beginExpertReception" ? { expertDeviceAccountNumber: expertDeviceNumberDraft.trim() } : {}),
          ...(pendingExpertAction.action === "markNoInitialDeposit" ? { noInitialDepositReason: "OTHER", noInitialDepositNote: expertReasonDraft.trim() } : {}),
          ...(pendingExpertAction.action === "markExpertStalled" ? { stalledReason: "OTHER", stalledNote: expertReasonDraft.trim() } : {}),
        }),
      });
      setPendingExpertAction(null); setReloadKey((value) => value + 1);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "操作失败");
    } finally { setActing(false); }
  }
  function openGroupAction(customer: Customer, action: "leaveGroup" | "introduceExpert") {
    setEditing(null); setPendingStageAction(null); setPendingExpertAction(null); setPendingFinanceAction(null); setCorrectionCustomer(null); setActionError("");
    setLeaveNoteDraft(""); setExpertOwnerDraft(""); setPendingGroupAction({ customer, action });
  }
  async function confirmGroupAction() {
    if (!pendingGroupAction) return;
    setActing(true); setActionError("");
    const body = pendingGroupAction.action === "leaveGroup"
      ? { action: "leaveGroup", ...(leaveNoteDraft.trim() ? { leaveNote: leaveNoteDraft.trim() } : {}) }
      : { action: "introduceExpert", ...(expertOwnerDraft ? { expertOwnerId: expertOwnerDraft } : {}) };
    try {
      await requestJson(`/api/leads/${encodeURIComponent(pendingGroupAction.customer.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      setPendingGroupAction(null); setReloadKey((value) => value + 1);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "操作失败");
    } finally { setActing(false); }
  }
  function openStageAction(customer: Customer) {
    setEditing(null); setPendingGroupAction(null); setPendingExpertAction(null); setPendingFinanceAction(null); setCorrectionCustomer(null); setActionError("");
    setPendingStageAction({ customer, action: customer.repliedOn ? "joinGroup" : "reply" });
  }
  async function confirmStageAction() {
    if (!pendingStageAction) return;
    setActing(true); setActionError("");
    try {
      await requestJson(`/api/leads/${encodeURIComponent(pendingStageAction.customer.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: pendingStageAction.action }),
      });
      setPendingStageAction(null); setReloadKey((value) => value + 1);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "操作失败");
    } finally { setActing(false); }
  }
  async function saveFollowUp(event: FormEvent) {
    event.preventDefault();
    if (!editing || !noteDraft.trim()) { setSaveError("请先填写内容"); return; }
    setSaving(true); setSaveError("");
    const body = stage === "expert"
      ? { action: "updateExpertDetails", nextPlan: noteDraft.trim(), nextFollowUpOn: followUpDateDraft || null }
      : stage === "group"
        ? { action: "updateGroupProgress", progressNote: noteDraft.trim() }
        : { action: "note", notes: noteDraft.trim() };
    try {
      await requestJson(`/api/leads/${encodeURIComponent(editing.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      setEditing(null); setReloadKey((value) => value + 1);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "保存失败");
    } finally { setSaving(false); }
  }
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const currentCorrectionTargets = correctionCustomer ? correctionTargets(correctionCustomer, stage) : [];
  const stageCanEdit = !readOnly || (stage === "expert" && Boolean(expertActorId));
  const canEditCustomer = (customer: Customer) => !readOnly || (stage === "expert" && customer.expertOwner?.id === expertActorId);

  function actionButtons(customer: Customer) {
    if (!canEditCustomer(customer)) return <span className="muted">其他专家负责<br />只读</span>;
    return <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
      {stage === "reception" ? <button type="button" className="btn" data-size="sm" data-variant="primary" onClick={() => openStageAction(customer)}>{customer.repliedOn ? "确认入群" : "标记已回复"}</button> : null}
      {stage === "group" && customer.groupStatus === "JOINED" ? <button type="button" className="btn" data-size="sm" onClick={() => openGroupAction(customer, "leaveGroup")}>标记退群</button> : null}
      {stage === "group" && customer.groupStatus === "JOINED" && !customer.expertIntroducedOn ? <button type="button" className="btn" data-size="sm" data-variant="primary" onClick={() => openGroupAction(customer, "introduceExpert")}>推专家</button> : null}
      {stage === "expert" && nextExpertAction(customer) ? <button type="button" className="btn" data-size="sm" data-variant="primary" onClick={() => openExpertAction(customer, nextExpertAction(customer)!)}>{expertAdvanceMeta[nextExpertAction(customer)!].button}</button> : null}
      {stage === "expert" && customer.expertWorkflowStage === "PENDING_ORDER" && customer.registeredOn && !customer.order ? <button type="button" className="btn" data-size="sm" data-variant="primary" onClick={() => openFinanceAction(customer, "order")}>登记开单</button> : null}
      {stage === "expert" && customer.expertWorkflowStage === "PENDING_ORDER" ? <button type="button" className="btn" data-size="sm" onClick={() => openExpertAction(customer, "markNoInitialDeposit")}>未成交</button> : null}
      {stage === "expert" && customer.expertWorkflowStage === "DECLINED_DEPOSIT" ? <button type="button" className="btn" data-size="sm" data-variant="primary" onClick={() => openExpertAction(customer, "clearNoInitialDeposit")}>恢复首充跟进</button> : null}
      {stage === "expert" && customer.expertWorkflowStage === "ORDERED" && customer.order ? <><button type="button" className="btn" data-size="sm" data-variant="primary" onClick={() => openFinanceAction(customer, "recharge")}>登记续充</button><button type="button" className="btn" data-size="sm" onClick={() => openFinanceAction(customer, "withdrawal")}>登记出金</button></> : null}
      {stage === "expert" && customer.expertWorkflowStage === "ORDERED" ? <button type="button" className="btn" data-size="sm" onClick={() => openExpertAction(customer, "markExpertStalled")}>停止维护</button> : null}
      {stage === "expert" && customer.expertWorkflowStage === "STALLED" ? <button type="button" className="btn" data-size="sm" data-variant="primary" onClick={() => openExpertAction(customer, "clearExpertStalled")}>恢复维护</button> : null}
      <button type="button" className="btn" data-size="sm" onClick={() => openEditor(customer)}>{stage === "expert" ? "更新专家情况" : "填写跟进"}</button>
      {correctionTargets(customer, stage).length ? <button type="button" className="btn" data-size="sm" data-variant="danger" onClick={() => openCorrection(customer)}>纠错</button> : null}
    </div>;
  }

  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <section className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div><strong style={{ fontSize: 16 }}>客户进度</strong><div style={{ marginTop: 3, color: "var(--ink-3)" }}>{readOnly && expertActorId ? "接粉、炒群保持只读；专家管理中，组长只操作明确归给自己的专家客户。" : readOnly ? "查看所选小组的真实客户流水线，管理员不能代替一线或组长操作。" : "查看全组客户流水线；代操作与纠错会保留真实操作人记录。"}</div></div>
        <form onSubmit={submitSearch} style={{ display: "flex", gap: 8 }}><input className="field" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="搜索号码或客户姓名" /><button className="btn" data-variant="primary">搜索</button></form>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>{STAGES.map((item) => <StageChip key={item.value} active={stage === item.value} label={item.label} count={data?.counts[item.value] ?? 0} onClick={() => chooseStage(item.value)} />)}<span className="badge" data-tone={stageCanEdit ? "ok" : "mute"} style={{ marginLeft: "auto" }}>{stage === "expert" && expertActorId ? "本人客户可操作 · 其他只读" : readOnly ? "只读" : "本组可管理"}</span></div>
    </section>

    {stage === "expert" ? <section className="card" style={{ padding: 14, display: "flex", flexWrap: "wrap", gap: 7 }}>
      {EXPERT_STAGES.map((item) => <StageChip key={item.value} active={expertStage === item.value} label={item.label} count={item.value === "all" ? Object.values(data?.expertCounts ?? {}).reduce((sum, value) => sum + value, 0) : data?.expertCounts[item.value] ?? 0} onClick={() => { setExpertStage(item.value); setPage(1); }} />)}
    </section> : null}

    {!readOnly && pendingStageAction ? <section className="card" style={{ padding: 16, borderColor: "var(--brand)" }}>
      <strong>{pendingStageAction.action === "reply" ? "确认客户已经回复？" : "确认客户已经进入群聊？"}</strong>
      <div style={{ marginTop: 6, color: "var(--ink-3)" }}>{pendingStageAction.customer.phone} · {pendingStageAction.customer.customerName ?? "未填写姓名"}。确认后会按本组当地今天计入{pendingStageAction.action === "reply" ? "回复" : "进群"}数据。</div>
      {actionError ? <div style={{ marginTop: 8, color: "var(--bad)" }}>{actionError}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}><button type="button" className="btn" disabled={acting} onClick={() => setPendingStageAction(null)}>取消</button><button type="button" className="btn" data-variant="primary" disabled={acting} onClick={confirmStageAction}>{acting ? "处理中…" : pendingStageAction.action === "reply" ? "确认已回复" : "确认已入群"}</button></div>
    </section> : null}

    {!readOnly && pendingGroupAction ? <section className="card" style={{ padding: 16, borderColor: "var(--brand)" }}>
      <strong>{pendingGroupAction.action === "leaveGroup" ? "确认客户已经退群？" : "确认把客户推给专家？"}</strong>
      <div style={{ marginTop: 6, color: "var(--ink-3)" }}>{pendingGroupAction.customer.phone} · {pendingGroupAction.customer.customerName ?? "未填写姓名"}</div>
      {pendingGroupAction.action === "leaveGroup"
        ? <textarea className="field" rows={2} maxLength={300} value={leaveNoteDraft} onChange={(event) => setLeaveNoteDraft(event.target.value)} placeholder="退群备注（可不填）" style={{ marginTop: 10 }} />
        : <select className="field" value={expertOwnerDraft} onChange={(event) => setExpertOwnerDraft(event.target.value)} style={{ marginTop: 10 }}><option value="">组长本人承接（默认）</option>{members.filter((member) => member.active && member.positions.includes("EXPERT")).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>}
      {actionError ? <div style={{ marginTop: 8, color: "var(--bad)" }}>{actionError}</div> : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}><button type="button" className="btn" disabled={acting} onClick={() => setPendingGroupAction(null)}>取消</button><button type="button" className="btn" data-variant="primary" disabled={acting} onClick={confirmGroupAction}>{acting ? "处理中…" : pendingGroupAction.action === "leaveGroup" ? "确认退群" : "确认推专家"}</button></div>
    </section> : null}

    {stageCanEdit && pendingExpertAction ? <Modal
      open
      onClose={() => { if (!acting) { setPendingExpertAction(null); setActionError(""); } }}
      title={expertAdvanceMeta[pendingExpertAction.action].confirm}
      note={`${pendingExpertAction.customer.phone} · ${pendingExpertAction.customer.customerName ?? "未填写姓名"}。只有点击确认按钮后才会保存。`}
      width={500}
    >
      <div style={{ display: "grid", gap: 12 }}>
        {pendingExpertAction.action === "beginExpertReception" ? <label><span className="label">本次专家接待设备号</span><input autoFocus className="field" value={expertDeviceNumberDraft} onChange={(event) => setExpertDeviceNumberDraft(event.target.value)} maxLength={50} placeholder="请输入实际使用的设备号" style={{ width: "100%" }} /></label> : null}
        {["markNoInitialDeposit", "markExpertStalled"].includes(pendingExpertAction.action) ? <label><span className="label">操作原因</span><textarea autoFocus className="field" rows={3} maxLength={300} value={expertReasonDraft} onChange={(event) => setExpertReasonDraft(event.target.value)} placeholder="请填写原因，方便以后核对" style={{ width: "100%" }} /></label> : null}
        {actionError ? <div className="notice" data-tone="bad">{actionError}</div> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" disabled={acting} onClick={() => { setPendingExpertAction(null); setActionError(""); }}>取消</button><button type="button" className="btn" data-variant="primary" disabled={acting} onClick={confirmExpertAction}>{acting ? "处理中…" : expertConfirmButtonLabel(pendingExpertAction.action)}</button></div>
      </div>
    </Modal> : null}

    {stageCanEdit && pendingFinanceAction ? <Modal
      open
      onClose={() => { if (!acting) { setPendingFinanceAction(null); setActionError(""); } }}
      title={pendingFinanceAction.action === "order" ? "登记开单与首充" : pendingFinanceAction.action === "recharge" ? `登记第 ${pendingFinanceAction.customer.order?.nextContinuationNumber ?? 1} 次续充` : "登记出金"}
      note={`${pendingFinanceAction.customer.phone} · ${pendingFinanceAction.customer.customerName ?? "未填写姓名"}。${pendingFinanceAction.action === "order" ? "保存后只产生一笔首充，不会再算作续充。" : pendingFinanceAction.action === "recharge" ? "系统自动使用下一次续充序号，避免重复登记。" : "出金只减少净业绩，不会修改首充。"}`}
      width={540}
    >
      <form onSubmit={confirmFinanceAction} style={{ display: "grid", gap: 14 }}>
        <label><span className="label">美元金额</span><input autoFocus className="field" inputMode="decimal" value={financeAmountDraft} onChange={(event) => setFinanceAmountDraft(event.target.value)} placeholder="例如 1148" aria-label="美元金额" style={{ width: "100%" }} /></label>
        <div className="form-grid cols-2">
          <label><span className="label">业务日期</span><input className="field" type="date" value={financeDateDraft} max={data?.today} onInput={(event) => setFinanceDateDraft(event.currentTarget.value)} onChange={(event) => setFinanceDateDraft(event.target.value)} aria-label="业务日期" style={{ width: "100%" }} /></label>
          {pendingFinanceAction.action !== "withdrawal" ? <label><span className="label">入金方式</span><select className="field" value={financeMethodDraft} onChange={(event) => setFinanceMethodDraft(event.target.value as "CRYPTO" | "BANK")} aria-label="入金方式" style={{ width: "100%" }}><option value="CRYPTO">加密货币</option><option value="BANK">银行卡</option></select></label> : null}
        </div>
        {actionError ? <div className="notice" data-tone="bad">{actionError}</div> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" disabled={acting} onClick={() => { setPendingFinanceAction(null); setActionError(""); }}>取消</button><button className="btn" data-variant="primary" disabled={acting}>{acting ? "保存中…" : pendingFinanceAction.action === "order" ? "确认开单" : pendingFinanceAction.action === "recharge" ? "确认续充" : "确认出金"}</button></div>
      </form>
    </Modal> : null}

    {stageCanEdit && correctionCustomer && correctionTarget ? <Modal open onClose={() => { if (!acting) { setCorrectionCustomer(null); setCorrectionTarget(null); setActionError(""); } }} title={`纠错：${correctionCustomer.phone}`} note="系统只允许从最后一步倒着撤销；有续充或出金时，必须先逐笔作废资金流水，之后才能作废开单。" width={540}>
      <form onSubmit={confirmCorrection} style={{ display: "grid", gap: 12 }}>
        <label><span className="label">纠错项目</span><select className="field" value={correctionTargetKey(correctionTarget)} onChange={(event) => setCorrectionTarget(currentCorrectionTargets.find((target) => correctionTargetKey(target) === event.target.value) ?? null)} aria-label="纠错项目" style={{ width: "100%" }}>{currentCorrectionTargets.map((target) => <option key={correctionTargetKey(target)} value={correctionTargetKey(target)}>{target.label}</option>)}</select></label>
        <label><span className="label">纠错原因</span><input autoFocus className="field" value={correctionReasonDraft} onChange={(event) => setCorrectionReasonDraft(event.target.value)} maxLength={100} placeholder="必填：为什么要纠错" aria-label="纠错原因" style={{ width: "100%" }} /></label>
        {actionError ? <div className="notice" data-tone="bad">{actionError}</div> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" disabled={acting} onClick={() => { setCorrectionCustomer(null); setCorrectionTarget(null); setActionError(""); }}>取消</button><button className="btn" data-variant="danger" disabled={acting}>{acting ? "处理中…" : `确认${correctionTarget.label}`}</button></div>
      </form>
    </Modal> : null}

    {stageCanEdit && editing ? <Modal open onClose={() => { if (!saving) { setEditing(null); setSaveError(""); } }} title={stage === "reception" ? "填写接粉备注" : stage === "group" ? "填写今日炒群进度" : "更新专家情况"} note={`${editing.phone} · ${editing.customerName ?? "未填写姓名"}`} width={560}>
      <form onSubmit={saveFollowUp} style={{ display: "grid", gap: 12 }}>
        <label><span className="label">{stage === "expert" ? "专家下一步计划" : "跟进内容"}</span><textarea autoFocus className="field" rows={4} maxLength={stage === "group" ? 500 : 300} value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder={stage === "reception" ? "例如：客户正在考虑，明天再次联系" : stage === "group" ? "例如：今日已互动，客户询问了群内内容" : "例如：明天确认注册资料"} style={{ width: "100%" }} /></label>
        {stage === "expert" ? <label><span className="label">计划跟进日期</span><input className="field" type="date" value={followUpDateDraft} onInput={(event) => setFollowUpDateDraft(event.currentTarget.value)} onChange={(event) => setFollowUpDateDraft(event.target.value)} aria-label="计划跟进日期" style={{ width: "100%" }} /></label> : null}
        {saveError ? <div className="notice" data-tone="bad">{saveError}</div> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" disabled={saving} onClick={() => { setEditing(null); setSaveError(""); }}>取消</button><button className="btn" data-variant="primary" disabled={saving}>{saving ? "保存中…" : "保存跟进"}</button></div>
      </form>
    </Modal> : null}

    {loading ? <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--ink-3)" }}>正在读取真实客户进度…</section> : null}
    {!loading && error ? <section className="card" style={{ padding: 48, textAlign: "center", color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error}</section> : null}
    {!loading && !error ? <section className="card" style={{ overflow: "hidden" }}>
      <div className="card-head"><div><h2 className="card-title">{STAGES.find((item) => item.value === stage)?.label}</h2><p className="card-note">{stage === "reception" ? "号码导入后到确认入群前的客户" : stage === "group" ? "已进入群聊后的客户交接与跟进情况" : "推给专家后的八段进度与资金情况"}</p></div><span className="badge" data-tone={stageCanEdit ? "ok" : "mute"}>{stage === "expert" && expertActorId ? "组长兼专家" : readOnly ? "只读" : "真实数据"}</span></div>
      {data?.customers.length ? <div className="table-scroll"><table className="grid-table" data-sticky-edges={stageCanEdit ? "true" : undefined}>
        {stage === "reception" ? <>
          <thead><tr><th style={{ width: 150 }}>客户</th><th style={{ width: 120 }}>来源</th><th style={{ width: 220 }}>客户资料</th><th style={{ width: 135 }}>当前进度</th><th style={{ width: 190 }}>负责人</th><th style={{ width: 250 }}>最近情况</th>{!readOnly ? <th style={{ width: 140, textAlign: "center" }}>操作</th> : null}</tr></thead>
          <tbody>{data.customers.map((customer) => <tr key={customer.id}>
            <td><strong className="tnum">{customer.phone}</strong><div style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 2 }}>{customer.customerName ?? "未填写姓名"}</div></td>
            <td style={{ fontSize: 12.5 }}>{customer.batch.channel.name}<div style={{ color: "var(--ink-3)", marginTop: 2 }}>{customer.batch.sourceDate}</div></td>
            <td><div style={{ display: "flex", flexDirection: "column", gap: 3 }}><DetailLine label="邮箱">{customer.customerEmail ?? "—"}</DetailLine><DetailLine label="损失金额">{money(customer.lossAmountCents)}</DetailLine><DetailLine label="平台">{customer.customerPlatform ?? "—"}</DetailLine></div></td>
            <td><span className="badge" data-tone="mute">{stageStatus(customer, stage)}</span>{customer.repliedOn ? <div style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 5 }}>回复 {customer.repliedOn}</div> : null}</td>
            <td><div style={{ display: "flex", flexDirection: "column", gap: 4 }}><DetailLine label="接粉">{customer.owner?.name ?? "未分配"}</DetailLine><DetailLine label="炒群">{customer.groupOperatorOwner?.name ?? "未分配"}</DetailLine></div></td>
            <td style={{ color: "var(--ink-2)", fontSize: 13 }}>{recentSituation(customer)}</td>
            {!readOnly ? <td style={{ textAlign: "center" }}>{actionButtons(customer)}</td> : null}
          </tr>)}</tbody>
        </> : <>
          <thead><tr><th style={{ width: 165 }}>客户</th><th style={{ width: 205 }}>交接与负责人</th><th style={{ width: 285 }}>最新进度</th><th style={{ width: 230 }}>资金与业绩</th>{stageCanEdit ? <th style={{ width: 150, textAlign: "center" }}>操作</th> : null}</tr></thead>
          <tbody>{data.customers.map((customer) => {
            const initial = customer.order?.initialDepositCents ?? 0;
            const recharge = customer.order?.rechargeCents ?? 0;
            const withdrawal = customer.order?.withdrawalCents ?? 0;
            const net = initial + recharge - withdrawal;
            return <tr key={customer.id}>
              <td><strong className="tnum">{customer.phone}</strong><div style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13, marginTop: 3 }}>{stageStatus(customer, stage)}</div><div style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 3 }}>{customer.batch.channel.name} · {customer.batch.sourceDate}</div></td>
              <td><div style={{ display: "flex", flexDirection: "column", gap: 4 }}><DetailLine label="粉的归属">{customer.owner?.name ?? "未分配"}</DetailLine><DetailLine label="炒群负责人">{customer.groupOperatorOwner?.name ?? "未分配"}</DetailLine><DetailLine label="专家负责人">{customer.expertOwner?.name ?? "未分配"}</DetailLine>{stage === "expert" ? <DetailLine label="专家当前阶段">{stageStatus(customer, stage)}</DetailLine> : null}</div></td>
              <td><div style={{ display: "flex", flexDirection: "column", gap: 3 }}><p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>{stage === "group" ? "炒群最新进度" : "专家情况"}</p><p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>{recentSituation(customer)}</p>{customer.nextFollowUpOn ? <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--ink-3)" }}>下次跟进 {customer.nextFollowUpOn}</p> : null}</div></td>
              <td><div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px 10px" }}><MoneyLine label="首充" value={money(initial)} /><MoneyLine label="续充" value={money(recharge)} /><MoneyLine label="出金" value={money(withdrawal)} /></div><div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--line)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600 }}>当前净业绩</span><strong className="tnum" style={{ color: net >= 0 ? "var(--ok)" : "var(--bad)" }}>{money(net)}</strong></div></td>
              {stageCanEdit ? <td style={{ textAlign: "center" }}>{actionButtons(customer)}</td> : null}
            </tr>;
          })}</tbody>
        </>}
      </table></div> : <div style={{ padding: "54px 20px", textAlign: "center", color: "var(--ink-3)" }}>当前阶段没有客户</div>}
      {data && data.total > data.pageSize ? <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, padding: 14, borderTop: "1px solid var(--line)" }}><button className="btn" data-size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><span>第 {page} / {totalPages} 页</span><button className="btn" data-size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button></div> : null}
    </section> : null}
  </div>;
}
