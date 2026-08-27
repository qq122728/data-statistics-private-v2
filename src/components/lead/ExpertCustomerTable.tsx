"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkflowConfirmationDialog, type WorkflowConfirmation } from "../ui/WorkflowConfirmationDialog";
import { formatUsd as money } from "../../lib/money";
import { ExpertCustomerFilters, type ExpertCustomerTab } from "./ExpertCustomerFilters";
import { ExpertCustomerEditors } from "./ExpertCustomerEditors";
import { ExpertCustomerDataTable } from "./ExpertCustomerDataTable";
import { expertCustomerStage, expertCustomerStagePriority, hasActiveOrder } from "./expert-customer-view";
import { ExpertStallDialog } from "./ExpertStallDialog";
import { HistoricalCustomerDialog, type HistoricalCustomerChannel, type HistoricalCustomerMember } from "./HistoricalCustomerDialog";
import type { ExpertCustomer, ExpertFinancialEvent } from "./expert-customer-types";

export type { ExpertCustomer } from "./expert-customer-types";

function dateOnly(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString().slice(0, 10);
}

export function ExpertCustomerTable({
  customers,
  today,
  query = "",
  canEdit = false,
  canAssign = false,
  canAddHistorical = false,
  historicalImportOptions,
  assignees = [],
  contactAccounts = [],
}: {
  customers: ExpertCustomer[];
  today: string;
  query?: string;
  canEdit?: boolean;
  canAssign?: boolean;
  canAddHistorical?: boolean;
  historicalImportOptions?: {
    members: HistoricalCustomerMember[];
    channels: HistoricalCustomerChannel[];
    currentUserId: string;
    entryRole: "EXPERT" | "LEAD";
  };
  assignees?: Array<{ id: string; name: string; label: string }>;
  contactAccounts?: Array<{ id: string; accountNumber: string; accountType: "NORMAL_WS" | "BUSINESS_WS" | "RCS" }>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<ExpertCustomerTab>("queued");
  const [search, setSearch] = useState(query);
  const [member, setMember] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState("");
  const [detailDraft, setDetailDraft] = useState({
    customerName: "",
    expertNotes: "",
    deviceAccountId: "",
  });
  const [orderEditingId, setOrderEditingId] = useState("");
  const [orderDraft, setOrderDraft] = useState({ date: today, amount: "", depositMethod: "CRYPTO" as "CRYPTO" | "BANK" });
  const [financeEditingId, setFinanceEditingId] = useState("");
  const [stallingId, setStallingId] = useState("");
  const [noInitialDepositId, setNoInitialDepositId] = useState("");
  const [historicalEntryOpen, setHistoricalEntryOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);
  const [financeDraft, setFinanceDraft] = useState({
    occurredOn: today,
    kind: "RECHARGE" as "RECHARGE" | "WITHDRAWAL",
    amount: "",
    continuationNumber: "1",
    depositMethod: "CRYPTO" as "CRYPTO" | "BANK",
  });
  const members = [...new Set(customers.map((customer) => customer.expertOwnerName).filter((name): name is string => Boolean(name)))];
  useEffect(() => setSearch(query), [query]);
  // 标签数字表示当前真实待办，不是新增粉统计；老客户在启用后进入新阶段也必须显示在待办数字中。
  const countableCustomers = customers;
  const queuedCount = countableCustomers.filter((customer) => expertCustomerStage(customer) === "QUEUED").length;
  const materialsCount = countableCustomers.filter((customer) => expertCustomerStage(customer) === "MATERIALS").length;
  const trackingCount = countableCustomers.filter((customer) => expertCustomerStage(customer) === "TRACKING").length;
  const pendingRegistrationCount = countableCustomers.filter((customer) => expertCustomerStage(customer) === "PENDING_REGISTRATION").length;
  const pendingOrderCount = countableCustomers.filter((customer) => expertCustomerStage(customer) === "PENDING_ORDER").length;
  const noInitialDepositCount = countableCustomers.filter((customer) => expertCustomerStage(customer) === "DECLINED_DEPOSIT" || expertCustomerStage(customer) === "NO_INITIAL_DEPOSIT").length;
  const orderedCount = countableCustomers.filter((customer) => expertCustomerStage(customer) === "ORDERED" || expertCustomerStage(customer) === "FIRST_DEPOSIT" || expertCustomerStage(customer) === "RECHARGING").length;
  const stalledCount = countableCustomers.filter((customer) => expertCustomerStage(customer) === "STALLED").length;
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesSearch =
        !keyword ||
        customer.phone.includes(keyword) ||
        (customer.customerName ?? "").toLowerCase().includes(keyword);
      const stage = expertCustomerStage(customer);
      const matchesTab = tab === "queued" ? stage === "QUEUED"
        : tab === "materials" ? stage === "MATERIALS"
          : tab === "tracking" ? stage === "TRACKING"
            : tab === "registration" ? stage === "PENDING_REGISTRATION"
              : tab === "order" ? stage === "PENDING_ORDER"
                : tab === "noInitialDeposit" ? stage === "DECLINED_DEPOSIT" || stage === "NO_INITIAL_DEPOSIT"
                  : tab === "ordered" ? stage === "ORDERED" || stage === "FIRST_DEPOSIT" || stage === "RECHARGING"
                    : stage === "STALLED";
      return (
        matchesSearch &&
        matchesTab &&
        (!member || customer.expertOwnerName === member)
      );
    }).sort((left, right) => expertCustomerStagePriority(left) - expertCustomerStagePriority(right) || (left.nextFollowUpOn ?? "9999-12-31").localeCompare(right.nextFollowUpOn ?? "9999-12-31"));
  }, [customers, member, search, tab]);
  const editingCustomer = customers.find((customer) => customer.id === editingId) ?? null;
  const orderCustomer = customers.find((customer) => customer.id === orderEditingId) ?? null;
  const financeCustomer = customers.find((customer) => customer.id === financeEditingId) ?? null;
  const stallingCustomer = customers.find((customer) => customer.id === stallingId) ?? null;
  const noInitialDepositCustomer = customers.find((customer) => customer.id === noInitialDepositId) ?? null;

  async function assign(customer: ExpertCustomer, expertOwnerId: string) {
    setBusy(customer.id);
    setError("");
    try {
      const response = await fetch("/api/lead/expert-assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: customer.id, expertOwnerId: expertOwnerId || null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "分配失败");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分配失败");
    } finally {
      setBusy("");
    }
  }

  async function updateProgress(customer: ExpertCustomer, action: "beginExpertReception" | "beginExpertTracking" | "markPendingRegistration" | "register" | "undoRegister", extra: Record<string, string> = {}) {
    setBusy(customer.id);
    setError("");
    try {
      const response = await fetch(`/api/leads/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, occurredOn: extra.occurredOn ?? today, ...extra }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      router.refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function setStalled(customer: ExpertCustomer, stalledReason: string, stalledNote: string) {
    setBusy(customer.id);
    setError("");
    try {
      const response = await fetch(`/api/leads/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markExpertStalled", occurredOn: today, stalledReason, stalledNote }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setStallingId("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  async function restoreStalled(customer: ExpertCustomer): Promise<boolean> {
    setBusy(customer.id);
    setError("");
    try {
      const response = await fetch(`/api/leads/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearExpertStalled", occurredOn: today }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "恢复失败");
      router.refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复失败");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function setNoInitialDeposit(customer: ExpertCustomer, noInitialDepositReason: string, noInitialDepositNote: string) {
    setBusy(customer.id);
    setError("");
    try {
      const response = await fetch(`/api/leads/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markNoInitialDeposit", occurredOn: today, noInitialDepositReason, noInitialDepositNote }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setNoInitialDepositId("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  async function restoreNoInitialDeposit(customer: ExpertCustomer): Promise<boolean> {
    setBusy(customer.id);
    setError("");
    try {
      const response = await fetch(`/api/leads/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearNoInitialDeposit", occurredOn: today }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "恢复失败");
      router.refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "恢复失败");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function openOrder(customer: ExpertCustomer) {
    const amount = Number(orderDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("请输入大于 0 的首充金额");
      return false;
    }
    setBusy(customer.id);
    setError("");
    try {
      const response = await fetch("/api/customer-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: customer.id,
          batchId: customer.batchId,
          phone: customer.phone,
          openedOn: orderDraft.date,
          initialDepositCents: Math.round(amount * 100),
          initialDepositMethod: orderDraft.depositMethod,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        fields?: Record<string, string[]>;
      };
      if (!response.ok) {
        // The API returns field-level validation details (for example: the
        // opening date is earlier than the registration date). Surface that
        // reason in the confirmation dialog instead of the vague fallback.
        const fieldError = Object.values(result.fields ?? {}).flat().find(Boolean);
        throw new Error(fieldError ?? result.error ?? "开单失败");
      }
      setOrderEditingId("");
      router.refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "开单失败");
      return false;
    } finally {
      setBusy("");
    }
  }

  function requestRegistration(customer: ExpertCustomer) {
    setError("");
    setConfirmation({
      title: customer.isHistoricalRecord ? "确认历史补录客户已经完成注册？" : "确认客户已经完成注册？",
      description: customer.isHistoricalRecord
        ? "这是历史补录客户。请填写真实注册日期；确认后客户会进入待开单阶段。"
        : "确认后，客户会进入待开单阶段。请先核对客户确实已经完成注册。",
      confirmLabel: "确认标记已注册",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      tone: "primary",
      dateLabel: "实际注册日期",
      defaultDate: today,
      minDate: dateOnly(customer.expertTrackingStartedAt) ?? customer.expertContactedOn ?? undefined,
      maxDate: today,
      onConfirm: async (_reason, occurredOn) => {
        if (occurredOn && await updateProgress(customer, "register", { occurredOn })) setConfirmation(null);
      },
    });
  }

  function requestRestoreStalled(customer: ExpertCustomer) {
    setError("");
    setConfirmation({
      title: "确认恢复客户跟进？",
      description: "确认后，客户会从“杀不动”回到正常的专家跟进名单，原来的原因仍会保留在历史记录中。",
      confirmLabel: "确认恢复跟进",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      onConfirm: async () => { if (await restoreStalled(customer)) setConfirmation(null); },
    });
  }

  function requestRestoreNoInitialDeposit(customer: ExpertCustomer) {
    setError("");
    setConfirmation({
      title: "确认恢复首充跟进？",
      description: "确认后，客户会从“不首充”回到待开单名单，请先确认客户重新具备首充可能。",
      confirmLabel: "确认恢复首充跟进",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      onConfirm: async () => { if (await restoreNoInitialDeposit(customer)) setConfirmation(null); },
    });
  }

  function requestOpenOrder(customer: ExpertCustomer) {
    const amount = Number(orderDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("请输入大于 0 的首充金额");
      return;
    }
    setError("");
    setConfirmation({
      title: customer.isHistoricalRecord ? "确认登记历史补录客户开单？" : "确认登记客户开单？",
      description: customer.isHistoricalRecord
        ? "这是历史补录客户。请确认填写的是实际开单日期和首充金额；保存后会计入开单人数和业绩。"
        : "确认后，这笔首充会计入开单人数和业绩。请再次核对日期与美元金额。",
      confirmLabel: "确认登记开单",
      target: `${customer.phone} · ${orderDraft.date} · ${money(Math.round(amount * 100))}`,
      tone: "primary",
      onConfirm: async () => {
        if (await openOrder(customer)) setConfirmation(null);
      },
    });
  }

  function beginOrder(customer: ExpertCustomer) {
    setOrderEditingId(customer.id);
    setOrderDraft({ date: today, amount: "", depositMethod: "CRYPTO" });
    setError("");
  }

  function beginEdit(customer: ExpertCustomer) {
    setEditingId(customer.id);
    setDetailDraft({
      customerName: customer.customerName ?? "",
      expertNotes: customer.expertNotes ?? "",
      deviceAccountId: customer.expertDeviceAccountId && contactAccounts.some((account) => account.id === customer.expertDeviceAccountId) ? customer.expertDeviceAccountId : "",
    });
    setError("");
  }

  async function saveDetails(customer: ExpertCustomer) {
    setBusy(customer.id);
    setError("");
    try {
      const response = await fetch(`/api/leads/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateExpertDetails",
          occurredOn: today,
          customerName: detailDraft.customerName,
          expertNotes: detailDraft.expertNotes,
          ...(detailDraft.deviceAccountId && contactAccounts.some((account) => account.id === detailDraft.deviceAccountId) ? { deviceAccountId: detailDraft.deviceAccountId } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setEditingId("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  function beginFinance(customer: ExpertCustomer) {
    const nextContinuation = Math.max(
      0,
      ...(customer.order?.events
        .filter((event) => event.kind === "RECHARGE")
        .map((event) => event.continuationNumber ?? 0) ?? []),
    ) + 1;
    setFinanceEditingId(customer.id);
    setFinanceDraft({
      occurredOn: today,
      kind: "RECHARGE",
      amount: "",
      continuationNumber: String(nextContinuation),
      depositMethod: "CRYPTO",
    });
    setError("");
  }

  async function saveFinance(customer: ExpertCustomer) {
    if (!customer.order) return;
    const amount = Number(financeDraft.amount);
    const continuationNumber = Number(financeDraft.continuationNumber);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("请输入大于 0 的资金金额");
      return;
    }
    if (financeDraft.kind === "RECHARGE" && (!Number.isInteger(continuationNumber) || continuationNumber <= 0)) {
      setError("续充次数必须是大于 0 的整数");
      return;
    }
    setBusy(`finance-${customer.id}`);
    setError("");
    try {
      const response = await fetch("/api/customer-finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerOrderId: customer.order.id,
          occurredOn: financeDraft.occurredOn,
          kind: financeDraft.kind,
          amountCents: Math.round(amount * 100),
          ...(financeDraft.kind === "RECHARGE" ? { depositMethod: financeDraft.depositMethod } : {}),
          ...(financeDraft.kind === "RECHARGE" ? { continuationNumber } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? Object.values(result.fields ?? {}).flat()[0] ?? "资金保存失败");
      setFinanceEditingId("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资金保存失败");
    } finally {
      setBusy("");
    }
  }

  async function voidFinance(customer: ExpertCustomer, eventId: string, reason: string) {
    setBusy(`finance-${eventId}`);
    setError("");
    try {
      const response = await fetch(`/api/customer-finance/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", reason: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "作废失败");
      if (financeEditingId === customer.id) setFinanceEditingId("");
      router.refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "作废失败");
      return false;
    } finally {
      setBusy("");
    }
  }

  function requestProgressCorrection(customer: ExpertCustomer, action: "undoRegister") {
    setError("");
    setConfirmation({
      title: "确认撤销客户注册？",
      description: "客户会退回“已联系专家、待注册”状态，历史操作仍会保留。",
      confirmLabel: "确认撤销注册",
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      tone: "danger",
      reasonLabel: "操作原因",
      reasonPlaceholder: "例如：刚才误点了，客户实际尚未完成",
      onConfirm: async (reason) => {
        if (await updateProgress(customer, action, { reason })) setConfirmation(null);
      },
    });
  }

  function requestFinanceVoid(customer: ExpertCustomer, event: ExpertFinancialEvent) {
    setError("");
    setConfirmation({
      title: "确认作废这笔资金流水？",
      description: "作废后这笔金额不会再计入业绩，但历史记录会保留。",
      confirmLabel: "确认作废",
      target: `${customer.phone} · ${event.occurredOn} · ${event.kind === "RECHARGE" ? "续充" : "出金"} ${money(event.amountCents)}`,
      tone: "danger",
      reasonLabel: "作废原因",
      reasonPlaceholder: "例如：金额录错或重复登记",
      onConfirm: async (reason) => {
        if (await voidFinance(customer, event.id, reason)) setConfirmation(null);
      },
    });
  }

  function requestStage(customer: ExpertCustomer, action: "beginExpertReception" | "beginExpertTracking" | "markPendingRegistration") {
    const config = {
      beginExpertReception: {
        title: customer.isHistoricalRecord ? "开始接待历史补录客户？" : "开始接待该客户？",
        description: customer.isHistoricalRecord
          ? "这是历史补录客户。请按真实发生日期填写接待、资料、追踪、注册、开单和资金；确认接待后将按正常流程继续。"
          : "客户会从排队中进入交资料阶段。",
        confirmLabel: "确认开始接待", dateLabel: "实际开始接待日期", minDate: customer.expertIntroducedOn ?? undefined,
        textLabel: "本次使用的专家设备号", textPlaceholder: "请输入专家本人实际使用的设备号",
        dateHint: customer.isHistoricalRecord ? "历史补录请填写真实接待日期；可直接在日期框中输入，或点击“最早可选日期”快速带入推专家当天。" : undefined,
      },
      beginExpertTracking: {
        title: customer.isHistoricalRecord ? "确认历史补录客户已交资料？" : "确认客户已交资料？",
        description: customer.isHistoricalRecord
          ? "这是历史补录客户。请填写真实交资料／开始追踪日期。"
          : "客户会进入追踪中，并从现在开始计算 48 小时。",
        confirmLabel: "确认开始追踪", dateLabel: "实际交资料／开始追踪日期", minDate: customer.expertContactedOn ?? customer.expertIntroducedOn ?? undefined,
        textLabel: undefined, textPlaceholder: undefined,
        dateHint: customer.isHistoricalRecord ? "历史补录：请按真实发生日期填写交资料／开始追踪日期。" : undefined,
      },
      markPendingRegistration: {
        title: customer.isHistoricalRecord ? "确认历史补录客户转为待注册？" : "确认转为待注册？",
        description: customer.isHistoricalRecord
          ? "这是历史补录客户。请填写真实转待注册日期。"
          : "追踪时间会停止，后续等待客户完成注册。",
        confirmLabel: "确认转待注册", dateLabel: "实际转待注册日期", minDate: dateOnly(customer.expertTrackingStartedAt) ?? customer.expertContactedOn ?? undefined,
        textLabel: undefined, textPlaceholder: undefined,
        dateHint: customer.isHistoricalRecord ? "历史补录：请按真实发生日期填写转待注册日期。" : undefined,
      },
    }[action];
    setError("");
    setConfirmation({
      title: config.title, description: config.description, confirmLabel: config.confirmLabel,
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      dateLabel: config.dateLabel,
      dateHint: config.dateHint,
      defaultDate: today,
      minDate: config.minDate,
      maxDate: today,
      textLabel: config.textLabel,
      textPlaceholder: config.textPlaceholder,
      onConfirm: async (_reason, occurredOn, _number, textValue) => {
        if (occurredOn && await updateProgress(customer, action, { occurredOn, ...(action === "beginExpertReception" && textValue ? { expertDeviceAccountNumber: textValue } : {}) })) setConfirmation(null);
      },
    });
  }

  function submitSearch() {
    const params = new URLSearchParams(window.location.search);
    const keyword = search.trim();
    if (keyword) params.set("q", keyword);
    else params.delete("q");
    params.delete("page");
    const suffix = params.toString();
    router.push(`/expert-customers${suffix ? `?${suffix}` : ""}`);
  }

  return (
    <section className="panel overflow-hidden">
      {canAddHistorical ? <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3"><p className="text-sm text-slate-600">老客户号码只建档一次；启用前阶段不重复计数，之后真实注册、开单和资金正常进入累计数据。</p><button type="button" onClick={() => { setError(""); setHistoricalEntryOpen(true); }} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-50">+ 录入老客户</button></div> : null}
      <ExpertCustomerFilters
        tab={tab}
        search={search}
        member={member}
        members={members}
        queuedCount={queuedCount}
        materialsCount={materialsCount}
        trackingCount={trackingCount}
        pendingRegistrationCount={pendingRegistrationCount}
        pendingOrderCount={pendingOrderCount}
        noInitialDepositCount={noInitialDepositCount}
        orderedCount={orderedCount}
        stalledCount={stalledCount}
        filteredCount={filtered.length}
        onTab={setTab}
        onSearch={setSearch}
        onMember={setMember}
        onSearchSubmit={submitSearch}
      />
      {error && <p className="m-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ExpertCustomerEditors
        canEdit={canEdit}
        editingCustomer={editingCustomer}
        orderCustomer={orderCustomer}
        financeCustomer={financeCustomer}
        detailDraft={detailDraft}
        orderDraft={orderDraft}
      financeDraft={financeDraft}
      contactAccounts={contactAccounts}
        busy={busy}
        onDetailChange={setDetailDraft}
        onOrderChange={setOrderDraft}
        onFinanceChange={setFinanceDraft}
        onCloseDetails={() => setEditingId("")}
        onCloseOrder={() => setOrderEditingId("")}
        onCloseFinance={() => setFinanceEditingId("")}
        onSaveDetails={() => { if (editingCustomer) void saveDetails(editingCustomer); }}
        onSaveOrder={() => { if (orderCustomer) requestOpenOrder(orderCustomer); }}
        onSaveFinance={() => { if (financeCustomer) void saveFinance(financeCustomer); }}
      />
      <ExpertStallDialog customer={stallingCustomer} busy={busy === stallingCustomer?.id} error={error} onClose={() => { if (!busy) setStallingId(""); }} onConfirm={(reason, note) => { if (stallingCustomer) void setStalled(stallingCustomer, reason, note); }} />
      <ExpertStallDialog customer={noInitialDepositCustomer} mode="noInitialDeposit" busy={busy === noInitialDepositCustomer?.id} error={error} onClose={() => { if (!busy) setNoInitialDepositId(""); }} onConfirm={(reason, note) => { if (noInitialDepositCustomer) void setNoInitialDeposit(noInitialDepositCustomer, reason, note); }} />
      <ExpertCustomerDataTable
        customers={filtered}
        today={today}
        tab={tab}
        canEdit={canEdit}
        canAssign={canAssign}
        assignees={assignees}
        busy={busy}
        onAssign={(customer, expertOwnerId) => { void assign(customer, expertOwnerId); }}
        onStage={requestStage}
        onRegistration={requestRegistration}
        onOpenOrder={beginOrder}
        onFinance={beginFinance}
        onEdit={beginEdit}
        onCorrection={requestProgressCorrection}
        onVoidFinance={requestFinanceVoid}
        onStall={(customer) => { setError(""); setStallingId(customer.id); }}
        onRestoreStalled={requestRestoreStalled}
        onNoInitialDeposit={(customer) => { setError(""); setNoInitialDepositId(customer.id); }}
        onRestoreNoInitialDeposit={requestRestoreNoInitialDeposit}
      />
      <WorkflowConfirmationDialog
        confirmation={confirmation}
        busy={Boolean(busy)}
        error={confirmation ? error : ""}
        onClose={() => { if (!busy) { setConfirmation(null); setError(""); } }}
      />
      <HistoricalCustomerDialog
        open={historicalEntryOpen}
        today={today}
        entryRole={historicalImportOptions?.entryRole ?? "EXPERT"}
        members={historicalImportOptions?.members ?? []}
        channels={historicalImportOptions?.channels ?? []}
        currentUserId={historicalImportOptions?.currentUserId ?? ""}
        onClose={() => { if (!busy) { setHistoricalEntryOpen(false); setError(""); } }}
        onCreated={() => router.refresh()}
      />
    </section>
  );
}
