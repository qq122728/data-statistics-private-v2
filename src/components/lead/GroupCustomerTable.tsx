"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExpertAssignmentDialog, type ExpertAssignee } from "./ExpertAssignmentDialog";
import { ExpertContactDialog } from "./ExpertContactDialog";
import { GroupProgressDialog } from "./GroupProgressDialog";
import {
  WorkflowConfirmationDialog,
  type WorkflowConfirmation,
} from "../ui/WorkflowConfirmationDialog";
import { groupDayNumber } from "../../lib/group-progress";
import { assessGroupLeave } from "../../lib/group-leave";
import { GroupCustomerFilters, type GroupCustomerExpertStageFilter, type GroupCustomerStatusFilter, type GroupCustomerView } from "./GroupCustomerFilters";
import { GroupCustomerDetails } from "./GroupCustomerDetails";
import { groupCustomerStage, groupCustomerStagePriority } from "./group-customer-view";
import { resolveExpertWorkflowStage } from "../../lib/expert-workflow-stage";
import { GroupCustomerDataTable } from "./GroupCustomerDataTable";
import { GroupCustomerEditor } from "./GroupCustomerEditor";
import type { GroupCustomer, GroupCustomerAction } from "./group-customer-types";
import { HistoricalCustomerDialog, type HistoricalCustomerChannel, type HistoricalCustomerMember } from "./HistoricalCustomerDialog";
import type { GroupCustomerViewCounts } from "../../lib/customer-queries/group-customers";

export type { GroupCustomer } from "./group-customer-types";

export function GroupCustomerTable({
  customers,
  query = "",
  canEdit = false,
  canAddHistorical = false,
  historicalImportOptions,
  assignees = [],
  contactAccounts = [],
  currentDate,
  activeView = "inGroup",
  viewCounts = { inGroup: 0, introduced: 0, expertProgress: 0, ordered: 0, left: 0 },
  earlyLeftCount = 0,
  activeFilters = { member: "", channel: "", expertStage: "", leaveRisk: "", leaveOrder: "", stage: "" },
  filterOptions = { members: [], channels: [] },
}: {
  customers: GroupCustomer[];
  query?: string;
  canEdit?: boolean;
  canAddHistorical?: boolean;
  historicalImportOptions?: { members: HistoricalCustomerMember[]; channels: HistoricalCustomerChannel[]; currentUserId: string; entryRole: "GROUP_OPERATOR" | "LEAD" };
  assignees?: ExpertAssignee[];
  contactAccounts?: Array<{ id: string; accountNumber: string; accountType: "NORMAL_WS" | "BUSINESS_WS" | "RCS" | "SIG" }>;
  currentDate: string;
  activeView?: GroupCustomerView;
  viewCounts?: GroupCustomerViewCounts;
  earlyLeftCount?: number;
  activeFilters?: { member: string; channel: string; expertStage: GroupCustomerExpertStageFilter; leaveRisk: "" | "EARLY" | "WATCH" | "NORMAL" | "UNKNOWN"; leaveOrder: "" | "ordered" | "not-ordered"; stage: GroupCustomerStatusFilter };
  filterOptions?: { members: string[]; channels: string[] };
}) {
  const router = useRouter();
  const [search, setSearch] = useState(query);
  const [member, setMember] = useState(activeFilters.member);
  const [channel, setChannel] = useState(activeFilters.channel);
  const [expertStage, setExpertStage] = useState<GroupCustomerExpertStageFilter>(activeFilters.expertStage);
  const [view, setView] = useState<GroupCustomerView>(activeView);
  const [leaveRisk, setLeaveRisk] = useState(activeFilters.leaveRisk);
  const [leaveOrder, setLeaveOrder] = useState(activeFilters.leaveOrder);
  const [stage, setStage] = useState<GroupCustomerStatusFilter>(activeFilters.stage);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<WorkflowConfirmation | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);
  const [progressId, setProgressId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historicalEntryOpen, setHistoricalEntryOpen] = useState(false);
  const members = filterOptions.members;
  const channels = filterOptions.channels;
  useEffect(() => setSearch(query), [query]);
  useEffect(() => setView(activeView), [activeView]);
  useEffect(() => { setMember(activeFilters.member); setChannel(activeFilters.channel); setExpertStage(activeFilters.expertStage); setLeaveRisk(activeFilters.leaveRisk); setLeaveOrder(activeFilters.leaveOrder); setStage(activeFilters.stage); }, [activeFilters]);
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesSearch =
        !keyword ||
        customer.phone.includes(keyword) ||
        (customer.customerName ?? "").toLowerCase().includes(keyword);
      const leaveAssessment = assessGroupLeave(customer.joinedOn, customer.leftOn);
      const hasActiveOrder = Boolean(customer.order && !customer.order.voided);
      const currentExpertStage = resolveExpertWorkflowStage({ ...customer, hasActiveOrder });
      const matchesView = view === "left"
        ? customer.groupStatus === "LEFT"
        : view === "inGroup"
          ? customer.groupStatus === "JOINED" && !customer.expertIntroducedOn
          : view === "introduced"
          ? currentExpertStage === "QUEUED"
          : view === "expertProgress"
              ? Boolean(currentExpertStage) && currentExpertStage !== "QUEUED" && currentExpertStage !== "ORDERED"
              : currentExpertStage === "ORDERED";
      const customerStage = groupCustomerStage(customer);
      const matchesStage = !stage ||
        (stage === "IN_GROUP_PENDING_EXPERT" && customerStage === "在群待推专家") ||
        (stage === "LEFT" && customer.groupStatus === "LEFT");
      return (
        matchesSearch &&
        matchesView &&
        matchesStage &&
        (!member || customer.ownerName === member) &&
        (!channel || customer.channelName === channel) &&
        (view !== "left" || !leaveRisk || leaveAssessment.level === leaveRisk) &&
        (view !== "left" || !leaveOrder || (leaveOrder === "ordered" ? hasActiveOrder : !hasActiveOrder)) &&
        (!expertStage || currentExpertStage === expertStage)
      );
    }).sort((left, right) =>
      groupCustomerStagePriority(left) - groupCustomerStagePriority(right) ||
      (left.groupStatus === "LEFT" ? 1 : 0) - (right.groupStatus === "LEFT" ? 1 : 0) ||
      (left.joinedOn ?? "9999-12-31").localeCompare(right.joinedOn ?? "9999-12-31"),
    );
  }, [channel, customers, expertStage, leaveOrder, leaveRisk, member, search, stage, view]);
  // 标签数字表示当前真实工作量；历史客户确认入群后同样需要炒群继续处理。
  const inGroupCount = viewCounts.inGroup;
  const introducedCount = viewCounts.introduced;
  const expertProgressCount = viewCounts.expertProgress;
  const orderedCount = viewCounts.ordered;
  const leftCount = viewCounts.left;
  const selected =
    customers.find((customer) => customer.id === selectedId) ?? null;
  const assignmentCustomer = customers.find((customer) => customer.id === assignmentId) ?? null;
  const contactCustomer = customers.find((customer) => customer.id === contactId) ?? null;
  const progressCustomer = customers.find((customer) => customer.id === progressId) ?? null;
  const editingCustomer = customers.find((customer) => customer.id === editingId) ?? null;
  const today = currentDate;

  async function updateCustomer(
    customer: GroupCustomer,
    action: "leaveGroup" | "undoLeaveGroup" | "introduceExpert" | "undoIntroduceExpert" | "markExpertContacted" | "undoExpertContacted" | "updateGroupProgress" | "updateGroupDetails",
    extra: Record<string, string> = {},
  ) {
    setBusy(customer.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/leads/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          occurredOn: extra.occurredOn || today,
          ...extra,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      if (action === "introduceExpert") setAssignmentId(null);
      if (action === "markExpertContacted") setContactId(null);
      if (action === "updateGroupProgress") setProgressId(null);
      if (action === "updateGroupDetails") setEditingId(null);
      const messages = {
        leaveGroup: "已标记退群，客户已进入已退群列表",
        undoLeaveGroup: "已撤销退群，客户已恢复到在群列表",
        introduceExpert: "已推专家并分配负责人；客户当前为排队中，设备号由专家接待时填写",
        undoIntroduceExpert: "已撤销推专家并清除负责人",
        markExpertContacted: "已确认客户联系专家",
        undoExpertContacted: "已撤销专家已联系状态",
        updateGroupProgress: "今日进度已保存",
        updateGroupDetails: "客户资料已保存",
      } as const;
      setNotice(messages[action]);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy("");
    }
  }

  function requestCustomerAction(
    customer: GroupCustomer,
    action: GroupCustomerAction,
  ) {
    const correction = action !== "leaveGroup";
    const config = {
      leaveGroup: ["确认客户已经退群？", (() => { const assessment = assessGroupLeave(customer.joinedOn, today); return `当前为进群第 ${assessment.dayNumber ?? "—"} 天，将标记为“${assessment.label}”，并记录当时是否已经开单。`; })(), "确认退群"],
      undoLeaveGroup: ["确认撤销退群？", "客户会恢复为在群状态，原因会保留在操作记录中。", "确认撤销退群"],
      undoIntroduceExpert: ["确认撤销推专家？", "专家负责人和联系状态会一并清除，历史操作仍会保留。", "确认撤销介绍"],
      undoExpertContacted: ["确认撤销已联系状态？", "客户会重新变成待联系，原因会保留在操作记录中。", "确认撤销已联系"],
    }[action];
    setError("");
    setConfirmation({
      title: config[0],
      description: config[1],
      confirmLabel: config[2],
      target: `${customer.phone}${customer.customerName ? ` · ${customer.customerName}` : ""}`,
      tone: correction || action === "leaveGroup" ? "danger" : "primary",
      ...(action === "leaveGroup" ? { reasonLabel: "退群备注（可选）", reasonPlaceholder: "例如：客户不再参与群内互动，主动退出" , reasonRequired: false } : {}),
      ...(correction ? { reasonLabel: "操作原因", reasonPlaceholder: "例如：刚才误点了" } : {}),
      onConfirm: async (reason) => {
        await updateCustomer(customer, action, reason ? (action === "leaveGroup" ? { leaveNote: reason } : { reason }) : {});
        setConfirmation(null);
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
    router.push(`/group-customers${suffix ? `?${suffix}` : ""}`);
  }

  function selectView(nextView: GroupCustomerView, resetFineFilters = true) {
    setView(nextView);
    const params = new URLSearchParams(window.location.search);
    if (resetFineFilters) {
      setStage("");
      setExpertStage("");
      params.delete("expertStage");
      params.delete("stage");
    }
    params.set("view", nextView);
    if (nextView !== "left") {
      params.delete("leaveRisk");
      params.delete("leaveOrder");
    }
    params.delete("page");
    router.push(`/group-customers?${params.toString()}`);
  }

  function selectFilter(name: "member" | "channel" | "expertStage" | "leaveRisk" | "leaveOrder" | "stage", value: string, nextView?: GroupCustomerView) {
    const params = new URLSearchParams(window.location.search);
    if (value) params.set(name, value); else params.delete(name);
    if (nextView) params.set("view", nextView);
    if (nextView && nextView !== "left") {
      params.delete("leaveRisk");
      params.delete("leaveOrder");
    }
    params.delete("page");
    router.push(`/group-customers?${params.toString()}`);
  }

  return (
    <>
      <section className="panel overflow-hidden">
        {canAddHistorical ? <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3"><p className="text-sm text-slate-600">老客户号码只录入一次；接粉确认入群后自动进入炒群，炒群可直接补录已经在群的历史客户。</p><button type="button" onClick={() => { setError(""); setHistoricalEntryOpen(true); }} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-50">+ 录入老客户</button></div> : null}
        <GroupCustomerFilters
          values={{ search, member, expertStage, channel, view, leaveRisk, leaveOrder, stage }}
          members={members}
          channels={channels}
          inGroupCount={inGroupCount}
          introducedCount={introducedCount}
          expertProgressCount={expertProgressCount}
          orderedCount={orderedCount}
          leftCount={leftCount}
          earlyLeftCount={earlyLeftCount}
          filteredCount={filtered.length}
          onSearchSubmit={submitSearch}
          onChange={(next) => {
            if (next.search !== undefined) setSearch(next.search);
            if (next.member !== undefined) { setMember(next.member); selectFilter("member", next.member); }
            if (next.expertStage !== undefined) {
              setExpertStage(next.expertStage);
              selectFilter("expertStage", next.expertStage, next.expertStage === "QUEUED" ? "introduced" : next.expertStage === "ORDERED" ? "ordered" : next.expertStage ? "expertProgress" : undefined);
            }
            if (next.channel !== undefined) { setChannel(next.channel); selectFilter("channel", next.channel); }
            if (next.leaveRisk !== undefined) { setLeaveRisk(next.leaveRisk); selectFilter("leaveRisk", next.leaveRisk, "left"); }
            if (next.leaveOrder !== undefined) { setLeaveOrder(next.leaveOrder); selectFilter("leaveOrder", next.leaveOrder, "left"); }
            if (next.stage !== undefined) {
              setStage(next.stage);
              selectFilter("stage", next.stage, next.stage === "IN_GROUP_PENDING_EXPERT" ? "inGroup" : next.stage === "LEFT" ? "left" : undefined);
            }
            if (next.view !== undefined) {
              selectView(next.view);
            }
          }}
        />
        {notice && <p role="status" className="m-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p>}
        {error && !confirmation && <p className="m-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <GroupCustomerDataTable
          customers={filtered}
          view={view}
          canEdit={canEdit}
          busy={busy}
          today={today}
          onDetail={(customer) => setSelectedId(customer.id)}
          onProgress={(customer) => { setError(""); setProgressId(customer.id); }}
          onAssignment={(customer) => { setError(""); setAssignmentId(customer.id); }}
          onContact={(customer) => { setError(""); setContactId(customer.id); }}
          onEdit={(customer) => { setError(""); setEditingId(customer.id); }}
          onAction={requestCustomerAction}
        />
      </section>
      <GroupCustomerDetails
        customer={selected}
        canEdit={canEdit}
        today={today}
        onClose={() => setSelectedId(null)}
        onProgress={() => { setError(""); if (selected) setProgressId(selected.id); }}
      />
      <GroupProgressDialog
        customer={progressCustomer}
        currentDate={today}
        dayNumber={progressCustomer ? groupDayNumber(progressCustomer.joinedOn, today) : null}
        existingNote={progressCustomer?.groupProgress.find((item) => item.occurredOn === today)?.note ?? ""}
        busy={Boolean(progressCustomer && busy === progressCustomer.id)}
        error={progressCustomer ? error : ""}
        onClose={() => { if (!busy) { setProgressId(null); setError(""); } }}
        contactAccounts={contactAccounts}
        selectedAccountId={progressCustomer?.groupDeviceAccountId && contactAccounts.some((account) => account.id === progressCustomer.groupDeviceAccountId) ? progressCustomer.groupDeviceAccountId : ""}
        onConfirm={(progressNote, deviceAccountId) => {
          if (progressCustomer) void updateCustomer(progressCustomer, "updateGroupProgress", { progressNote, occurredOn: today, ...(deviceAccountId ? { deviceAccountId } : {}) });
        }}
      />
      <GroupCustomerEditor
        customer={editingCustomer}
        busy={Boolean(editingCustomer && busy === editingCustomer.id)}
        error={editingCustomer ? error : ""}
        onClose={() => { if (!busy) { setEditingId(null); setError(""); } }}
        onSave={(values) => { if (editingCustomer) void updateCustomer(editingCustomer, "updateGroupDetails", values); }}
      />
      <ExpertAssignmentDialog
        customer={assignmentCustomer}
        assignees={assignees}
        occurredOn={today}
        busy={Boolean(assignmentCustomer && busy === assignmentCustomer.id)}
        error={assignmentCustomer ? error : ""}
        onClose={() => { if (!busy) { setAssignmentId(null); setError(""); } }}
        onConfirm={(expertOwnerId, occurredOn) => {
          if (assignmentCustomer) void updateCustomer(assignmentCustomer, "introduceExpert", { expertOwnerId, occurredOn });
        }}
      />
      <ExpertContactDialog
        customer={contactCustomer}
        occurredOn={today}
        busy={Boolean(contactCustomer && busy === contactCustomer.id)}
        error={contactCustomer ? error : ""}
        onClose={() => { if (!busy) { setContactId(null); setError(""); } }}
        onConfirm={(occurredOn, contactNote) => {
          if (contactCustomer) void updateCustomer(contactCustomer, "markExpertContacted", { occurredOn, contactNote });
        }}
      />
      <WorkflowConfirmationDialog
        confirmation={confirmation}
        busy={Boolean(busy)}
        error={confirmation ? error : ""}
        onClose={() => { if (!busy) { setConfirmation(null); setError(""); } }}
      />
      <HistoricalCustomerDialog open={historicalEntryOpen} today={today} entryRole={historicalImportOptions?.entryRole ?? "GROUP_OPERATOR"} members={historicalImportOptions?.members ?? []} channels={historicalImportOptions?.channels ?? []} currentUserId={historicalImportOptions?.currentUserId ?? ""} onClose={() => setHistoricalEntryOpen(false)} onCreated={() => router.refresh()} />
    </>
  );
}
