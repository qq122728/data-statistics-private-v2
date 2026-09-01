"use client";

import {
  CaretLeft,
  CaretRight,
  Check,
  ChatCircleDots,
  ChartLineUp,
  FileArrowUp,
  MagnifyingGlass,
  SignIn,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EntryChannel } from "./ChannelCombobox";
import { entryError } from "./errors";
import { statisticsDate } from "../../lib/statistics-date";
import {
  WorkflowConfirmationDialog,
  type WorkflowConfirmation,
} from "../ui/WorkflowConfirmationDialog";
import { formatUsd as money } from "../../lib/money";
import type {
  EntryBatch as Batch,
  EntryCustomerOrder,
  EntryDevice as Device,
  EntryException as Exception,
  EntryFinanceEvent as FinanceEvent,
  EntryLead as Lead,
  EntrySummary as Summary,
  GroupJoinLot,
} from "./entry-types";
export type { EntryCustomerOrder, GroupJoinLot } from "./entry-types";
import { EntryWorkflowNextStep, EntryWorkflowStatus } from "./EntryWorkflowStatus";
import { EntryExpertTable, EntryGroupTable, EntryReceptionArchiveTable } from "./EntryCustomerTables";
import { buildEntryFinanceHistory, EntryFinanceHistory, EntryFinanceSummary } from "./EntryFinancePanels";
import { EntryOverview } from "./EntryOverview";
import { EntryImportPanel, EntryInvalidLibrary, EntryReplyPanel, type ImportBatchSummary, type ImportCustomerRow } from "./EntryReceptionPanels";
import { CustomerProfileDrawer } from "./CustomerProfileDrawer";
import { ReceptionDownstreamProgress } from "./ReceptionDownstreamProgress";
import { InvalidFanReportPanel } from "./InvalidFanReviewPanel";
import { splitPhoneTokens } from "../../lib/phone-import";
import { resolveExpertWorkflowStage } from "../../lib/expert-workflow-stage";
import { isReceptionReplyArchived, receptionReplyArchiveType } from "../../lib/reception-reply-queue";
import { HistoricalCustomerDialog, type HistoricalCustomerChannel, type HistoricalCustomerMember } from "../lead/HistoricalCustomerDialog";

type Tab =
  | "import"
  | "reply"
  | "group"
  | "expert"
  | "order"
  | "finance"
  | "progress"
  | "invalid"
  | "overview"
  | "exceptions";
const tabs: Array<{ id: Tab; label: string; icon: typeof FileArrowUp }> = [
  { id: "import", label: "号码导入", icon: FileArrowUp },
  { id: "reply", label: "客户回复管理", icon: ChatCircleDots },
  { id: "progress", label: "客户进度", icon: ChartLineUp },
  { id: "invalid", label: "扣粉统计", icon: WarningCircle },
];
const exceptionLabel: Record<Exception["kind"], string> = {
  INVALID_FORMAT: "格式错误",
  DUPLICATE_IN_PASTE: "本次表格内重复",
  COLLISION: "系统已有号码（撞粉）",
  MANUAL_INVALID: "历史作废",
};
export function EntryTabs({
  role = "RECEPTION",
  channels,
  batches,
  leads: initialLeads,
  exceptions = [],
  overview,
  invalidReports = [],
  timezone,
  allowMemberChannelCreation = false,
  devices = [],
  attributionOwners = [],
  defaultAttributionOwnerId = "",
  historicalMembers = [],
  historicalChannels = [],
  currentUserId = "",
}: {
  role?: "RECEPTION" | "LEAD";
  channels: EntryChannel[];
  batches: Batch[];
  leads: Lead[];
  exceptions?: Exception[];
  overview?: {
    mine: Summary;
    group: Summary;
    channels: Array<{ channel: string; mine: Summary; group: Summary }>;
  };
  invalidReports?: Array<{ batchId: string; sourceDate: string; noWsCount: number; lowAmountCount: number; collisionCount: number; total: number }>;
  timezone: string;
  allowMemberChannelCreation?: boolean;
  devices?: Device[];
  attributionOwners?: Array<{ id: string; name: string }>;
  defaultAttributionOwnerId?: string;
  historicalMembers?: HistoricalCustomerMember[];
  historicalChannels?: HistoricalCustomerChannel[];
  currentUserId?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const today = statisticsDate();
  const workspace = searchParams.get("workspace") === "handoff" || searchParams.get("tab") === "group"
    ? "handoff"
    : "intake";
  const visibleTabs = role === "LEAD" ? [{ id: "invalid" as const, label: "无效粉审核", icon: WarningCircle }] : tabs;
  const [tab, setTab] = useState<Tab>("import");
  const [leads, setLeads] = useState(initialLeads);
  const [sourceDate, setSourceDate] = useState(today);
  const [availableChannels, setAvailableChannels] = useState(channels);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState<"SMS" | "ADS" | "REBATE">("SMS");
  const [addingChannel, setAddingChannel] = useState(false);
  const nextImportRowId = useRef(2);
  const emptyImportRow = (id: string): ImportCustomerRow => ({
    id,
    phone: "",
    customerName: "",
    customerEmail: "",
    deviceMode: "SELECT",
    deviceId: "",
    deviceCode: "",
    lossAmount: "",
    customerPlatform: "",
    notes: "",
    attributionOwnerId: defaultAttributionOwnerId,
  });
  const [importRows, setImportRows] = useState<ImportCustomerRow[]>(() => [emptyImportRow("import-row-1")]);
  const [importBatchId, setImportBatchId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [search, setSearch] = useState("");
  const [listPage, setListPage] = useState(1);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [historicalEntryOpen, setHistoricalEntryOpen] = useState(false);
  const [confirmation, setConfirmation] =
    useState<WorkflowConfirmation | null>(null);
  const [profileEditorId, setProfileEditorId] = useState<string | null>(null);
  const [profileViewerId, setProfileViewerId] = useState<string | null>(null);
  const [profileDeviceMode, setProfileDeviceMode] = useState<"SELECT" | "MANUAL">("SELECT");
  const [profileDraft, setProfileDraft] = useState({
    phone: "",
    customerName: "",
    customerEmail: "",
    deviceId: "",
    deviceCode: "",
    lossAmount: "",
    customerPlatform: "",
    notes: "",
  });
  const [financeSavingId, setFinanceSavingId] = useState("");
  const [invalidReasons, setInvalidReasons] = useState<Record<string, string>>(
    {},
  );
  const [phoneDrafts, setPhoneDrafts] = useState<Record<string, string>>({});
  const [deviceDrafts, setDeviceDrafts] = useState<Record<string, string>>({});
  const deviceSaveRequests = useRef<
    Record<string, Promise<boolean> | undefined>
  >({});
  const [orderDrafts, setOrderDrafts] = useState<
    Record<string, { date: string; amount: string }>
  >({});
  const [financeDrafts, setFinanceDrafts] = useState<
    Record<
      string,
      {
        date: string;
        kind: "RECHARGE" | "WITHDRAWAL";
        amount: string;
        note: string;
      }
    >
  >({});
  const [groupList, setGroupList] = useState<"pending" | "joined" | "left">(
    "pending",
  );
  const [replyList, setReplyList] = useState<"pending" | "readyToJoin" | "archived">("pending");
  const [replyArchiveFilter, setReplyArchiveFilter] = useState<"all" | "UNANSWERED" | "NOT_JOINED">("all");
  // 号码一多，逐条点"确认已回复"太慢；勾选多条一次性处理。
  const [selectedReplyIds, setSelectedReplyIds] = useState<Set<string>>(new Set());
  const [bulkReplyBusy, setBulkReplyBusy] = useState(false);
  const [downstreamFocusId, setDownstreamFocusId] = useState<string | null>(null);
  const [expertList, setExpertList] = useState<"intro" | "register" | "done">(
    "intro",
  );
  const [orderList, setOrderList] = useState<"pending" | "done">("pending");
  const [financeList, setFinanceList] = useState<"new" | "history">("new");
  const [progressList, setProgressList] = useState<"joined" | "introduced" | "expert" | "ordered" | "historical">("joined");
  const [invalidList, setInvalidList] = useState<"all" | "LOW_AMOUNT" | "NO_WS" | "DUPLICATE">("all");
  // 导入批次可能刚好被其他成员写入。先在浏览器接管后再展示，避免服务端和浏览器
  // 在同一瞬间读到不同批次而出现 React 的“页面不一致”提示。
  const [importHistoryReady, setImportHistoryReady] = useState(false);

  useEffect(() => setLeads(initialLeads), [initialLeads]);
  useEffect(() => setAvailableChannels(channels), [channels]);
  useEffect(() => setImportHistoryReady(true), []);
  useEffect(() => { setListPage(1); }, [tab, batchId, search, progressList, replyList, replyArchiveFilter, invalidList]);
  // “设备号未填写”等提示只属于客户回复页；离开后清掉，避免其他页面看起来像报错。
  useEffect(() => { setError(""); }, [tab]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const requested = searchParams.get("tab");
    if (visibleTabs.some((item) => item.id === requested)) {
      setTab(requested as Tab);
    } else {
      setTab(role === "LEAD" ? "invalid" : workspace === "handoff" ? "progress" : "import");
    }
  }, [searchParams, visibleTabs, workspace]);
  const visible = useMemo(
    () =>
      leads.filter(
        (lead) =>
          (!batchId || lead.batch.id === batchId) &&
          lead.phone.includes(search.trim()),
      ),
    [batchId, leads, search],
  );
  const recognizedPhoneCount = useMemo(() => importRows.filter((row) => row.phone.trim()).length, [importRows]);
  const importBatchSummaries = useMemo<ImportBatchSummary[]>(() => {
    const byBatch = new Map<string, ImportBatchSummary>();
    for (const batch of batches) {
      byBatch.set(batch.id, { id: batch.id, sourceDate: batch.sourceDate, channelName: batch.channel.name, total: 0, valid: 0, lowAmount: 0, noWs: 0, collision: 0 });
    }
    for (const lead of leads) {
      const current = byBatch.get(lead.batch.id) ?? {
        id: lead.batch.id,
        sourceDate: lead.batch.sourceDate,
        channelName: lead.batch.channel.name,
        total: 0,
        valid: 0,
        lowAmount: 0,
        noWs: 0,
        collision: 0,
      };
      current.total += 1;
      if (lead.receptionCategory === "PENDING" || lead.receptionCategory === "VALID") current.valid += 1;
      if (lead.receptionCategory === "LOW_AMOUNT") current.lowAmount += 1;
      if (lead.receptionCategory === "NO_WS") current.noWs += 1;
      byBatch.set(lead.batch.id, current);
    }
    for (const report of invalidReports) {
      const current = byBatch.get(report.batchId);
      if (!current) continue;
      current.total += report.total;
      current.lowAmount += report.lowAmountCount;
      current.noWs += report.noWsCount;
      current.collision += report.collisionCount;
    }
    return [...byBatch.values()].sort((left, right) => right.sourceDate.localeCompare(left.sourceDate) || left.channelName.localeCompare(right.channelName));
  }, [batches, invalidReports, leads]);
  const importBatchLeads = importBatchId ? leads.filter((lead) => lead.batch.id === importBatchId) : [];

  async function importCustomers() {
    setNotice("");
    setError("");
    const filledRows = importRows.filter((row) => row.phone.trim());
    if (!sourceDate || !channelId || !filledRows.length) {
      setError("请先选择渠道，并录入至少一位客户");
      return;
    }
    const rows: Array<Record<string, unknown>> = [];
    for (const row of filledRows) {
      const rawAmount = row.lossAmount.trim();
      let lossAmountCents: number | null | undefined;
      if (rawAmount) {
        const amount = Number(rawAmount);
        if (!Number.isFinite(amount) || amount < 0) {
          setError("客户金额请输入大于或等于 0 的数字");
          return;
        }
        lossAmountCents = Math.round(amount * 100);
      }
      rows.push({
        phone: row.phone.trim(),
        ...(row.customerName.trim() ? { customerName: row.customerName.trim() } : {}),
        ...(row.customerEmail.trim() ? { customerEmail: row.customerEmail.trim() } : {}),
        ...(lossAmountCents !== undefined ? { lossAmountCents } : {}),
        ...(row.customerPlatform.trim() ? { customerPlatform: row.customerPlatform.trim() } : {}),
        ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
        attributionOwnerId: row.attributionOwnerId || defaultAttributionOwnerId,
      });
    }
    setBusy("import");
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceDate,
          rows,
          channelId,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "导入失败");
      const duplicateInPasteText = result.duplicateInPasteCount
        ? `；本次表格内重复 ${result.duplicateInPasteCount} 个`
        : "";
      const collisionText = result.collisionCount
        ? `；检测到系统已有号码（撞粉）${result.collisionCount} 个：${result.collisions.map((item: { phone: string; ownerName: string }) => `${item.phone}（${item.ownerName}）`).join("、")}，请在下方扣粉登记手动填写`
        : "";
      const lowAmountText = result.lowAmountCount
        ? `；${result.lowAmountCount} 个低于 $5,000，未导入，请在下方扣粉登记手动填写`
        : "";
      setNotice(
        `已导入 ${result.imported} 个有效客户${duplicateInPasteText}${collisionText}${lowAmountText}`,
      );
      setImportRows([emptyImportRow(`import-row-${nextImportRowId.current++}`)]);
      setChannelId(result.batch.channelId);
      setImportBatchId(result.batch.id);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入失败");
    } finally {
      setBusy("");
    }
  }

  async function createChannel() {
    setNotice("");
    setError("");
    const name = newChannelName.trim();
    if (!name) {
      setError("请输入新渠道名称");
      return;
    }
    setBusy("create-channel");
    try {
      const response = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, channelType: newChannelType }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "渠道创建失败");
      const channel = result.channel as EntryChannel;
      setAvailableChannels((rows) => rows.some((item) => item.id === channel.id) ? rows : [...rows, channel]);
      setChannelId(channel.id);
      setNewChannelName("");
      setNewChannelType("SMS");
      setAddingChannel(false);
      setNotice(result.created ? `已创建${newChannelType === "ADS" ? "投流粉" : newChannelType === "REBATE" ? "底料返点" : "短信粉"}渠道“${channel.name}”并选中` : `渠道“${channel.name}”已存在，已为你选中`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "渠道创建失败");
    } finally {
      setBusy("");
    }
  }

  async function updateLead(
    lead: Lead,
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<Lead | null> {
    setNotice("");
    setError("");
    setBusy(lead.id);
    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, occurredOn: today, ...extra }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setLeads((rows) =>
        rows.map((row) =>
          row.id === lead.id ? { ...row, ...result.lead } : row,
        ),
      );
      const messages: Record<string, string> = {
        assignDevice: "设备号已分配",
        followUp: "已累计一次回访",
        reply: "已确认联系，客户已进入待入群",
        undoReply: "已撤销回复，客户已回到待回复",
        joinGroup: "已确认入群",
        leaveGroup: "已记录退群",
        introduceExpert: "已记录推专家",
        register: "已记录注册",
        markInvalid: "已标记为无效粉",
        voidErroneousEntry: "已标记为误录作废，已从有效数据中排除",
        restoreValid: "已恢复为有效粉",
        undoJoinGroup: "已撤销入群，客户回到待入群",
        undoLeaveGroup: "已撤销退群，客户恢复为在群",
        undoIntroduceExpert: "已撤销推专家",
        undoRegister: "已撤销注册",
        voidOrder: "开单已作废，客户回到待开单",
        updateProfile: "客户资料已保存",
        updateReceptionChatStatus: "客户聊天状态已更新",
        archiveRepliedCustomer: "客户已归入未进群归档",
      };
      if (messages[action]) setNotice(messages[action]);
      // 回复与撤销回复已经用上方的 setLeads 更新当前行；这里不要整页刷新。
      // 否则浏览器可能把当前“客户回复管理”重置到默认的“号码导入”页。
      return result.lead;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function correctLead(
    lead: Lead,
    action:
      | "undoJoinGroup"
      | "undoLeaveGroup"
      | "undoIntroduceExpert"
      | "undoRegister"
      | "voidOrder",
    label: string,
  ) {
    setConfirmation({
      title: `确认${label}？`,
      description: "系统不会删除历史，会保留这次纠错的操作人、时间和原因。",
      confirmLabel: `确认${label}`,
      target: `${lead.phone}${lead.customerName ? ` · ${lead.customerName}` : ""}`,
      tone: "danger",
      reasonLabel: "纠错原因",
      reasonPlaceholder: "例如：刚才误点了",
      onConfirm: async (reason) => {
        await updateLead(lead, action, { reason });
        setConfirmation(null);
      },
    });
  }

  async function voidFinance(lead: Lead, event: FinanceEvent, label: string, reason: string): Promise<boolean> {
    setBusy(event.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/customer-finance/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", reason: reason.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "作废失败");
      setLeads((rows) =>
        rows.map((row) =>
          row.id === lead.id && row.customerOrder
            ? {
                ...row,
                customerOrder: {
                  ...row.customerOrder,
                  events: row.customerOrder.events.map((item) =>
                    item.id === event.id ? { ...item, ...result.event } : item,
                  ),
                },
              }
            : row,
        ),
      );
      setNotice(`${label}已作废，原记录已保留`);
      router.refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "作废失败");
      return false;
    } finally {
      setBusy("");
    }
  }

  function requestVoidFinance(lead: Lead, event: FinanceEvent, label: string) {
    setError("");
    setConfirmation({
      title: `确认作废${label}？`,
      description: "作废后这笔金额不会再计入业绩，但原始流水和作废原因会保留。",
      confirmLabel: "确认作废",
      target: `${lead.phone} · ${label} ${money(event.amountCents ?? 0)}`,
      tone: "danger",
      reasonLabel: "作废原因",
      reasonPlaceholder: "例如：金额录错或重复登记",
      onConfirm: async (reason) => {
        if (await voidFinance(lead, event, label, reason)) setConfirmation(null);
      },
    });
  }

  async function saveDeviceOnBlur(lead: Lead, rawCode: string) {
    const currentRequest = deviceSaveRequests.current[lead.id];
    if (currentRequest) return currentRequest;
    const deviceCode = rawCode.trim();
    const savedCode = lead.device?.code ?? "";
    if (!deviceCode) {
      // 设备号不能清空；避免误删输入后，把已保存的号码还原到输入框。
      setDeviceDrafts((rows) => ({ ...rows, [lead.id]: savedCode }));
      setError(`请为 ${lead.phone} 填写设备号后再保存或标记回复`);
      return Boolean(savedCode);
    }
    if (deviceCode === savedCode) return true;
    const request = updateLead(lead, "assignDevice", { deviceCode }).then(
      Boolean,
    );
    deviceSaveRequests.current[lead.id] = request;
    try {
      return await request;
    } finally {
      delete deviceSaveRequests.current[lead.id];
    }
  }

  async function followUpOrReply(lead: Lead, action: "followUp" | "reply") {
    const deviceCode = deviceDrafts[lead.id] ?? lead.device?.code ?? "";
    if (!lead.device?.code || deviceCode.trim() !== lead.device.code) {
      const saved = await saveDeviceOnBlur(lead, deviceCode);
      if (!saved) return;
    }
    await updateLead(lead, action);
  }

  function requestLeadAction(
    lead: Lead,
    action: "restoreValid" | "followUp" | "reply" | "undoReply" | "joinGroup" | "leaveGroup",
    extra: Record<string, unknown> = {},
  ) {
    const config = {
      restoreValid: ["确认恢复为有效数据？", "恢复后会重新进入待回复，并重新计入有效数据。", "确认恢复有效", false],
      followUp: ["确认记录一次回访？", "确认后回访次数会增加 1 次，并记录今天为最近回访日期。", "确认回访 +1", false],
      reply: ["确认客户已经联系？", lead.invalid ? "会保留在扣粉统计，并标记已联系；不会计入有效数据或转化率。" : "确认后客户会从待回复进入待入群，设备号会记录为本次实际联系使用的前台设备。", "确认已回复", false],
      undoReply: ["确认撤销客户回复？", "撤销后客户会回到待回复。仅未拉群、未推专家、未开单的客户可以撤销；请填写原因，方便以后核对。", "确认撤销回复", true],
      joinGroup: ["确认客户已经入群？", lead.invalid ? "会保留在扣粉统计，同时交接给炒群员查看和填写炒群情况；不会计入业绩或转化统计。" : "确认后客户会交接到炒群岗位继续跟进。", "确认入群", false],
      leaveGroup: ["确认客户已经退群？", "确认后客户会进入已退群名单；如误操作需要填写原因撤销。", "确认退群", true],
    }[action] as [string, string, string, boolean];
    setConfirmation({
      title: config[0],
      description: config[1],
      confirmLabel: config[2],
      target: `${lead.phone}${lead.customerName ? ` · ${lead.customerName}` : ""}`,
      tone: config[3] ? "danger" : "primary",
      ...(action === "undoReply" ? {
        reasonLabel: "撤销原因",
        reasonPlaceholder: "例如：误点，客户实际未回复",
      } : {}),
      onConfirm: async (reason) => {
        if (action === "followUp" || action === "reply") await followUpOrReply(lead, action);
        else await updateLead(lead, action, action === "undoReply" ? { ...extra, reason } : extra);
        setConfirmation(null);
      },
    });
  }

  function requestArchiveRepliedCustomer(lead: Lead) {
    setConfirmation({
      title: "确认手动归档该客户？",
      description: "用于已经回复但最终没有进群的客户。归档后会进入“未进群归档”，不会算作未回复归档。",
      confirmLabel: "确认归档",
      target: `${lead.phone}${lead.customerName ? ` · ${lead.customerName}` : ""}`,
      tone: "danger",
      reasonLabel: "归档原因",
      reasonPlaceholder: "例如：多次沟通后明确拒绝进群",
      numberLabel: "回访次数",
      numberPlaceholder: "填写实际回访次数",
      defaultNumber: String(lead.followUpCount),
      numberMin: 0,
      numberMax: 999,
      onConfirm: async (reason, _occurredOn, archiveVisitCount) => {
        if (archiveVisitCount === undefined) return;
        const updated = await updateLead(lead, "archiveRepliedCustomer", { reason, archiveVisitCount });
        if (updated) setConfirmation(null);
      },
    });
  }

  function saveReplyProfileField(
    lead: Lead,
    field: "customerName" | "customerEmail" | "lossAmount" | "customerPlatform" | "notes",
    rawValue: string,
  ) {
    const value = rawValue.trim();
    if (field === "lossAmount") {
      if (!value) {
        if (lead.lossAmountCents !== null)
          void updateLead(lead, "updateProfile", { lossAmountCents: null });
        return;
      }
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) {
        setError("客户金额请输入大于或等于 0 的数字");
        return;
      }
      const lossAmountCents = Math.round(amount * 100);
      if (lossAmountCents !== lead.lossAmountCents)
        void updateLead(lead, "updateProfile", { lossAmountCents });
      return;
    }
    const current = lead[field] ?? "";
    if (value !== current)
      void updateLead(lead, "updateProfile", { [field]: value });
  }

  async function savePhoneOnBlur(lead: Lead, rawPhone: string) {
    const phone = rawPhone.trim();
    if (!phone || phone === lead.phone) {
      setPhoneDrafts((rows) => ({ ...rows, [lead.id]: lead.phone }));
      return;
    }
    const updated = await updateLead(lead, "updatePhone", { phone });
    if (!updated)
      setPhoneDrafts((rows) => ({ ...rows, [lead.id]: lead.phone }));
  }

  function openProfileEditor(lead: Lead) {
    setError("");
    setProfileEditorId(lead.id);
    setProfileDeviceMode("SELECT");
    setProfileDraft({
      phone: lead.phone,
      customerName: lead.customerName ?? "",
      customerEmail: lead.customerEmail ?? "",
      deviceId: lead.device?.id ?? "",
      deviceCode: "",
      lossAmount: lead.lossAmountCents === null ? "" : String(lead.lossAmountCents / 100),
      customerPlatform: lead.customerPlatform ?? "",
      notes: lead.notes ?? "",
    });
  }

  async function saveProfileEditor(lead: Lead) {
    const amountText = profileDraft.lossAmount.trim();
    const amount = amountText ? Number(amountText) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError("客户金额请输入大于或等于 0 的数字");
      return;
    }
    const phone = profileDraft.phone.trim();
    if (!phone) {
      setError("请输入客户编号");
      return;
    }
    if (phone !== lead.phone) {
      const phoneUpdated = await updateLead(lead, "updatePhone", { phone });
      if (!phoneUpdated) return;
    }
    const payload: Record<string, unknown> = {
      customerName: profileDraft.customerName.trim(),
      customerEmail: profileDraft.customerEmail.trim(),
      lossAmountCents: amount === null ? null : Math.round(amount * 100),
      customerPlatform: profileDraft.customerPlatform.trim(),
      notes: profileDraft.notes.trim(),
    };
    if (profileDeviceMode === "SELECT" && profileDraft.deviceId) payload.deviceId = profileDraft.deviceId;
    if (profileDeviceMode === "MANUAL" && profileDraft.deviceCode.trim()) payload.deviceCode = profileDraft.deviceCode.trim();
    const updated = await updateLead(lead, "updateProfile", payload);
    if (!updated) return;
    setProfileEditorId(null);
    setNotice(updated.receptionCategory === "LOW_AMOUNT" ? "资料已保存，客户已自动归入低金额库" : "客户资料已保存");
  }

  async function deleteLead(lead: Lead) {
    setNotice("");
    setError("");
    setBusy(lead.id);
    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "删除失败");
      setLeads((rows) => rows.filter((row) => row.id !== lead.id));
      setNotice("号码已删除");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setBusy("");
    }
  }

  function requestDeleteLead(lead: Lead) {
    setConfirmation({
      title: "确认删除错误导入？",
      description: "仅能删除尚未回复、未拉群的错误导入。删除后会同步冲销该批次的新增和有效数据，资源部统计会自动更正。",
      confirmLabel: "确认删除并冲销统计",
      target: `${lead.phone}${lead.customerName ? ` · ${lead.customerName}` : ""}`,
      tone: "danger",
      onConfirm: async () => {
        await deleteLead(lead);
        setConfirmation(null);
      },
    });
  }

  function requestVoidErroneousEntry(lead: Lead) {
    setConfirmation({
      title: "确认标记为误录？",
      description: "客户已有回访或其他跟进，不能直接删除。确认后会保留历史操作记录，但不再计入有效数据、转化和业绩。",
      confirmLabel: "确认标记误录",
      target: `${lead.phone}${lead.customerName ? ` · ${lead.customerName}` : ""}`,
      tone: "danger",
      reasonLabel: "误录原因",
      reasonPlaceholder: "例如：导入时号码对应错客户",
      onConfirm: async (reason) => {
        const updated = await updateLead(lead, "voidErroneousEntry", { reason });
        if (updated) setConfirmation(null);
      },
    });
  }

  async function openOrder(lead: Lead) {
    const draft = orderDrafts[lead.id] ?? { date: today, amount: "" };
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("请输入大于 0 的首充金额");
      return;
    }
    setBusy(lead.id);
    setError("");
    try {
      const response = await fetch("/api/customer-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          batchId: lead.batch.id,
          phone: lead.phone,
          openedOn: draft.date,
          initialDepositCents: Math.round(amount * 100),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "开单失败");
      const order = result.orders?.[0];
      if (order) {
        setLeads((rows) =>
          rows.map((row) =>
            row.id === lead.id
              ? {
                  ...row,
                  customerOrder: {
                    id: order.id,
                    openedOn: order.openedOn,
                    initialDepositCents: order.initialDepositCents,
                    voidedAt: null,
                    voidReason: null,
                    events: [],
                  },
                }
              : row,
          ),
        );
      }
      setNotice("开单和首充已保存，客户已进入财务流水");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "开单失败");
    } finally {
      setBusy("");
    }
  }

  async function saveFinance(lead: Lead) {
    if (!lead.customerOrder) return;
    const draft = financeDrafts[lead.id] ?? {
      date: today,
      kind: "RECHARGE" as const,
      amount: "",
      note: "",
    };
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("请输入大于 0 的资金金额");
      return;
    }
    const continuationNumber =
      lead.customerOrder.events.filter(
        (event) =>
          event.kind === "RECHARGE" &&
          event.continuationNumber !== null &&
          !event.voidedAt,
      ).length + 1;
    // 财务保存独立于其它页面的自动保存，避免刚修改了资料时把“保存流水”误锁住。
    setFinanceSavingId(lead.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/customer-finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerOrderId: lead.customerOrder.id,
          occurredOn: draft.date,
          kind: draft.kind,
          amountCents: Math.round(amount * 100),
          ...(draft.kind === "RECHARGE" ? { continuationNumber } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(entryError(result, "资金保存失败"));
      const savedEvent = result.events?.[0];
      if (savedEvent) {
        setLeads((rows) =>
          rows.map((row) =>
            row.id === lead.id && row.customerOrder
              ? {
                  ...row,
                  customerOrder: {
                    ...row.customerOrder,
                    events: [...row.customerOrder.events, savedEvent],
                  },
                }
              : row,
          ),
        );
      }
      setNotice(
        draft.kind === "RECHARGE"
          ? `第 ${continuationNumber} 次续充已保存，可到“流水记录”核对`
          : "出金已保存，可到“流水记录”核对",
      );
      setFinanceDrafts((rows) => ({
        ...rows,
        [lead.id]: { date: today, kind: "RECHARGE", amount: "", note: "" },
      }));
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资金保存失败");
    } finally {
      setFinanceSavingId("");
    }
  }

  const actionDisabled = (lead: Lead) => busy === lead.id || bulkReplyBusy;
  const isInvalidLead = (lead: Lead) => lead.invalid || lead.receptionCategory === "INVALID" || lead.receptionCategory === "LOW_AMOUNT" || lead.receptionCategory === "NO_WS";
  // 老客户不重复增加粉数，但补录号码后仍需进入正常待办，承接启用后真实发生的回复、进群等动作。
  const actionable = visible.filter((lead) => !isInvalidLead(lead));
  const allArchivedReplyLeads = actionable.filter((lead) => isReceptionReplyArchived(lead));
  const archivedReplyLeads = allArchivedReplyLeads.filter((lead) => replyArchiveFilter === "all" || receptionReplyArchiveType(lead) === replyArchiveFilter);
  // 按来源日期从旧到新排：等得最久、最容易变凉的号码排最前面，
  // 而不是继承后端 updatedAt desc（最近点过的反而排前面，等于把最该优先处理的埋到后面）。
  const replyPending = actionable
    .filter((lead) => !lead.repliedOn && !isReceptionReplyArchived(lead))
    .sort((left, right) => {
      const bySourceDate = left.batch.sourceDate.localeCompare(right.batch.sourceDate);
      if (bySourceDate !== 0) return bySourceDate;
      return left.followUpCount - right.followUpCount;
    });
  const historicalRows = visible.filter((lead) => lead.isHistoricalRecord);
  const groupPending = actionable.filter(
    (lead) =>
      lead.repliedOn && lead.groupStatus === "NOT_JOINED" && !lead.receptionArchivedAt,
  ).sort((left, right) => {
    if (left.receptionChatStatus !== right.receptionChatStatus)
      return left.receptionChatStatus === "READY_TO_JOIN" ? -1 : 1;
    const leftChanged = left.receptionStatusChangedAt ? new Date(left.receptionStatusChangedAt).getTime() : 0;
    const rightChanged = right.receptionStatusChangedAt ? new Date(right.receptionStatusChangedAt).getTime() : 0;
    return leftChanged - rightChanged;
  });
  const groupJoined = actionable.filter(
    (lead) => lead.groupStatus === "JOINED",
  );
  const groupLeft = actionable.filter(
    (lead) => lead.groupStatus === "LEFT",
  );
  const introPending = actionable.filter(
    (lead) =>
      lead.groupStatus === "JOINED" && !lead.expertIntroducedOn,
  );
  const registerPending = actionable.filter(
    (lead) =>
      lead.groupStatus === "JOINED" &&
      lead.expertIntroducedOn &&
      !lead.registeredOn,
  );
  const registered = actionable.filter((lead) => lead.registeredOn);
  const orderPending = actionable.filter(
    (lead) =>
      lead.groupStatus === "JOINED" &&
      lead.registeredOn &&
      (!lead.customerOrder || lead.customerOrder.voidedAt),
  );
  const orderLeads = actionable.filter((lead) =>
    Boolean(lead.customerOrder && !lead.customerOrder.voidedAt),
  );
  const orderHistoryLeads = actionable.filter((lead) =>
    Boolean(lead.customerOrder),
  );
  const hasActiveOrder = (lead: Lead) => Boolean(lead.customerOrder && !lead.customerOrder.voidedAt);
  const expertStageFor = (lead: Lead) => resolveExpertWorkflowStage({ ...lead, hasActiveOrder: hasActiveOrder(lead) });
  const progressRows = actionable.filter((lead) => {
    if (progressList === "historical") return false;
    if (progressList === "joined") return lead.groupStatus === "JOINED" && !lead.expertIntroducedOn;
    if (progressList === "introduced") return expertStageFor(lead) === "QUEUED";
    if (progressList === "expert") return Boolean(expertStageFor(lead)) && expertStageFor(lead) !== "QUEUED" && expertStageFor(lead) !== "ORDERED";
    return expertStageFor(lead) === "ORDERED";
  });
  const displayedProgressRows = progressList === "historical" ? historicalRows : progressRows;
  const visibleExceptions = exceptions.filter((item) =>
    item.phone.includes(search.trim()),
  );
  const pageSize = 25;
  const activeRows = tab === "progress" ? displayedProgressRows : tab === "reply" ? (replyList === "pending" ? replyPending : replyList === "archived" ? archivedReplyLeads : groupPending) : tab === "group" && groupList === "pending" ? groupPending : [];
  const pageCount = Math.max(1, Math.ceil(activeRows.length / pageSize));
  const safePage = Math.min(listPage, pageCount);
  const pagedReply = replyPending.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pagedArchivedReply = archivedReplyLeads.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pagedGroupPending = groupPending.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pagedProgress = displayedProgressRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  // 翻页、切换筛选或离开"待回复"之后，之前勾的号码就不在眼前了，选择框跟着清空，
  // 避免误以为还选着、结果批量操作到看不见的号码上。
  useEffect(() => {
    setSelectedReplyIds(new Set());
  }, [tab, replyList, safePage]);

  function toggleReplySelected(leadId: string) {
    setSelectedReplyIds((previous) => {
      const next = new Set(previous);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  function toggleReplySelectAll() {
    setSelectedReplyIds((previous) => {
      const selectable = pagedReply.filter((lead) => !actionDisabled(lead));
      const allSelected = selectable.length > 0 && selectable.every((lead) => previous.has(lead.id));
      return allSelected ? new Set() : new Set(selectable.map((lead) => lead.id));
    });
  }

  function requestBulkConfirmReply() {
    const selected = pagedReply.filter((lead) => selectedReplyIds.has(lead.id));
    const ready = selected.filter((lead) => Boolean((deviceDrafts[lead.id] ?? lead.device?.code ?? "").trim()));
    const skipped = selected.length - ready.length;
    if (!ready.length) {
      setError(skipped ? "勾选的号码都还没有填设备号，请先填好设备号再批量确认" : "请先勾选要批量确认的号码");
      return;
    }
    setConfirmation({
      title: `确认这 ${ready.length} 位客户都已经联系？`,
      description: skipped
        ? `确认后这 ${ready.length} 位会从待回复进入待入群；另外 ${skipped} 位还没填设备号，这次不会处理，需要单独确认。`
        : `确认后这 ${ready.length} 位客户会从待回复进入待入群，设备号使用各自当前显示的设备号。`,
      confirmLabel: `批量确认已回复（${ready.length}）`,
      target: ready.map((lead) => lead.phone).join("、"),
      tone: "primary",
      onConfirm: async () => {
        setBulkReplyBusy(true);
        try {
          await Promise.all(ready.map((lead) => followUpOrReply(lead, "reply")));
        } finally {
          setBulkReplyBusy(false);
          setSelectedReplyIds(new Set());
          setConfirmation(null);
        }
      },
    });
  }

  function empty(text: string) {
    return (
      <div className="member-empty">
        <WarningCircle size={19} />
        <span>{text}</span>
      </div>
    );
  }
  function leadContext(lead: Lead) {
    const sourceName = lead.isHistoricalRecord
      ? (lead.historicalSourceName || lead.batch.channel.name)
      : lead.batch.channel.name;
    // 待回复客户按来源日期算等待天数，方便一眼看出一大批号码里哪些最容易变凉；
    // 已回复/历史补录不需要这个提示。
    const waitingDays = lead.repliedOn || lead.isHistoricalRecord
      ? null
      : Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lead.batch.sourceDate}T00:00:00Z`)) / 86400000);
    return (
      <span className="member-muted">
        {waitingDays !== null && waitingDays >= 1 ? (
          <strong className={waitingDays >= 2 ? "mr-1 font-semibold text-red-700" : "mr-1 font-semibold text-amber-700"}>
            已等待 {waitingDays} 天
          </strong>
        ) : null}
        {lead.isHistoricalRecord ? "历史补录 · 历史来源：" : "来源："}{lead.batch.sourceDate} · {sourceName}
        {lead.device ? ` · ${lead.device.code}` : ""}
      </span>
    );
  }
  function notes(lead: Lead) {
    return (
      <input
        aria-label={`${lead.phone} 客户情况`}
        className="member-note"
        defaultValue={lead.notes ?? ""}
        placeholder="填写客户情况"
        onBlur={(event) => {
          if (event.target.value !== (lead.notes ?? ""))
            updateLead(lead, "note", { notes: event.target.value });
        }}
      />
    );
  }

  return (
    <div data-testid="entry-workspace" className="member-workspace">
      <header className="member-header">
        <div>
          <p>{role === "LEAD" ? "无效粉审核" : "接粉工作台"}</p>
          <h2>{role === "LEAD" ? "审核组员填报的无效粉数据，确认后才会进入正式统计" : "先导入有效客户，再单独登记无效粉和管理客户后续进度"}</h2>
        </div>
        {visibleTabs.length > 1 ? <nav className="member-tabs member-tabs--workspace" aria-label="接粉处理页">
          {visibleTabs.map((item) => {
            const Icon = item.icon;
            return <button type="button" key={item.id} data-active={tab === item.id || undefined} onClick={() => setTab(item.id)}><Icon size={16} weight={tab === item.id ? "fill" : "regular"} aria-hidden="true" /><span>{item.label}</span></button>;
          })}
        </nav> : null}
        <label className="member-search">
          <MagnifyingGlass size={16} />
          <input
            aria-label="全程搜索手机号"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索当前工作台号码"
          />
          <span>支持完整号码或后 6 位搜索</span>
        </label>
      </header>
      {tab !== "import" ? <section className="member-filter">
        <label>
          来源批次
          <select
            value={batchId}
            onChange={(event) => setBatchId(event.target.value)}
          >
            <option value="">全部我的客户</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.sourceDate} · {batch.channel.name}
              </option>
            ))}
          </select>
        </label>
        {tab === "progress" ? <div className="member-stage-filter" aria-label="客户进度筛选">
          <button type="button" data-active={progressList === "joined" || undefined} onClick={() => setProgressList("joined")}>在群待推专家 {actionable.filter((lead) => lead.groupStatus === "JOINED" && !lead.expertIntroducedOn).length}</button>
          <button type="button" data-active={progressList === "introduced" || undefined} onClick={() => setProgressList("introduced")}>专家排队中 {actionable.filter((lead) => expertStageFor(lead) === "QUEUED").length}</button>
          <button type="button" data-active={progressList === "expert" || undefined} onClick={() => setProgressList("expert")}>专家跟进中 {actionable.filter((lead) => Boolean(expertStageFor(lead)) && expertStageFor(lead) !== "QUEUED" && expertStageFor(lead) !== "ORDERED").length}</button>
          <button type="button" data-active={progressList === "ordered" || undefined} onClick={() => setProgressList("ordered")}>已开单 {actionable.filter((lead) => expertStageFor(lead) === "ORDERED").length}</button>
          <button type="button" data-active={progressList === "historical" || undefined} onClick={() => setProgressList("historical")}>历史补录 {historicalRows.length}</button>
        </div> : null}
        <span className="member-filter-count">可跟进 {actionable.length} 位 · 扣粉统计 {visible.filter(isInvalidLead).length} 位</span>
      </section> : null}
      {(notice || error) && (
        <p
          role={error ? "alert" : "status"}
          className={`member-feedback ${error ? "is-error" : ""}`}
        >
          {error || notice}
        </p>
      )}

      {tab === "import" && (
        <>
          <div className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3"><div><strong className="text-sm text-slate-900">系统启用前的老客户</strong><p className="mb-0 mt-1 text-xs text-slate-600">单独建立号码档案，不重复增加历史粉数；之后真实回复、进群等进度会更新累计数据。</p></div><button type="button" onClick={() => setHistoricalEntryOpen(true)} className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-50">+ 录入老客户</button></div>
          <EntryImportPanel
            channels={availableChannels}
            leads={importBatchLeads}
            sourceDate={sourceDate}
            channelId={channelId}
            newChannelName={newChannelName}
            newChannelType={newChannelType}
            addingChannel={addingChannel}
            importRows={importRows}
            devices={devices}
            attributionOwners={attributionOwners}
            defaultAttributionOwnerId={defaultAttributionOwnerId}
            allowMemberChannelCreation={allowMemberChannelCreation}
            busy={busy}
            recognizedPhoneCount={recognizedPhoneCount}
            onSourceDate={setSourceDate}
            onChannelId={setChannelId}
            onNewChannelName={setNewChannelName}
            onNewChannelType={setNewChannelType}
            onAddingChannel={setAddingChannel}
            onImportRows={setImportRows}
            onCreateChannel={() => { void createChannel(); }}
            onConfirmImport={() => { void importCustomers(); }}
            onClearImportRows={() => { setImportRows([emptyImportRow(`import-row-${nextImportRowId.current++}`)]); }}
            onAddImportRow={(attributionOwnerId) => { setImportRows((rows) => [...rows, { ...emptyImportRow(`import-row-${nextImportRowId.current++}`), attributionOwnerId: attributionOwnerId ?? defaultAttributionOwnerId }]); }}
            batchSummaries={importHistoryReady ? importBatchSummaries : []}
            selectedBatchId={importBatchId}
            onViewBatch={setImportBatchId}
            onCloseBatch={() => setImportBatchId("")}
            context={leadContext}
            notes={notes}
            empty={empty}
            actionDisabled={actionDisabled}
            onAction={requestLeadAction}
          />
        </>
      )}

      {tab === "reply" && (
        <>
          <div className="member-subtabs member-subtabs--reply" aria-label="客户回复管理筛选">
            <button type="button" data-active={replyList === "pending" || undefined} onClick={() => setReplyList("pending")}>待回复 {replyPending.length}</button>
            <button type="button" data-active={replyList === "readyToJoin" || undefined} onClick={() => setReplyList("readyToJoin")}>已回复，待入群 {groupPending.length}</button>
            <button type="button" data-active={replyList === "archived" || undefined} onClick={() => setReplyList("archived")}>归档 {allArchivedReplyLeads.length}</button>
          </div>
          {replyList === "archived" ? <div className="member-archive-filters" aria-label="归档类型筛选"><button type="button" data-active={replyArchiveFilter === "all" || undefined} onClick={() => setReplyArchiveFilter("all")}>全部 {allArchivedReplyLeads.length}</button><button type="button" data-active={replyArchiveFilter === "UNANSWERED" || undefined} onClick={() => setReplyArchiveFilter("UNANSWERED")}>未回复归档 {allArchivedReplyLeads.filter((lead) => receptionReplyArchiveType(lead) === "UNANSWERED").length}</button><button type="button" data-active={replyArchiveFilter === "NOT_JOINED" || undefined} onClick={() => setReplyArchiveFilter("NOT_JOINED")}>未进群归档 {allArchivedReplyLeads.filter((lead) => receptionReplyArchiveType(lead) === "NOT_JOINED").length}</button></div> : null}
          {replyList === "archived" ? <EntryReceptionArchiveTable rows={pagedArchivedReply} context={leadContext} empty={empty} /> : replyList === "pending" ? <EntryReplyPanel
            leads={pagedReply}
            devices={devices}
            deviceDrafts={deviceDrafts}
            onDeviceDraft={(lead, value) => setDeviceDrafts((drafts) => ({ ...drafts, [lead.id]: value }))}
            onDeviceSave={(lead, value) => { void saveDeviceOnBlur(lead, value); }}
            onProfileFieldSave={saveReplyProfileField}
            onViewProfile={(lead) => setProfileViewerId(lead.id)}
            onDelete={requestDeleteLead}
            onVoidErroneousEntry={requestVoidErroneousEntry}
            context={leadContext}
            notes={notes}
            empty={empty}
            actionDisabled={actionDisabled}
            onAction={requestLeadAction}
            selectedIds={selectedReplyIds}
            onToggleSelected={toggleReplySelected}
            onToggleSelectAll={toggleReplySelectAll}
            onBulkConfirmReply={requestBulkConfirmReply}
          /> : <section className="member-panel">
            <div className="member-panel-title"><div><p>已联系客户</p><h3>确认入群</h3></div><span>确认后自动交给配合的炒群员；这里不需要填写每日记录。</span></div>
            <EntryGroupTable
              rows={pagedGroupPending}
              mode="pending"
              actionDisabled={actionDisabled}
              onAction={(lead, action) => {
                if (action === "joinGroup" || action === "undoReply") requestLeadAction(lead, action);
              }}
              context={leadContext}
              notes={notes}
              empty={empty}
              today={today}
              onViewProgress={(lead) => setDownstreamFocusId(lead.id)}
              onViewProfile={(lead) => setProfileViewerId(lead.id)}
              onVoidErroneousEntry={requestVoidErroneousEntry}
              onReceptionStatus={(lead, receptionChatStatus) => { void updateLead(lead, "updateReceptionChatStatus", { receptionChatStatus }); }}
              onArchive={requestArchiveRepliedCustomer}
            />
          </section>}
        </>
      )}

      {tab === "invalid" && role === "LEAD" && <InvalidFanReportPanel role="LEAD" channels={availableChannels} sourceDate={sourceDate} channelId={channelId} onSourceDate={setSourceDate} onChannelId={setChannelId} onRefresh={() => router.refresh()} />}

      {tab === "invalid" && role === "RECEPTION" && <InvalidFanReportPanel role="RECEPTION" channels={availableChannels} sourceDate={sourceDate} channelId={channelId} onSourceDate={setSourceDate} onChannelId={setChannelId} onRefresh={() => router.refresh()} />}

      {tab === "group" && (
        <section className="member-panel">
          <div className="member-panel-title">
            <div>
              <p>第 3 步</p>
              <h3>入群交接</h3>
            </div>
            <span>确认入群后自动交给绑定炒群人员；后续进度仅供查看</span>
          </div>
          <div className="member-subtabs">
            <button
              type="button"
              data-active={groupList === "pending" || undefined}
              onClick={() => setGroupList("pending")}
            >
              待入群 {groupPending.length}
            </button>
            <button
              type="button"
              data-active={groupList === "joined" || undefined}
              onClick={() => setGroupList("joined")}
            >
              群内跟进 {groupJoined.length}
            </button>
            <button
              type="button"
              data-active={groupList === "left" || undefined}
              onClick={() => setGroupList("left")}
            >
              已退群 {groupLeft.length}
            </button>
          </div>
          <EntryGroupTable
            rows={
              groupList === "pending"
                ? pagedGroupPending
                : groupList === "joined"
                  ? groupJoined
                  : groupLeft
            }
            mode={groupList}
            actionDisabled={actionDisabled}
            onAction={(lead, action) => {
              if (action === "joinGroup" || action === "undoReply") requestLeadAction(lead, action);
            }}
            context={leadContext}
            notes={notes}
            empty={empty}
            today={today}
            onViewProgress={(lead) => setDownstreamFocusId(lead.id)}
            onViewProfile={(lead) => setProfileViewerId(lead.id)}
            onVoidErroneousEntry={requestVoidErroneousEntry}
            onReceptionStatus={(lead, receptionChatStatus) => { void updateLead(lead, "updateReceptionChatStatus", { receptionChatStatus }); }}
            onArchive={requestArchiveRepliedCustomer}
          />
          <ReceptionDownstreamProgress
            compact
            leads={visible}
            today={today}
            focusLeadId={downstreamFocusId}
            onFocusHandled={() => setDownstreamFocusId(null)}
          />
        </section>
      )}

      {(tab === "progress" || tab === "reply" || (tab === "group" && groupList === "pending")) && activeRows.length > pageSize ? <nav className="reception-pager" aria-label="号码分页">
        <span className="reception-pager-summary"><strong>共 {activeRows.length} 个客户</strong><small>第 {safePage} / {pageCount} 页 · 每页 25 个</small></span>
        <div className="reception-pager-controls"><label><span>跳至</span><input aria-label="跳至页码" type="number" min={1} max={pageCount} defaultValue={safePage} onBlur={(event) => { const page = Number(event.target.value); if (Number.isInteger(page)) setListPage(Math.min(pageCount, Math.max(1, page))); else event.target.value = String(safePage); }} /><span>页</span></label><span className="reception-pager-buttons"><button type="button" disabled={safePage <= 1} onClick={() => setListPage((page) => Math.max(1, page - 1))}><CaretLeft size={15} weight="bold" />上一页</button><button type="button" disabled={safePage >= pageCount} onClick={() => setListPage((page) => Math.min(pageCount, page + 1))}>下一页<CaretRight size={15} weight="bold" /></button></span></div>
      </nav> : null}

      {tab === "progress" && (
        <section className="member-panel">
          {progressList === "historical" ? <div className="member-panel-title"><div><p>历史补录</p><h3>老客户档案</h3></div><span>补录号码不重复增加粉数；启用后新发生的回复、进群、推专家、注册和开单正常累计。</span></div> : null}
          <ReceptionDownstreamProgress
            leads={pagedProgress}
            today={today}
            onVoidErroneousEntry={progressList === "historical" ? undefined : requestVoidErroneousEntry}
            actionDisabled={actionDisabled}
          />
        </section>
      )}

      {tab === "expert" && (
        <section className="member-panel">
          <div className="member-panel-title">
            <div>
              <p>第 4 步</p>
              <h3>专家与注册</h3>
            </div>
            <span>只有仍在群内的客户能继续</span>
          </div>
          <div className="member-subtabs">
            <button
              type="button"
              data-active={expertList === "intro" || undefined}
              onClick={() => setExpertList("intro")}
            >
              待推专家 {introPending.length}
            </button>
            <button
              type="button"
              data-active={expertList === "register" || undefined}
              onClick={() => setExpertList("register")}
            >
              待注册 {registerPending.length}
            </button>
            <button
              type="button"
              data-active={expertList === "done" || undefined}
              onClick={() => setExpertList("done")}
            >
              已注册 {registered.length}
            </button>
          </div>
          <EntryExpertTable
            rows={
              expertList === "intro"
                ? introPending
                : expertList === "register"
                  ? registerPending
                  : registered
            }
            mode={expertList}
            notes={notes}
            actionDisabled={actionDisabled}
            onAction={updateLead}
            onCorrect={correctLead}
            context={leadContext}
            empty={empty}
          />
        </section>
      )}

      {tab === "order" && (
        <section className="member-panel">
          <div className="member-panel-title">
            <div>
              <p>第 5 步</p>
              <h3>转化开单</h3>
            </div>
            <span>首充自动进入财务统计；一个手机号只能开单一次</span>
          </div>
          <div className="member-subtabs">
            <button
              type="button"
              data-active={orderList === "pending" || undefined}
              onClick={() => setOrderList("pending")}
            >
              待开单 {orderPending.length}
            </button>
            <button
              type="button"
              data-active={orderList === "done" || undefined}
              onClick={() => setOrderList("done")}
            >
              已开单记录 {orderLeads.length}
            </button>
          </div>
          {orderList === "pending" ? (
            <div className="member-table-wrap">
              <table className="member-table">
                <thead>
                  <tr>
                    <th>手机号</th>
                    <th>客户姓名</th>
                    <th>来源</th>
                    <th>注册日期</th>
                    <th>开单日期</th>
                    <th>首充金额（美元）</th>
                    <th>备注</th>
                    <th>当前状态</th>
                    <th>下一步</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {orderPending.map((lead) => {
                    const draft = orderDrafts[lead.id] ?? {
                      date: today,
                      amount: "",
                    };
                    return (
                      <tr key={lead.id}>
                        <td className="member-phone">{lead.phone}</td>
                        <td>{lead.customerName ?? "—"}</td>
                        <td>{leadContext(lead)}</td>
                        <td>{lead.registeredOn}</td>
                        <td>
                          <input
                            type="date"
                            value={draft.date}
                            onChange={(event) =>
                              setOrderDrafts((rows) => ({
                                ...rows,
                                [lead.id]: {
                                  ...draft,
                                  date: event.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={draft.amount}
                            onChange={(event) =>
                              setOrderDrafts((rows) => ({
                                ...rows,
                                [lead.id]: {
                                  ...draft,
                                  amount: event.target.value,
                                },
                              }))
                            }
                            placeholder="如 500"
                          />
                        </td>
                        <td>{notes(lead)}</td>
                        <td><EntryWorkflowStatus lead={lead} /></td>
                        <td><EntryWorkflowNextStep lead={lead} /></td>
                        <td>
                          <button
                            type="button"
                            className="member-primary small"
                            onClick={() => openOrder(lead)}
                            disabled={actionDisabled(lead)}
                          >
                            确认开单
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!orderPending.length && (
                    <tr>
                      <td colSpan={10}>{empty("没有待开单客户")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="member-table-wrap">
              <table className="member-table">
                <thead>
                  <tr>
                    <th>手机号</th>
                    <th>客户姓名</th>
                    <th>来源 / 设备</th>
                    <th>开单日期</th>
                    <th>首充金额</th>
                    <th>续充次数</th>
                    <th>备注</th>
                    <th>当前状态</th>
                    <th>下一步</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {orderLeads.map((lead) => (
                    <tr key={lead.id}>
                      <td className="member-phone">{lead.phone}</td>
                      <td>{lead.customerName ?? "—"}</td>
                      <td>{leadContext(lead)}</td>
                      <td>{lead.customerOrder?.openedOn}</td>
                      <td>
                        {money(lead.customerOrder?.initialDepositCents ?? 0)}
                      </td>
                      <td>
                        {lead.customerOrder?.events.filter(
                          (event) =>
                            event.kind === "RECHARGE" &&
                            event.continuationNumber !== null &&
                            !event.voidedAt,
                        ).length ?? 0}
                      </td>
                      <td>{notes(lead)}</td>
                      <td><EntryWorkflowStatus lead={lead} /></td>
                      <td><EntryWorkflowNextStep lead={lead} /></td>
                      <td>
                        <button
                          type="button"
                          className="member-text-action danger"
                          disabled={actionDisabled(lead)}
                          onClick={() => {
                            void correctLead(lead, "voidOrder", "作废开单");
                          }}
                        >
                          作废开单
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!orderLeads.length && (
                    <tr>
                      <td colSpan={10}>{empty("暂无已开单记录")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === "finance" && (
        <section className="member-panel">
          <div className="member-panel-title">
            <div>
              <p>第 6 步</p>
              <h3>财务流水</h3>
            </div>
            <span>
              首充已经在开单时记录；每行只填“续充入金”或“出金”其中一列。上方“今日”只统计发生日期为今天的记录。
            </span>
          </div>
          <EntryFinanceSummary leads={orderLeads} today={today} />
          <div className="member-subtabs">
            <button
              type="button"
              data-active={financeList === "new" || undefined}
              onClick={() => setFinanceList("new")}
            >
              新增流水
            </button>
            <button
              type="button"
              data-active={financeList === "history" || undefined}
              onClick={() => setFinanceList("history")}
            >
              流水记录 {buildEntryFinanceHistory(orderHistoryLeads).length}
            </button>
          </div>
          {financeList === "new" ? (
            <div className="member-table-wrap">
              <table className="member-table">
                <thead>
                  <tr>
                    <th>手机号</th>
                    <th>客户姓名</th>
                    <th>来源</th>
                    <th>发生日期</th>
                    <th>续充入金（美元）</th>
                    <th>出金（美元）</th>
                    <th>续充次数</th>
                    <th>当前状态</th>
                    <th>下一步</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {orderLeads.map((lead) => {
                    const draft = financeDrafts[lead.id] ?? {
                      date: today,
                      kind: "RECHARGE" as const,
                      amount: "",
                      note: "",
                    };
                    const count = lead.customerOrder!.events.filter(
                      (event) =>
                        event.kind === "RECHARGE" &&
                        event.continuationNumber !== null &&
                        !event.voidedAt,
                    ).length;
                    const saving = financeSavingId === lead.id;
                    return (
                      <tr key={lead.id}>
                        <td className="member-phone">{lead.phone}</td>
                        <td>{lead.customerName ?? "—"}</td>
                        <td>{leadContext(lead)}</td>
                        <td>
                          <input
                            type="date"
                            value={draft.date}
                            onChange={(event) =>
                              setFinanceDrafts((rows) => ({
                                ...rows,
                                [lead.id]: {
                                  ...draft,
                                  date: event.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${lead.phone} 续充入金`}
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={draft.kind === "RECHARGE" ? draft.amount : ""}
                            onChange={(event) =>
                              setFinanceDrafts((rows) => ({
                                ...rows,
                                [lead.id]: {
                                  ...draft,
                                  kind: "RECHARGE",
                                  amount: event.target.value,
                                },
                              }))
                            }
                            placeholder="如 200"
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${lead.phone} 出金`}
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={
                              draft.kind === "WITHDRAWAL" ? draft.amount : ""
                            }
                            onChange={(event) =>
                              setFinanceDrafts((rows) => ({
                                ...rows,
                                [lead.id]: {
                                  ...draft,
                                  kind: "WITHDRAWAL",
                                  amount: event.target.value,
                                },
                              }))
                            }
                            placeholder="如 1,000"
                          />
                        </td>
                        <td>
                          {draft.kind === "RECHARGE"
                            ? `第 ${count + 1} 次`
                            : "—"}
                        </td>
                        <td><EntryWorkflowStatus lead={lead} /></td>
                        <td><EntryWorkflowNextStep lead={lead} /></td>
                        <td>
                          <button
                            type="button"
                            className="member-primary small"
                            onClick={() => saveFinance(lead)}
                            disabled={saving}
                          >
                            {saving ? "保存中…" : "保存"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!orderLeads.length && (
                    <tr>
                      <td colSpan={11}>
                        {empty("开单后，客户会自动出现在这里")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <EntryFinanceHistory
              leads={orderHistoryLeads}
              empty={empty}
              context={leadContext}
              onVoid={requestVoidFinance}
            />
          )}
        </section>
      )}

      {tab === "overview" && <EntryOverview overview={overview} leads={visible} invalidReports={invalidReports} today={today} />}
      {tab === "exceptions" && (
        <section className="member-panel">
          <div className="member-panel-title">
            <div>
              <p>记录查询</p>
              <h3>扣粉 / 撞粉日志</h3>
            </div>
            <span>撞粉会显示当前归属组员</span>
          </div>
          <div className="member-table-wrap">
            <table className="member-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>手机号</th>
                  <th>客户姓名</th>
                  <th>类型</th>
                  <th>来源</th>
                  <th>当前归属</th>
                  <th>操作人</th>
                  <th>原因</th>
                </tr>
              </thead>
              <tbody>
                {visibleExceptions.map((item) => (
                  <tr key={item.id}>
                    <td>{item.occurredOn}</td>
                    <td className="member-phone">{item.phone}</td>
                    <td>{item.lead?.customerName ?? "—"}</td>
                    <td>{exceptionLabel[item.kind]}</td>
                    <td>
                      {item.batch
                        ? `${item.batch.sourceDate} · ${item.batch.channel.name}`
                        : "—"}
                    </td>
                    <td>{item.owner?.name ?? "—"}</td>
                    <td>{item.actor.name}</td>
                    <td>{item.reason ?? "—"}</td>
                  </tr>
                ))}
                {!visibleExceptions.length && (
                  <tr>
                    <td colSpan={8}>
                      {empty(
                        search.trim()
                          ? "没有匹配该手机号的异常记录"
                          : "暂无扣粉或撞粉记录",
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <HistoricalCustomerDialog open={historicalEntryOpen} today={today} entryRole={role === "LEAD" ? "LEAD" : "RECEPTION"} members={historicalMembers} channels={historicalChannels} currentUserId={currentUserId} onClose={() => setHistoricalEntryOpen(false)} onCreated={() => router.refresh()} />
      <WorkflowConfirmationDialog
        confirmation={confirmation}
        busy={Boolean(busy)}
        error={error}
        onClose={() => { if (!busy) { setConfirmation(null); setError(""); } }}
      />
      <CustomerProfileDrawer lead={leads.find((lead) => lead.id === profileViewerId) ?? null} onClose={() => setProfileViewerId(null)} />
      {profileEditorId ? (() => {
        const lead = leads.find((row) => row.id === profileEditorId);
        if (!lead) return null;
        return <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="编辑客户资料">
          <form onSubmit={(event) => { event.preventDefault(); void saveProfileEditor(lead); }} className="mx-auto my-8 max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-slate-950">编辑客户资料</h2><p className="mt-1 text-sm text-slate-600">可补充导入时漏填的资料；设备只能选自己的设备库，或手动新增自己的设备号。</p></div><button type="button" onClick={() => { if (!busy) { setProfileEditorId(null); setError(""); } }} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">取消</button></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">客户编号<input required value={profileDraft.phone} onChange={(event) => setProfileDraft((draft) => ({ ...draft, phone: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-slate-700">客户姓名<input value={profileDraft.customerName} onChange={(event) => setProfileDraft((draft) => ({ ...draft, customerName: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-slate-700">邮箱<input type="text" inputMode="email" value={profileDraft.customerEmail} onChange={(event) => setProfileDraft((draft) => ({ ...draft, customerEmail: event.target.value }))} placeholder="name@example.com" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-slate-700">客户金额（美元）<input type="number" min="0" step="0.01" value={profileDraft.lossAmount} onChange={(event) => setProfileDraft((draft) => ({ ...draft, lossAmount: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <label className="text-sm font-medium text-slate-700">客户平台<input value={profileDraft.customerPlatform} onChange={(event) => setProfileDraft((draft) => ({ ...draft, customerPlatform: event.target.value }))} placeholder="如 MT5、Web" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
              <fieldset className="sm:col-span-2"><legend className="text-sm font-medium text-slate-700">前台接粉设备号</legend><div className="mt-1 flex flex-wrap gap-2"><button type="button" onClick={() => setProfileDeviceMode("SELECT")} className={profileDeviceMode === "SELECT" ? "rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white" : "rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"}>从设备库选择</button><button type="button" onClick={() => setProfileDeviceMode("MANUAL")} className={profileDeviceMode === "MANUAL" ? "rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white" : "rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"}>手动填写设备号</button></div>{profileDeviceMode === "SELECT" ? <select value={profileDraft.deviceId} onChange={(event) => setProfileDraft((draft) => ({ ...draft, deviceId: event.target.value }))} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">不修改当前设备</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.code}</option>)}</select> : <input value={profileDraft.deviceCode} onChange={(event) => setProfileDraft((draft) => ({ ...draft, deviceCode: event.target.value }))} placeholder="填写新的前台接粉设备号" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" />}</fieldset>
              <label className="sm:col-span-2 text-sm font-medium text-slate-700">备注<textarea rows={3} value={profileDraft.notes} onChange={(event) => setProfileDraft((draft) => ({ ...draft, notes: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" /></label>
            </div>
            {error ? <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-5"><button type="button" onClick={() => { if (!busy) { setProfileEditorId(null); setError(""); } }} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600">取消</button><button disabled={Boolean(busy)} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "保存中…" : "保存资料"}</button></div>
          </form>
        </div>;
      })() : null}
    </div>
  );
}
