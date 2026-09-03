"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { requestJson, type BackendUser } from "@/lib/backend";
import { localToday } from "@/lib/frontline-workbench";
import styles from "./DepartmentCustomerProgress.module.css";

export type DepartmentCustomerGroup = { id: string; name: string };
type Owner = { id: string; name: string } | null;
type Option = { id: string; name: string };
type Activity = {
  id?: string;
  kind: string;
  occurredOn: string;
  note: string | null;
  actor?: { name: string };
};
type FinanceEvent = {
  id: string;
  kind: "RECHARGE" | "WITHDRAWAL";
  amountCents: number;
  occurredOn: string;
  continuationNumber: number | null;
  depositMethod: "CRYPTO" | "BANK" | null;
  enteredBy?: Option;
};
type Customer = {
  id: string;
  phone: string;
  customerName: string | null;
  customerPlatform: string | null;
  lossAmountCents: number | null;
  groupStatus: string;
  joinedOn: string | null;
  leftOn: string | null;
  groupQueueNumber: number | null;
  expertQueueNumber: number | null;
  registrationQueueNumber: number | null;
  leaveQueueNumber: number | null;
  leftNote: string | null;
  leftWithOrder: boolean;
  expertIntroducedOn: string | null;
  expertContactNote: string | null;
  expertWorkflowStage: string | null;
  registeredOn: string | null;
  expertNotes: string | null;
  nextPlan: string | null;
  owner: Owner;
  attributionOwner: Owner;
  groupOperatorOwner: Owner;
  expertOwner: Owner;
  device: { id: string; code: string } | null;
  batch: { id: string; sourceDate: string; channel: Option };
  order: {
    id: string;
    openedOn: string;
    orderQueueNumber: number | null;
    initialDepositCents: number;
    initialDepositMethod: "CRYPTO" | "BANK" | null;
    enteredBy: Option;
    rechargeCents: number;
    withdrawalCents: number;
    nextContinuationNumber: number;
    financeEvents: FinanceEvent[];
  } | null;
  activities: Activity[];
};
type Payload = {
  actorId: string;
  today: string;
  timezone: string;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<"reception" | "group" | "pending-expert" | "expert", number>;
  expertStage: ExpertStageFilter;
  expertCounts: Record<ExpertStage, number>;
  customers: Customer[];
  channels: string[];
  channelOptions: Option[];
  memberOptions: Option[];
  receptionOptions: Option[];
  operatorOptions: Option[];
  expertOptions: Option[];
};
type ReportingPayload = { groups: DepartmentCustomerGroup[] };
type ProgressFilter =
  | "全部进度"
  | "群内维护"
  | "已推专家"
  | "已注册"
  | "已开单"
  | "已退群";
type ViewMode = "group" | "expert";
type ExpertStage =
  | "QUEUED"
  | "MATERIALS"
  | "TRACKING"
  | "PENDING_REGISTRATION"
  | "PENDING_ORDER"
  | "DECLINED_DEPOSIT"
  | "ORDERED"
  | "STALLED";
type ExpertStageFilter = "all" | "FOLLOWING" | ExpertStage;
type CreateMode = "group" | "expert-recovery";
type FinanceKind = "INITIAL" | "RECHARGE" | "WITHDRAWAL";
type ColumnKey =
  | "dates"
  | "customer"
  | "attribution"
  | "maintenance"
  | "days"
  | "groupProgress"
  | "leave"
  | "expertOwner"
  | "expertProgress"
  | "registration"
  | "initial"
  | "recharge"
  | "withdrawal"
  | "net"
  | "updated";

const mandatoryColumns = new Set<ColumnKey>([
  "dates",
  "customer",
  "attribution",
  "expertOwner",
  "updated",
]);
const columnLabels: Record<ColumnKey, string> = {
  dates: "客户日期",
  customer: "客户信息",
  attribution: "客户归属",
  maintenance: "群维护",
  days: "群内天数",
  groupProgress: "炒群情况",
  leave: "退群信息",
  expertOwner: "专家负责人",
  expertProgress: "专家情况",
  registration: "注册信息",
  initial: "首充",
  recharge: "续充",
  withdrawal: "出金",
  net: "净业绩",
  updated: "最后修改",
};
const columnsByView: Record<ViewMode, ColumnKey[]> = {
  group: [
    "dates",
    "customer",
    "attribution",
    "maintenance",
    "days",
    "groupProgress",
    "leave",
    "expertOwner",
    "updated",
  ],
  expert: [
    "dates",
    "customer",
    "attribution",
    "leave",
    "expertOwner",
    "expertProgress",
    "registration",
    "initial",
    "recharge",
    "withdrawal",
    "net",
    "updated",
  ],
};
const compactHiddenByView: Record<ViewMode, ColumnKey[]> = {
  group: ["leave"],
  expert: ["leave", "recharge", "withdrawal"],
};

const money = (cents = 0) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
const depositMethodLabel = (method: "CRYPTO" | "BANK" | null) =>
  method === "BANK" ? "银行卡" : method === "CRYPTO" ? "加密货币" : "未记录方式";
const queueNumber = (
  prefix: "G" | "E" | "R" | "O" | "L",
  date: string | null,
  value: number | null,
) =>
  date && value
    ? `${prefix}-${Number(date.slice(5, 7))}-${Number(date.slice(8, 10))}-${String(value).padStart(3, "0")}`
    : "—";
const expertLabels: Record<string, string> = {
  QUEUED: "待专家接待",
  MATERIALS: "已经交资料，等待进一步沟通",
  TRACKING: "专家跟进中",
  PENDING_REGISTRATION: "待注册",
  PENDING_ORDER: "待开单",
  DECLINED_DEPOSIT: "暂不首充",
  ORDERED: "已开单，等待客户后续维护",
  STALLED: "停止维护",
};
const groupProgressFilters: ProgressFilter[] = [
  "全部进度",
  "群内维护",
  "已退群",
];
const expertProgressFilters: ProgressFilter[] = [
  "全部进度",
  "已推专家",
  "已注册",
  "已开单",
  "已退群",
];
const expertStageFilters: Array<{
  value: ExpertStageFilter;
  label: string;
}> = [
  { value: "all", label: "全部" },
  { value: "QUEUED", label: "待专家接待" },
  { value: "FOLLOWING", label: "跟进中" },
  { value: "PENDING_REGISTRATION", label: "待注册" },
  { value: "PENDING_ORDER", label: "待开单" },
  { value: "ORDERED", label: "已开单" },
  { value: "DECLINED_DEPOSIT", label: "暂不首充" },
  { value: "STALLED", label: "停止维护" },
];

function latestGroupText(customer: Customer) {
  return (
    customer.activities
      .find((item) => item.kind === "GROUP_PROGRESS_UPDATED")
      ?.note?.trim() ||
    customer.leftNote ||
    (customer.expertIntroducedOn ? "已推专家" : "暂无炒群记录")
  );
}
function latestExpertText(customer: Customer) {
  return (
    customer.expertNotes?.trim() ||
    customer.nextPlan ||
    customer.expertContactNote ||
    (customer.expertIntroducedOn
      ? (expertLabels[customer.expertWorkflowStage ?? ""] ?? "专家跟进中")
      : "—")
  );
}
function progressOf(customer: Customer): Exclude<ProgressFilter, "全部进度"> {
  if (customer.groupStatus === "LEFT") return "已退群";
  if (customer.order) return "已开单";
  if (customer.registeredOn) return "已注册";
  if (customer.expertIntroducedOn) return "已推专家";
  return "群内维护";
}
function daysInGroup(
  joinedOn: string | null,
  leftOn: string | null,
  today: string,
) {
  if (!joinedOn) return "—";
  const start = Date.parse(`${joinedOn}T00:00:00Z`);
  const end = Date.parse(`${leftOn || today}T00:00:00Z`);
  return `第${Math.max(1, Math.floor((end - start) / 86_400_000) + 1)}天`;
}

function earliestDate(...dates: Array<string | null | undefined>) {
  return dates.filter((value): value is string => Boolean(value)).sort()[0];
}

function recentMonthOptions(today: string) {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return Array.from({ length: 24 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - index, 1));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return {
      value,
      label: `${date.getUTCFullYear()}年${date.getUTCMonth() + 1}月`,
    };
  });
}

function EditableCell({
  label,
  value,
  editable,
  saving,
  onSave,
}: {
  label: string;
  value: string;
  editable: boolean;
  saving: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);
  async function finish() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === value.trim()) {
      setDraft(value);
      return;
    }
    await onSave(next);
  }
  if (editing)
    return (
      <textarea
        aria-label={label}
        className={styles.cellEditor}
        value={draft}
        maxLength={300}
        rows={2}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void finish()}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void finish();
          }
        }}
      />
    );
  return (
    <button
      type="button"
      className={styles.editableCell}
      data-editable={editable}
      disabled={!editable || saving}
      onDoubleClick={() => setEditing(true)}
      title={editable ? `双击修改${label}` : `${label}只读`}
    >
      <span>{value || "—"}</span>
      {saving ? <small>保存中…</small> : null}
    </button>
  );
}

export function DepartmentCustomerProgress({
  groups,
  member,
}: {
  groups?: DepartmentCustomerGroup[];
  member?: BackendUser;
}) {
  const [availableGroups, setAvailableGroups] = useState(groups ?? []);
  const [groupId, setGroupId] = useState(groups?.[0]?.id ?? "");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("group");
  const [expertStage, setExpertStage] = useState<ExpertStageFilter>("all");
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<ProgressFilter>("全部进度");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("all");
  const [memberFilter, setMemberFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [compactView, setCompactView] = useState(true);
  const [hiddenColumns, setHiddenColumns] = useState<ColumnKey[]>(
    compactHiddenByView.group,
  );
  const [savingCell, setSavingCell] = useState("");
  const [expertDates, setExpertDates] = useState<Record<string, string>>({});
  const [savedMessage, setSavedMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("group");
  const [creating, setCreating] = useState(false);
  const [phoneLookup, setPhoneLookup] = useState<
    | { status: "idle" | "loading" | "missing" }
    | { status: "found"; customer: Customer }
  >({ status: "idle" });
  const [draft, setDraft] = useState({
    phone: "",
    customerName: "",
    customerPlatform: "",
    lossAmount: "",
    channelId: "",
    attributionOwnerId: "",
    groupOperatorOwnerId: "",
    deviceCode: "",
    sourceDate: localToday(),
    joinedOn: localToday(),
    expertOwnerId: "",
    expertIntroducedOn: "",
  });
  const [finance, setFinance] = useState<{
    kind: FinanceKind;
    customer: Customer;
  } | null>(null);
  const [ledgerCustomer, setLedgerCustomer] = useState<Customer | null>(null);
  const [financeDraft, setFinanceDraft] = useState({
    occurredOn: localToday(),
    amount: "",
    depositMethod: "CRYPTO" as "CRYPTO" | "BANK",
  });
  const [savingFinance, setSavingFinance] = useState(false);
  const [correction, setCorrection] = useState<Customer | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState({
    attributionOwnerId: "",
    channelId: "",
    sourceDate: localToday(),
    reason: "",
  });
  const [savingCorrection, setSavingCorrection] = useState(false);
  const phoneInput = useRef<HTMLInputElement>(null);
  const loadedCustomerQuery = useRef("");
  // 客户新增也是业务写入：只有绑定小组的一线账号有入口，组织管理员保持只读。
  const canCreate = Boolean(
    member &&
      groupId &&
      payload?.receptionOptions.length &&
      payload.operatorOptions.length,
  );
  const canEditExpert = Boolean(
    member &&
      (member.role === "LEAD" ||
        member.role === "EXPERT" ||
        member.roles?.includes("LEAD") ||
        member.roles?.includes("EXPERT")),
  );
  const canEditReception = Boolean(
    member &&
      (member.role === "RECEPTION" || member.roles?.includes("RECEPTION")),
  );
  const canEditGroup = Boolean(
    member &&
      (member.role === "GROUP_OPERATOR" ||
        member.roles?.includes("GROUP_OPERATOR")),
  );
  const isLead = Boolean(
    member &&
      (member.role === "LEAD" || member.roles?.includes("LEAD")),
  );
  const businessToday = payload?.today ?? localToday();
  const expertCreateOptions = payload?.expertOptions ?? [];
  const canRegisterExpertCustomer = Boolean(
    canCreate && (isLead || canEditGroup) && expertCreateOptions.length > 0,
  );
  const canCreateInView =
    canCreate &&
    viewMode === "group" &&
    (isLead || canEditReception);
  const exactPhoneQuery = useMemo(() => {
    const digits = query.replace(/\D/g, "");
    return digits.length >= 6 ? digits.slice(-6) : "";
  }, [query]);

  useEffect(() => {
    if (groups) {
      setAvailableGroups(groups);
      setGroupId((current) =>
        groups.some((group) => group.id === current)
          ? current
          : (groups[0]?.id ?? ""),
      );
      return;
    }
    let cancelled = false;
    void requestJson<ReportingPayload>("/api/org/reporting?range=month")
      .then((result) => {
        if (!cancelled) {
          setAvailableGroups(result.groups);
          setGroupId((current) => current || result.groups[0]?.id || "");
        }
      })
      .catch((caught) => {
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : "小组读取失败");
      });
    return () => {
      cancelled = true;
    };
  }, [groups]);

  useEffect(() => {
    if (!groupId) {
      setPayload(null);
      loadedCustomerQuery.current = "";
      setLoading(false);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      groupId,
      stage: viewMode === "group" ? "pending-expert" : "expert",
      page: String(page),
      progress,
      day,
    });
    if (viewMode === "expert") params.set("expertStage", expertStage);
    if (month) params.set("month", month);
    if (query.trim()) params.set("q", exactPhoneQuery || query.trim());
    if (memberFilter) params.set("memberId", memberFilter);
    if (channelFilter) params.set("channel", channelFilter);
    const requestKey = params.toString();
    const silentlyRefresh = loadedCustomerQuery.current === requestKey;
    if (!silentlyRefresh) setLoading(true);
    setError("");
    void requestJson<Payload>(`/api/lead/customer-reporting?${params}`)
      .then((result) => {
        if (!cancelled) {
          setPayload(result);
          loadedCustomerQuery.current = requestKey;
        }
      })
      .catch((caught) => {
        if (!cancelled)
          setError(
            caught instanceof Error ? caught.message : "客户进度读取失败",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channelFilter, day, exactPhoneQuery, expertStage, groupId, memberFilter, month, page, progress, query, reloadKey, viewMode]);
  useEffect(() => {
    if (
      viewMode !== "group" ||
      !groupId ||
      !exactPhoneQuery ||
      !canRegisterExpertCustomer
    ) {
      setPhoneLookup({ status: "idle" });
      return;
    }
    let cancelled = false;
    setPhoneLookup({ status: "loading" });
    const params = new URLSearchParams({
      groupId,
      stage: "group",
      page: "1",
      q: exactPhoneQuery,
    });
    void requestJson<Payload>(`/api/lead/customer-reporting?${params}`)
      .then((result) => {
        if (cancelled) return;
        const customer = result.customers.find(
          (item) => item.phone === exactPhoneQuery,
        );
        setPhoneLookup(
          customer ? { status: "found", customer } : { status: "missing" },
        );
      })
      .catch(() => {
        if (!cancelled) setPhoneLookup({ status: "idle" });
      });
    return () => {
      cancelled = true;
    };
  }, [canRegisterExpertCustomer, exactPhoneQuery, groupId, reloadKey, viewMode]);
  useEffect(() => {
    if (adding) phoneInput.current?.focus();
  }, [adding]);
  useEffect(() => {
    const refresh = () => setReloadKey((value) => value + 1);
    window.addEventListener("ai-data-updated", refresh);
    window.addEventListener("customer-data-updated", refresh);
    return () => {
      window.removeEventListener("ai-data-updated", refresh);
      window.removeEventListener("customer-data-updated", refresh);
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible")
        setReloadKey((value) => value + 1);
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(
        `customer-progress-hidden-${viewMode}`,
      );
      setHiddenColumns(
        saved
          ? (JSON.parse(saved) as ColumnKey[])
          : compactHiddenByView[viewMode],
      );
    } catch {
      setHiddenColumns(compactHiddenByView[viewMode]);
    }
  }, [viewMode]);

  const customers = useMemo(
    () =>
      (payload?.customers ?? []).filter((customer) => {
        const haystack =
          `${customer.phone} ${queueNumber("G", customer.joinedOn, customer.groupQueueNumber)} ${queueNumber("E", customer.expertIntroducedOn, customer.expertQueueNumber)} ${queueNumber("R", customer.registeredOn, customer.registrationQueueNumber)} ${queueNumber("O", customer.order?.openedOn ?? null, customer.order?.orderQueueNumber ?? null)} ${queueNumber("L", customer.leftOn, customer.leaveQueueNumber)} ${customer.customerName ?? ""} ${customer.customerPlatform ?? ""} ${customer.attributionOwner?.name ?? customer.owner?.name ?? ""} ${customer.batch.channel.name} ${customer.groupOperatorOwner?.name ?? ""} ${customer.expertOwner?.name ?? ""} ${latestGroupText(customer)} ${latestExpertText(customer)}`.toLowerCase();
        const belongsToView =
          viewMode === "group"
            ? !customer.expertIntroducedOn
            : Boolean(customer.expertIntroducedOn);
        const attributionId =
          customer.attributionOwner?.id ?? customer.owner?.id ?? "";
        return (
          belongsToView &&
          (!query.trim() ||
            haystack.includes((exactPhoneQuery || query.trim()).toLowerCase())) &&
          (!memberFilter || attributionId === memberFilter) &&
          (!channelFilter || customer.batch.channel.name === channelFilter)
        );
      }),
    [channelFilter, exactPhoneQuery, memberFilter, payload?.customers, query, viewMode],
  );
  const progressFilters =
    viewMode === "group" ? groupProgressFilters : expertProgressFilters;
  const expertStageCount = (value: ExpertStageFilter) => {
    if (!payload) return 0;
    if (value === "all") return payload.counts.expert ?? 0;
    if (value === "FOLLOWING")
      return (payload.expertCounts.MATERIALS ?? 0) +
        (payload.expertCounts.TRACKING ?? 0);
    return payload.expertCounts[value] ?? 0;
  };
  const showColumn = (key: ColumnKey) =>
    !compactView || mandatoryColumns.has(key) || !hiddenColumns.includes(key);
  const tableColumns = columnsByView[viewMode].filter(showColumn).length;
  const pageCount = Math.max(
    1,
    Math.ceil((payload?.total ?? 0) / (payload?.pageSize ?? 50)),
  );
  const resultTotal = payload?.total ?? 0;
  const visibleFrom = resultTotal ? (page - 1) * (payload?.pageSize ?? 50) + 1 : 0;
  const visibleTo = Math.min(page * (payload?.pageSize ?? 50), resultTotal);
  function showSaved(message: string) {
    setSavedMessage(message);
    window.dispatchEvent(new Event("ai-data-updated"));
    window.setTimeout(() => setSavedMessage(""), 2400);
  }
  function switchView(next: ViewMode) {
    setViewMode(next);
    setProgress("全部进度");
    setExpertStage("all");
    setPage(1);
    setAdding(false);
    setPhoneLookup({ status: "idle" });
  }
  function toggleColumn(key: ColumnKey) {
    if (mandatoryColumns.has(key)) return;
    setCompactView(true);
    setHiddenColumns((current) => {
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key];
      try {
        window.localStorage.setItem(
          `customer-progress-hidden-${viewMode}`,
          JSON.stringify(next),
        );
      } catch {
        /* 仍保留本次页面设置 */
      }
      return next;
    });
  }
  function beginAdd(mode: CreateMode = "group", phone = "") {
    const today = businessToday;
    setProgress("全部进度");
    setPage(1);
    setAdding(true);
    setCreateMode(mode);
    setError("");
    setDraft({
      phone,
      customerName: "",
      customerPlatform: "",
      lossAmount: "",
      channelId: payload?.channelOptions[0]?.id ?? "",
      attributionOwnerId:
        mode === "expert-recovery"
          ? ""
          : (payload?.receptionOptions.find((item) => item.id === member?.id)?.id ??
            payload?.receptionOptions[0]?.id ??
            ""),
      groupOperatorOwnerId:
        mode === "expert-recovery"
          ? (payload?.operatorOptions.find((item) => item.id === payload.actorId)?.id ??
            "")
          : (payload?.operatorOptions.find((item) => item.id === member?.id)?.id ??
            payload?.operatorOptions[0]?.id ??
            ""),
      deviceCode: "",
      sourceDate: today,
      joinedOn: today,
      expertOwnerId:
        "",
      expertIntroducedOn: mode === "expert-recovery" ? today : "",
    });
  }
  async function createCustomer() {
    if (!adding || creating || !draft.phone.trim()) return;
    if (
      !draft.attributionOwnerId ||
      !draft.groupOperatorOwnerId ||
      !draft.deviceCode.trim() ||
      (createMode === "expert-recovery" &&
        (!draft.expertOwnerId || !draft.expertIntroducedOn))
    ) {
      setError("请选择接粉归属、炒群负责人，并填写设备账号");
      return;
    }
    const lossAmount = draft.lossAmount.trim()
      ? Number(draft.lossAmount)
      : null;
    if (
      lossAmount !== null &&
      (!Number.isFinite(lossAmount) || lossAmount < 0)
    ) {
      setError("被骗金额必须是大于或等于 0 的数字");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const { expertOwnerId, expertIntroducedOn, ...groupDraft } = draft;
      const result = await requestJson<{
        resumed?: boolean;
        counted?: { join?: boolean; expert?: boolean };
      }>("/api/lead/customer-reporting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...groupDraft,
          groupId,
          lossAmountCents:
            lossAmount === null ? null : Math.round(lossAmount * 100),
          ...(createMode === "expert-recovery"
            ? {
                expertOwnerId,
                expertIntroducedOn,
              }
            : {}),
        }),
      });
      setAdding(false);
      setPage(1);
      setProgress("全部进度");
      // 历史客户恢复后仍保留真实的接粉/进群日期。如果录入时页面正在查看
      // 其他月份，新行会不在当前筛选中；保存后回到全时间，让用户立即看到结果。
      setMonth("");
      setDay("all");
      if (createMode === "expert-recovery") {
        setViewMode("expert");
        setQuery(draft.phone);
      }
      showSaved(
        result.resumed
          ? `8月客户已续接${result.counted?.join ? "，本次进群已计数" : "，原进群不重复计数"}${result.counted?.expert ? "，本次推专家已计数" : ""}`
          : "客户已加入组内共享表",
      );
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "新增客户失败");
      phoneInput.current?.focus();
    } finally {
      setCreating(false);
    }
  }
  async function patchCell(
    customer: Customer,
    action: Record<string, unknown>,
    key: string,
    message: string,
  ) {
    setSavingCell(`${customer.id}:${key}`);
    setError("");
    try {
      await requestJson(`/api/lead/customer-reporting/${customer.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action),
      });
      showSaved(message);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "单元格保存失败");
    } finally {
      setSavingCell("");
    }
  }
  function beginAttributionCorrection(customer: Customer) {
    setCorrection(customer);
    setCorrectionDraft({
      attributionOwnerId:
        customer.attributionOwner?.id ?? customer.owner?.id ?? "",
      channelId: customer.batch.channel.id,
      sourceDate: customer.batch.sourceDate,
      reason: "",
    });
    setError("");
  }
  async function saveAttributionCorrection() {
    if (!correction || savingCorrection) return;
    setSavingCorrection(true);
    setError("");
    try {
      await requestJson(
        `/api/lead/customer-reporting/${correction.id}/attribution-correction`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(correctionDraft),
        },
      );
      setCorrection(null);
      showSaved(
        isLead
          ? "客户原始归属已纠正，并已记录原因"
          : "客户渠道已修改，相关统计已同步更新",
      );
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "归属纠错失败");
    } finally {
      setSavingCorrection(false);
    }
  }
  async function saveSituation(
    customer: Customer,
    kind: "group" | "expert",
    note: string,
  ) {
    const key = `${customer.id}:${kind}`;
    setSavingCell(key);
    setError("");
    try {
      await requestJson(`/api/leads/${customer.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          kind === "group"
            ? {
                action: "updateGroupProgress",
                progressNote: note,
                occurredOn: businessToday,
              }
            : {
                action: "updateExpertDetails",
                expertNotes: note,
                occurredOn: businessToday,
              },
        ),
      });
      showSaved(`${kind === "group" ? "炒群情况" : "专家情况"}已自动保存`);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "客户进度保存失败");
    } finally {
      setSavingCell("");
    }
  }
  function openFinance(kind: FinanceKind, customer: Customer) {
    setFinance({ kind, customer });
    setFinanceDraft({
      occurredOn: businessToday,
      amount: "",
      depositMethod: "CRYPTO",
    });
    setError("");
  }
  function openLedger(customer: Customer) {
    setLedgerCustomer(customer);
    setError("");
  }
  async function saveFinance() {
    if (!finance) return;
    const amount = Number(financeDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("金额必须大于 0");
      return;
    }
    setSavingFinance(true);
    setError("");
    try {
      if (finance.kind === "INITIAL") {
        await requestJson("/api/customer-orders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            batchId: finance.customer.batch.id,
            leadId: finance.customer.id,
            phone: finance.customer.phone,
            openedOn: financeDraft.occurredOn,
            initialDepositCents: Math.round(amount * 100),
            initialDepositMethod: financeDraft.depositMethod,
          }),
        });
      } else {
        const order = finance.customer.order;
        if (!order) throw new Error("请先登记首充");
        await requestJson("/api/customer-finance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customerOrderId: order.id,
            occurredOn: financeDraft.occurredOn,
            kind: finance.kind,
            amountCents: Math.round(amount * 100),
            ...(finance.kind === "RECHARGE"
              ? {
                  depositMethod: financeDraft.depositMethod,
                  continuationNumber: order.nextContinuationNumber,
                }
              : {}),
          }),
        });
      }
      showSaved(
        finance.kind === "INITIAL"
          ? "开单与首充已登记"
          : finance.kind === "RECHARGE"
            ? "本次续充已登记"
            : "本次出金已登记",
      );
      setFinance(null);
      setReloadKey((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "资金记录保存失败");
    } finally {
      setSavingFinance(false);
    }
  }

  return (
    <div className={styles.sheetWorkspace}>
      <section className={styles.toolbar}>
        <label className={styles.search}>
          <MagnifyingGlass size={14} />
          <input
            aria-label="搜索客户"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="搜索号码、G/E/R/O/L 编号、组员或进度"
          />
        </label>
        <label className={styles.filterField}>
          <span>归属组员</span>
          <select
            aria-label="归属组员筛选"
            value={memberFilter}
            onChange={(event) => {
              setMemberFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部组员</option>
            {payload?.memberOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span>来源渠道</span>
          <select
            aria-label="来源渠道筛选"
            value={channelFilter}
            onChange={(event) => {
              setChannelFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="">全部渠道</option>
            {payload?.channels.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span>月份</span>
          <select
            aria-label="客户月份筛选"
            value={month}
            onChange={(event) => {
              setMonth(event.target.value);
              setDay("all");
              setPage(1);
            }}
          >
            <option value="">全部月份</option>
            {recentMonthOptions(businessToday).map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          <span>日期</span>
          <select
            aria-label="客户日期筛选"
            value={day}
            disabled={!month}
            onChange={(event) => {
              setDay(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">{month ? "整月" : "全部日期"}</option>
            {month ? Array.from(
              {
                length: new Date(
                  Number(month.slice(0, 4)),
                  Number(month.slice(5, 7)),
                  0,
                ).getDate(),
              },
              (_, index) => String(index + 1).padStart(2, "0"),
            )
              .filter((value) => `${month}-${value}` <= businessToday)
              .map((value) => (
                <option key={value} value={value}>
                  {Number(value)}日
                </option>
              )) : null}
          </select>
        </label>
        <div className={styles.densitySwitch} aria-label="表格显示密度">
          <button
            type="button"
            data-active={compactView}
            onClick={() => setCompactView(true)}
          >
            精简视图
          </button>
          <button
            type="button"
            data-active={!compactView}
            onClick={() => setCompactView(false)}
          >
            完整视图
          </button>
        </div>
        <details className={styles.columnPicker}>
          <summary>
            显示字段{" "}
            <b>
              {tableColumns}/{columnsByView[viewMode].length}
            </b>
          </summary>
          <div>
            {columnsByView[viewMode].map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={showColumn(key)}
                  disabled={mandatoryColumns.has(key)}
                  onChange={() => toggleColumn(key)}
                />
                <span>{columnLabels[key]}</span>
                {mandatoryColumns.has(key) ? <small>固定</small> : null}
              </label>
            ))}
          </div>
        </details>
        <span className={styles.toolbarSpacer} />
        {availableGroups.length > 1 ? (
          <select
            aria-label="查看小组"
            value={groupId}
            onChange={(event) => {
              setGroupId(event.target.value);
              setProgress("全部进度");
              setExpertStage("all");
              setMemberFilter("");
              setChannelFilter("");
              setPage(1);
            }}
          >
            {availableGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        ) : null}
        {member || canCreate ? (
          <div className={styles.toolbarActions}>
            {canCreateInView ? (
              <button
                className={styles.addButton}
                disabled={!groupId || loading || adding}
                onClick={() => beginAdd("group")}
              >
                <Plus size={15} weight="bold" />
                新增进群客户
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}
      <section className={styles.sheetCard}>
        <header className={styles.sheetHeader}>
          <div className={styles.titleBlock}>
            <h2>客户协作进度</h2>
            <p>
              一位客户一行 · {member ? (isLead ? "组长查看本组全部客户" : "仅显示你接粉或参与炒群、专家的客户") : "管理范围内只读查看"} · 修改后自动保存
              {viewMode === "expert" && member && !canEditExpert ? (
                <em className={styles.permissionHint}>
                  只读 · 需专家权限才能编辑
                </em>
              ) : null}
            </p>
          </div>
          <div className={styles.viewControls}>
            <nav className={styles.viewTabs} aria-label="客户跟进入口">
              <button
                type="button"
                data-active={viewMode === "group"}
                aria-pressed={viewMode === "group"}
                onClick={() => switchView("group")}
              >
                炒群进度
                <small>{payload?.counts["pending-expert"] ?? 0}</small>
              </button>
              <button
                type="button"
                data-active={viewMode === "expert"}
                aria-pressed={viewMode === "expert"}
                onClick={() => switchView("expert")}
              >
                专家进度
                <small>{payload?.counts.expert ?? 0}</small>
              </button>
            </nav>
            <div className={styles.stageFilters} aria-label="进度状态筛选">
              <span>进度状态</span>
              <div>
                {viewMode === "expert"
                  ? expertStageFilters.map((item) => (
                      <button
                        type="button"
                        key={item.value}
                        data-active={expertStage === item.value}
                        aria-pressed={expertStage === item.value}
                        onClick={() => {
                          setExpertStage(item.value);
                          setProgress("全部进度");
                          setPage(1);
                        }}
                      >
                        {item.label}
                        <small>{expertStageCount(item.value)}</small>
                      </button>
                    ))
                  : progressFilters.map((item) => (
                      <button
                        type="button"
                        key={item}
                        data-active={progress === item}
                        aria-pressed={progress === item}
                        onClick={() => {
                          setProgress(item);
                          setPage(1);
                        }}
                      >
                        {item === "全部进度" ? "全部" : item}
                      </button>
                    ))}
              </div>
            </div>
          </div>
          <span className={styles.liveState}>
            <i />
            实时共享
          </span>
        </header>
        <div className={styles.tableWrap}>
          <table
            className={styles.table}
            data-view={viewMode}
            data-compact={compactView}
          >
            <thead>
              <tr>
                {showColumn("dates") ? (
                  <th>
                    客户日期<small>编号 / 接粉 / 进群</small>
                  </th>
                ) : null}
                {showColumn("customer") ? (
                  <th>
                    客户信息<small>号码 / 姓名 / 平台 / 金额</small>
                  </th>
                ) : null}
                {showColumn("attribution") ? (
                  <th>
                    客户归属<small>组员 / 渠道</small>
                  </th>
                ) : null}
                {viewMode === "group" ? (
                  <>
                    {showColumn("maintenance") ? (
                      <th>
                        群维护<small>负责人 / 设备号</small>
                      </th>
                    ) : null}
                    {showColumn("days") ? <th>群内天数</th> : null}
                    {showColumn("groupProgress") ? <th>炒群情况</th> : null}
                  </>
                ) : null}
                {showColumn("leave") ? (
                  <th>
                    退群信息<small>类型 / 日期</small>
                  </th>
                ) : null}
                {showColumn("expertOwner") ? <th>专家负责人</th> : null}
                {viewMode === "expert" ? (
                  <>
                    {showColumn("expertProgress") ? <th>专家情况</th> : null}
                    {showColumn("registration") ? (
                      <th>
                        注册信息<small>状态 / 日期</small>
                      </th>
                    ) : null}
                    {showColumn("initial") ? <th>开单 / 首充</th> : null}
                    {showColumn("recharge") ? <th>续充</th> : null}
                    {showColumn("withdrawal") ? <th>出金</th> : null}
                    {showColumn("net") ? <th>净业绩</th> : null}
                  </>
                ) : null}
                {showColumn("updated") ? <th>最后修改</th> : null}
              </tr>
            </thead>
            <tbody>
              {adding &&
              (canCreateInView ||
                (createMode === "expert-recovery" &&
                  canRegisterExpertCustomer)) ? (
                <tr className={styles.draftRow}>
                  <td>
                    <div className={styles.stackedCell}>
                      <div className={styles.queueLine}>
                        <span>群号</span>
                        <b className={styles.queuePending}>保存后生成</b>
                      </div>
                      <label>
                        <span>接粉</span>
                        <input
                          aria-label="新客户接粉日期"
                          className={styles.dateInput}
                          type="date"
                          value={draft.sourceDate}
                          max={draft.joinedOn}
                          disabled={creating}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              sourceDate: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label>
                        <span>进群</span>
                        <input
                          aria-label="新客户进群日期"
                          className={styles.dateInput}
                          type="date"
                          value={draft.joinedOn}
                          min={draft.sourceDate}
                          max={businessToday}
                          disabled={creating}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              joinedOn: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  </td>
                  <td>
                    <div className={styles.draftCustomer}>
                      <input
                        ref={phoneInput}
                        aria-label="新客户号码"
                        value={draft.phone}
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="号码后 6 位"
                        disabled={creating}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            phone: event.target.value
                              .replace(/\D/g, "")
                              .slice(-6),
                          }))
                        }
                      />
                      <input
                        aria-label="新客户姓名"
                        value={draft.customerName}
                        maxLength={80}
                        placeholder="客户姓名（选填）"
                        disabled={creating}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            customerName: event.target.value,
                          }))
                        }
                      />
                      <input
                        aria-label="新客户平台"
                        value={draft.customerPlatform}
                        maxLength={100}
                        placeholder="平台名称（选填）"
                        disabled={creating}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            customerPlatform: event.target.value,
                          }))
                        }
                      />
                      <input
                        aria-label="新客户被骗金额"
                        type="number"
                        min="0"
                        step="0.01"
                        value={draft.lossAmount}
                        placeholder="被骗金额（选填）"
                        disabled={creating}
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            lossAmount: event.target.value,
                          }))
                        }
                      />
                      <div>
                        <button
                          type="button"
                          title="确认新增"
                          disabled={
                            creating ||
                            draft.phone.length < 6 ||
                            !draft.attributionOwnerId ||
                            !draft.groupOperatorOwnerId ||
                            !draft.deviceCode.trim() ||
                            (createMode === "expert-recovery" &&
                              (!draft.expertOwnerId ||
                                !draft.expertIntroducedOn))
                          }
                          onClick={() => void createCustomer()}
                        >
                          <Plus size={13} />
                          保存
                        </button>
                        <button
                          type="button"
                          title="取消新增"
                          onClick={() => setAdding(false)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className={styles.stackedCell}>
                      <label>
                        <span>组员</span>
                        <select
                          value={draft.attributionOwnerId}
                          aria-label="新增客户接粉归属"
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              attributionOwnerId: event.target.value,
                            }))
                          }
                        >
                          {createMode === "expert-recovery" ? (
                            <option value="">请选择原接粉组员</option>
                          ) : null}
                          {payload?.receptionOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {createMode === "expert-recovery" ? (
                        <>
                          <label>
                            <span>专家</span>
                            <select
                              aria-label="新增客户专家负责人"
                              value={draft.expertOwnerId}
                              disabled={creating}
                              onChange={(event) =>
                                setDraft((value) => ({
                                  ...value,
                                  expertOwnerId: event.target.value,
                                }))
                              }
                            >
                              <option value="">请选择专家负责人</option>
                              {expertCreateOptions.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>推专家</span>
                            <input
                              aria-label="新增客户推专家日期"
                              className={styles.dateInput}
                              type="date"
                              value={draft.expertIntroducedOn}
                              min={draft.joinedOn}
                              max={businessToday}
                              disabled={creating}
                              onChange={(event) =>
                                setDraft((value) => ({
                                  ...value,
                                  expertIntroducedOn: event.target.value,
                                }))
                              }
                            />
                          </label>
                        </>
                      ) : null}
                      <label>
                        <span>渠道</span>
                        <select
                          value={draft.channelId}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              channelId: event.target.value,
                            }))
                          }
                        >
                          {payload?.channelOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>炒群</span>
                        <select
                          aria-label="新增客户炒群负责人"
                          value={draft.groupOperatorOwnerId}
                          disabled={creating}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              groupOperatorOwnerId: event.target.value,
                            }))
                          }
                        >
                          {createMode === "expert-recovery" ? (
                            <option value="">请选择实际炒群负责人</option>
                          ) : null}
                          {payload?.operatorOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>设备</span>
                        <input
                          aria-label="新增客户设备账号"
                          value={draft.deviceCode}
                          maxLength={100}
                          placeholder="必填"
                          disabled={creating}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              deviceCode: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </div>
                  </td>
                  <td
                    className={styles.draftHint}
                    colSpan={Math.max(1, tableColumns - 3)}
                  >
                    {creating
                      ? "正在保存…"
                      : createMode === "expert-recovery"
                        ? "历史接粉和进群日期只恢复档案，不补算旧月份；仅按本次推专家日期增加统计"
                        : "客户号码、姓名、平台和被骗金额集中填写；日期默认今天，也可以修改"}
                  </td>
                </tr>
              ) : null}
              {loading ? (
                <tr>
                  <td colSpan={tableColumns} className={styles.empty}>
                    正在读取客户协作数据…
                  </td>
                </tr>
              ) : (
                customers.map((customer) => {
                  const attributedOwner =
                    customer.attributionOwner ?? customer.owner;
                  const actorId = payload?.actorId ?? member?.id ?? "";
                  const canEditCustomerInfo = Boolean(
                    member &&
                      (isLead ||
                        (canEditReception && attributedOwner?.id === actorId)),
                  );
                  const canEditGroupStage = Boolean(
                    member &&
                      (isLead ||
                        (canEditGroup &&
                          customer.groupOperatorOwner?.id === actorId)),
                  );
                  const canAssignGroupOperator = Boolean(member && isLead);
                  const canEditExpertStage = Boolean(
                    member &&
                      (isLead ||
                        (canEditExpert && customer.expertOwner?.id === actorId)),
                  );
                  const net =
                    (customer.order?.initialDepositCents ?? 0) +
                    (customer.order?.rechargeCents ?? 0) -
                    (customer.order?.withdrawalCents ?? 0);
                  const rechargeCount =
                    customer.order?.financeEvents.filter(
                      (event) => event.kind === "RECHARGE",
                    ).length ?? 0;
                  const withdrawalCount =
                    customer.order?.financeEvents.filter(
                      (event) => event.kind === "WITHDRAWAL",
                    ).length ?? 0;
                  return (
                    <tr key={customer.id}>
                      {showColumn("dates") ? (
                        <td>
                          <div className={styles.stackedCell}>
                            <div className={styles.queueLine}>
                              <span>群号</span>
                              <b
                                className={styles.queueBadge}
                                data-kind="group"
                              >
                                {queueNumber(
                                  "G",
                                  customer.joinedOn,
                                  customer.groupQueueNumber,
                                )}
                              </b>
                            </div>
                            {viewMode === "expert" ? (
                              <>
                                <div className={styles.queueLine}>
                                  <span>专家号</span>
                                  <b
                                    className={styles.queueBadge}
                                    data-kind="expert"
                                  >
                                    {queueNumber(
                                      "E",
                                      customer.expertIntroducedOn,
                                      customer.expertQueueNumber,
                                    )}
                                  </b>
                                </div>
                                {customer.registeredOn ? (
                                  <div className={styles.queueLine}>
                                    <span>注册号</span>
                                    <b className={styles.queueBadge}>
                                      {queueNumber(
                                        "R",
                                        customer.registeredOn,
                                        customer.registrationQueueNumber,
                                      )}
                                    </b>
                                  </div>
                                ) : null}
                                {customer.order ? (
                                  <div className={styles.queueLine}>
                                    <span>开单号</span>
                                    <b className={styles.queueBadge}>
                                      {queueNumber(
                                        "O",
                                        customer.order.openedOn,
                                        customer.order.orderQueueNumber,
                                      )}
                                    </b>
                                  </div>
                                ) : null}
                              </>
                            ) : null}
                            {customer.leftOn ? (
                              <div className={styles.queueLine}>
                                <span>退群号</span>
                                <b className={styles.queueBadge}>
                                  {queueNumber(
                                    "L",
                                    customer.leftOn,
                                    customer.leaveQueueNumber,
                                  )}
                                </b>
                              </div>
                            ) : null}
                            <label>
                              <span>接粉</span>
                              <b>{customer.batch.sourceDate}</b>
                            </label>
                            <label>
                              <span>进群</span>
                              {canEditGroupStage ? (
                                <input
                                  key={customer.joinedOn ?? "empty"}
                                  className={styles.dateInput}
                                  type="date"
                                  defaultValue={customer.joinedOn ?? ""}
                                  min={customer.batch.sourceDate}
                                  max={customer.leftOn ?? businessToday}
                                  disabled={Boolean(savingCell)}
                                  onChange={(event) =>
                                    event.target.value &&
                                    event.target.value !== customer.joinedOn &&
                                    void patchCell(
                                      customer,
                                      {
                                        action: "setJoinedOn",
                                        occurredOn: event.target.value,
                                      },
                                      "joinedOn",
                                      "进群日期已保存",
                                    )
                                  }
                                />
                              ) : (
                                <b>{customer.joinedOn ?? "—"}</b>
                              )}
                            </label>
                          </div>
                        </td>
                      ) : null}
                      {showColumn("customer") ? (
                        <td className={styles.phone}>
                          <div className={styles.customerInfo}>
                            {canEditCustomerInfo ? (
                              <input
                                key={customer.phone}
                                className={styles.customerNameInput}
                                defaultValue={customer.phone}
                                inputMode="numeric"
                                maxLength={80}
                                aria-label="纠正客户号码"
                                disabled={Boolean(savingCell)}
                                onBlur={(event) => {
                                  const phone = event.target.value.trim();
                                  if (phone && phone !== customer.phone)
                                    void patchCell(
                                      customer,
                                      { action: "setPhone", phone },
                                      "phone",
                                      "客户号码已纠正",
                                    );
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter")
                                    event.currentTarget.blur();
                                }}
                              />
                            ) : (
                              <strong>{customer.phone}</strong>
                            )}
                            {canEditCustomerInfo ? (
                              <>
                                <input
                                  key={customer.customerName ?? "empty-name"}
                                  className={styles.customerNameInput}
                                  defaultValue={customer.customerName ?? ""}
                                  maxLength={80}
                                  placeholder="客户姓名"
                                  disabled={Boolean(savingCell)}
                                  onBlur={(event) => {
                                    const customerName =
                                      event.target.value.trim();
                                    if (
                                      customerName !==
                                      (customer.customerName ?? "")
                                    )
                                      void patchCell(
                                        customer,
                                        {
                                          action: "setCustomerName",
                                          customerName,
                                        },
                                        "customerName",
                                        "客户姓名已保存",
                                      );
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter")
                                      event.currentTarget.blur();
                                  }}
                                />
                                <input
                                  key={
                                    customer.customerPlatform ??
                                    "empty-platform"
                                  }
                                  className={styles.customerNameInput}
                                  defaultValue={customer.customerPlatform ?? ""}
                                  maxLength={100}
                                  placeholder="平台名称"
                                  disabled={Boolean(savingCell)}
                                  onBlur={(event) => {
                                    const customerPlatform =
                                      event.target.value.trim();
                                    if (
                                      customerPlatform !==
                                      (customer.customerPlatform ?? "")
                                    )
                                      void patchCell(
                                        customer,
                                        {
                                          action: "setCustomerPlatform",
                                          customerPlatform,
                                        },
                                        "customerPlatform",
                                        "客户平台已保存",
                                      );
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter")
                                      event.currentTarget.blur();
                                  }}
                                />
                                <input
                                  key={
                                    customer.lossAmountCents ?? "empty-amount"
                                  }
                                  className={styles.customerNameInput}
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  defaultValue={
                                    customer.lossAmountCents === null
                                      ? ""
                                      : customer.lossAmountCents / 100
                                  }
                                  placeholder="被骗金额"
                                  disabled={Boolean(savingCell)}
                                  onBlur={(event) => {
                                    const value = event.target.value.trim();
                                    const amountCents = value
                                      ? Math.round(Number(value) * 100)
                                      : null;
                                    if (
                                      (amountCents === null ||
                                        Number.isFinite(amountCents)) &&
                                      amountCents !== customer.lossAmountCents
                                    )
                                      void patchCell(
                                        customer,
                                        {
                                          action: "setLossAmount",
                                          amountCents,
                                        },
                                        "lossAmount",
                                        "被骗金额已保存",
                                      );
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter")
                                      event.currentTarget.blur();
                                  }}
                                />
                              </>
                            ) : (
                              <>
                                <small>
                                  {customer.customerName?.trim() ||
                                    "未填写姓名"}
                                </small>
                                <small>
                                  {customer.customerPlatform?.trim() ||
                                    "未填写平台"}
                                </small>
                                <small>
                                  {customer.lossAmountCents === null
                                    ? "未填写被骗金额"
                                    : `被骗金额 ${money(customer.lossAmountCents)}`}
                                </small>
                              </>
                            )}
                          </div>
                        </td>
                      ) : null}
                      {showColumn("attribution") ? (
                        <td>
                          <div className={styles.stackedCell}>
                            <label>
                              <span>组员</span>
                              <b>{attributedOwner?.name ?? "未分配"}</b>
                            </label>
                            <label>
                              <span>渠道</span>
                              <b>{customer.batch.channel.name}</b>
                            </label>
                            {canEditCustomerInfo ? (
                              <button
                                type="button"
                                className={styles.correctionButton}
                                onClick={() => beginAttributionCorrection(customer)}
                              >
                                {isLead ? "修改组员/渠道" : "修改渠道"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      ) : null}
                      {viewMode === "group" ? (
                        <>
                          {showColumn("maintenance") ? (
                            <td>
                              <div className={styles.stackedCell}>
                                <label>
                                  <span>负责人</span>
                                  {canAssignGroupOperator ? (
                                    <select
                                      className={styles.cellSelect}
                                      value={
                                        customer.groupOperatorOwner?.id ?? ""
                                      }
                                      disabled={Boolean(savingCell)}
                                      onChange={(event) =>
                                        void patchCell(
                                          customer,
                                          {
                                            action: "assignGroupOperator",
                                            userId: event.target.value,
                                          },
                                          "operator",
                                          "炒群负责人已保存",
                                        )
                                      }
                                    >
                                      <option value="" disabled>
                                        点击选择
                                      </option>
                                      {payload?.operatorOptions.map((item) => (
                                        <option key={item.id} value={item.id}>
                                          {item.name}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <b>
                                      {customer.groupOperatorOwner?.name ??
                                        "待分配"}
                                    </b>
                                  )}
                                </label>
                                <label>
                                  <span>设备号</span>
                                  {canEditGroupStage ? (
                                    <input
                                      key={customer.device?.code ?? "empty"}
                                      className={styles.deviceInput}
                                      defaultValue={customer.device?.code ?? ""}
                                      maxLength={100}
                                      placeholder="手动填写"
                                      disabled={Boolean(savingCell)}
                                      onBlur={(event) => {
                                        const code = event.target.value.trim();
                                        if (
                                          code !== (customer.device?.code ?? "")
                                        )
                                          void patchCell(
                                            customer,
                                            { action: "setDeviceCode", code },
                                            "device",
                                            "设备号已保存",
                                          );
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter")
                                          event.currentTarget.blur();
                                      }}
                                    />
                                  ) : (
                                    <b>{customer.device?.code ?? "—"}</b>
                                  )}
                                </label>
                              </div>
                            </td>
                          ) : null}
                          {showColumn("days") ? (
                            <td className={styles.dayCell}>
                              {daysInGroup(
                                customer.joinedOn,
                                customer.leftOn,
                                businessToday,
                              )}
                            </td>
                          ) : null}
                          {showColumn("groupProgress") ? (
                            <td className={styles.progressCell}>
                              <EditableCell
                                label="炒群情况"
                                value={latestGroupText(customer)}
                                editable={canEditGroupStage}
                                saving={savingCell === `${customer.id}:group`}
                                onSave={(note) =>
                                  saveSituation(customer, "group", note)
                                }
                              />
                            </td>
                          ) : null}
                        </>
                      ) : null}
                      {showColumn("leave") ? (
                        <td>
                          <div className={styles.stackedCell}>
                            <label>
                              <span>类型</span>
                              {canEditGroupStage ? (
                                <select
                                  className={styles.cellSelect}
                                  value={
                                    customer.groupStatus === "LEFT"
                                      ? customer.leftWithOrder
                                        ? "NORMAL"
                                        : "ABNORMAL"
                                      : ""
                                  }
                                  disabled={Boolean(savingCell)}
                                  onChange={(event) => {
                                    const leaveType = event.target.value;
                                    void patchCell(
                                      customer,
                                      leaveType
                                        ? {
                                            action: "setLeave",
                                            leaveType,
                                            occurredOn:
                                              customer.leftOn ?? businessToday,
                                          }
                                        : {
                                            action: "setLeave",
                                            leaveType: "NONE",
                                          },
                                      "leave",
                                      leaveType
                                        ? "退群类型已纠正"
                                        : "退群记录已撤销",
                                    );
                                  }}
                                >
                                  <option value="">
                                    {customer.groupStatus === "LEFT"
                                      ? "撤销退群"
                                      : "—"}
                                  </option>
                                  <option value="NORMAL">正常退群</option>
                                  <option value="ABNORMAL">异常退群</option>
                                </select>
                              ) : (
                                <b>
                                  {customer.groupStatus === "LEFT"
                                    ? customer.leftWithOrder
                                      ? "正常退群"
                                      : "异常退群"
                                    : "—"}
                                </b>
                              )}
                            </label>
                            <label>
                              <span>日期</span>
                              {canEditGroupStage && customer.groupStatus === "LEFT" ? (
                                <input
                                  key={customer.leftOn ?? "empty-left"}
                                  className={styles.dateInput}
                                  type="date"
                                  defaultValue={customer.leftOn ?? ""}
                                  min={customer.joinedOn ?? undefined}
                                  max={businessToday}
                                  disabled={Boolean(savingCell)}
                                  onChange={(event) =>
                                    event.target.value &&
                                    event.target.value !== customer.leftOn &&
                                    void patchCell(
                                      customer,
                                      {
                                        action: "setLeave",
                                        leaveType: customer.leftWithOrder
                                          ? "NORMAL"
                                          : "ABNORMAL",
                                        occurredOn: event.target.value,
                                      },
                                      "leave",
                                      "退群日期已纠正",
                                    )
                                  }
                                />
                              ) : (
                                <b>{customer.leftOn ?? "—"}</b>
                              )}
                            </label>
                          </div>
                        </td>
                      ) : null}
                      {showColumn("expertOwner") ? (
                        <td>
                          {canEditGroupStage ? (
                            <div className={styles.stackedCell}>
                              <label>
                                <span>负责人</span>
                                <select
                                  className={styles.cellSelect}
                                  value={customer.expertOwner?.id ?? ""}
                                  disabled={Boolean(savingCell)}
                                  onChange={(event) =>
                                    void patchCell(
                                      customer,
                                      {
                                        action: "assignExpert",
                                        userId: event.target.value,
                                        occurredOn:
                                          expertDates[customer.id] ??
                                          customer.expertIntroducedOn ??
                                          businessToday,
                                      },
                                      "expert",
                                      "专家负责人和推专家日期已保存",
                                    )
                                  }
                                >
                                  <option value="" disabled>
                                    点击选择
                                  </option>
                              {payload?.expertOptions.map((item) => (
                                    <option key={item.id} value={item.id}>
                                      {item.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                <span>推专家日期</span>
                                <input
                                  aria-label="推专家日期"
                                  className={styles.dateInput}
                                  type="date"
                                  value={
                                    expertDates[customer.id] ??
                                    customer.expertIntroducedOn ??
                                    businessToday
                                  }
                                  min={customer.joinedOn ?? undefined}
                                  max={earliestDate(
                                    customer.leftOn,
                                    customer.registeredOn,
                                    customer.order?.openedOn,
                                    businessToday,
                                  )}
                                  disabled={Boolean(savingCell)}
                                  onChange={(event) => {
                                    const occurredOn = event.target.value;
                                    setExpertDates((current) => ({
                                      ...current,
                                      [customer.id]: occurredOn,
                                    }));
                                    if (
                                      customer.expertOwner?.id &&
                                      occurredOn &&
                                      occurredOn !== customer.expertIntroducedOn
                                    )
                                      void patchCell(
                                        customer,
                                        {
                                          action: "assignExpert",
                                          userId: customer.expertOwner.id,
                                          occurredOn,
                                        },
                                        "expertDate",
                                        "推专家日期已纠正",
                                      );
                                  }}
                                />
                              </label>
                            </div>
                          ) : (
                            <div className={styles.stackedCell}>
                              <b>{customer.expertOwner?.name ?? "未分配"}</b>
                              <small>
                                推专家：{customer.expertIntroducedOn ?? "—"}
                              </small>
                            </div>
                          )}
                        </td>
                      ) : null}
                      {viewMode === "expert" ? (
                        <>
                          {showColumn("expertProgress") ? (
                            <td className={styles.progressCell}>
                              <EditableCell
                                label="专家情况"
                                value={latestExpertText(customer)}
                                editable={canEditExpertStage}
                                saving={savingCell === `${customer.id}:expert`}
                                onSave={(note) =>
                                  saveSituation(customer, "expert", note)
                                }
                              />
                            </td>
                          ) : null}
                          {showColumn("registration") ? (
                            <td>
                              <div className={styles.stackedCell}>
                                <div>
                                  <span>状态</span>
                                  <span
                                    className={styles.registrationStatus}
                                    data-registered={Boolean(
                                      customer.registeredOn,
                                    )}
                                  >
                                    {customer.registeredOn
                                      ? "已注册"
                                      : "未注册"}
                                  </span>
                                </div>
                                <label>
                                  <span>日期</span>
                                  {canEditExpertStage ? (
                                    <input
                                      key={customer.registeredOn ?? "empty"}
                                      className={styles.dateInput}
                                      type="date"
                                      defaultValue={customer.registeredOn ?? ""}
                                      min={customer.joinedOn ?? undefined}
                                      disabled={Boolean(savingCell)}
                                      onChange={(event) =>
                                        event.target.value &&
                                        void patchCell(
                                          customer,
                                          {
                                            action: "setRegistration",
                                            occurredOn: event.target.value,
                                          },
                                          "registration",
                                          "注册日期已保存",
                                        )
                                      }
                                    />
                                  ) : (
                                    <b>{customer.registeredOn ?? "—"}</b>
                                  )}
                                </label>
                              </div>
                            </td>
                          ) : null}
                          {showColumn("initial") ? (
                            <td className={styles.money}>
                              {customer.order ? (
                                <button
                                  className={styles.financeCell}
                                  onClick={() =>
                                    canEditExpertStage &&
                                    openFinance("INITIAL", customer)
                                  }
                                  disabled={!canEditExpertStage}
                                >
                                  {money(customer.order.initialDepositCents)}
                                  <small>{customer.order.openedOn}</small>
                                </button>
                              ) : (
                                <button
                                  className={styles.financeAdd}
                                  disabled={!canEditExpertStage}
                                  title={
                                    !canEditExpertStage
                                      ? "需要专家权限"
                                      : !customer.registeredOn
                                        ? "请先填写注册日期，再登记开单日期和开单金额"
                                        : "登记开单日期、开单金额和入金方式"
                                  }
                                  onClick={() => {
                                    if (!customer.registeredOn) {
                                      setError(
                                        "请先填写注册日期；保存后即可填写开单日期和开单金额。",
                                      );
                                      return;
                                    }
                                    openFinance("INITIAL", customer);
                                  }}
                                >
                                  + 开单 / 首充
                                </button>
                              )}
                            </td>
                          ) : null}
                          {showColumn("recharge") ? (
                            <td className={styles.money}>
                              <button
                                className={styles.financeCell}
                                disabled={!canEditExpertStage || !customer.order}
                                onClick={() =>
                                  openFinance("RECHARGE", customer)
                                }
                              >
                                {money(customer.order?.rechargeCents)}
                                {rechargeCount ? (
                                  <small>{rechargeCount}笔</small>
                                ) : null}
                              </button>
                            </td>
                          ) : null}
                          {showColumn("withdrawal") ? (
                            <td>
                              <button
                                className={styles.financeCell}
                                disabled={!canEditExpertStage || !customer.order}
                                onClick={() =>
                                  openFinance("WITHDRAWAL", customer)
                                }
                              >
                                {money(customer.order?.withdrawalCents)}
                                {withdrawalCount ? (
                                  <small>{withdrawalCount}笔</small>
                                ) : null}
                              </button>
                            </td>
                          ) : null}
                          {showColumn("net") ? (
                            <td className={styles.net}>
                              <button
                                type="button"
                                className={styles.netButton}
                                disabled={!canEditExpertStage || !customer.order}
                                title={
                                  !canEditExpertStage
                                    ? "需要专家或组长权限"
                                    : !customer.order
                                      ? "请先登记开单与首充"
                                      : "查看资金流水，新增续充或出金"
                                }
                                onClick={() => openLedger(customer)}
                              >
                                {money(net)}
                                {customer.order ? <small>查看流水</small> : null}
                              </button>
                            </td>
                          ) : null}
                        </>
                      ) : null}
                      {showColumn("updated") ? (
                        <td className={styles.updated}>
                          {customer.activities[0]?.actor?.name ?? "系统"}
                          <small>
                            {customer.activities[0]?.occurredOn ?? "—"}
                          </small>
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              )}
              {!loading && customers.length === 0 && !adding ? (
                <tr>
                  <td colSpan={tableColumns} className={styles.empty}>
                    {viewMode === "group" && exactPhoneQuery ? (
                      phoneLookup.status === "loading" ? (
                        "正在核对这个号码的全部进度…"
                      ) : phoneLookup.status === "found" &&
                        phoneLookup.customer.expertIntroducedOn ? (
                        <>
                          该号码已经推过专家，没有重复新增。
                          <button
                            type="button"
                            onClick={() => switchView("expert")}
                          >
                            查看专家进度
                          </button>
                        </>
                      ) : phoneLookup.status === "missing" &&
                        canRegisterExpertCustomer ? (
                        <>
                          没有找到这个号码的当前档案。
                          <button
                            type="button"
                            onClick={() =>
                              beginAdd("expert-recovery", exactPhoneQuery)
                            }
                          >
                            登记本次推专家
                          </button>
                          <small>
                            可填写历史接粉、进群日期；旧月份不会重复加数
                          </small>
                        </>
                      ) : (
                        "没有找到这个号码"
                      )
                    ) : viewMode === "group" ? (
                      "没有待推专家的客户"
                    ) : (
                      "还没有已推专家的客户"
                    )}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <footer className={styles.footer}>
          <span>
            {viewMode === "group" ? "待推专家" : "专家进度"}{" "}
            <strong>{resultTotal} 位</strong>
            {resultTotal ? ` · 当前显示第 ${visibleFrom}–${visibleTo} 位` : ""}
            <em>↕ 表格右侧可上下滚动查看更多</em>
          </span>
          <div>
            <span>自动保存并记录操作人</span>
            <button
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              上一页
            </button>
            <b>
              {page} / {pageCount}
            </b>
            <button
              disabled={page >= pageCount || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </div>
        </footer>
      </section>

      {correction ? (
        <div
          className={styles.modalBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCorrection(null);
          }}
        >
          <section className={styles.financeModal}>
            <header>
              <div>
                <h3>{isLead ? "修改客户接粉信息" : "修改客户渠道"}</h3>
                <p>
                  {correction.phone} · 修改渠道后，已经产生的相关统计会一起更新到正确渠道。
                </p>
              </div>
              <button type="button" onClick={() => setCorrection(null)}>
                <X size={18} />
              </button>
            </header>
            <div className={styles.financeForm}>
              {isLead ? (
                <label>
                  <span>接粉归属人</span>
                  <select
                    aria-label="纠正客户接粉归属人"
                    value={correctionDraft.attributionOwnerId}
                    disabled={savingCorrection}
                    onChange={(event) =>
                      setCorrectionDraft((value) => ({
                        ...value,
                        attributionOwnerId: event.target.value,
                      }))
                    }
                  >
                    {payload?.receptionOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span>来源渠道</span>
                <select
                  aria-label="纠正客户来源渠道"
                  value={correctionDraft.channelId}
                  disabled={savingCorrection}
                  onChange={(event) =>
                    setCorrectionDraft((value) => ({
                      ...value,
                      channelId: event.target.value,
                    }))
                  }
                >
                  {payload?.channelOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {isLead ? (
                <label>
                  <span>接粉日期</span>
                  <input
                    aria-label="纠正客户接粉日期"
                    type="date"
                    value={correctionDraft.sourceDate}
                    max={correction.joinedOn ?? businessToday}
                    disabled={savingCorrection}
                    onChange={(event) =>
                      setCorrectionDraft((value) => ({
                        ...value,
                        sourceDate: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}
              <label className={styles.correctionReason}>
                <span>修改原因（必填）</span>
                <textarea
                  aria-label="客户归属纠错原因"
                  value={correctionDraft.reason}
                  rows={3}
                  maxLength={300}
                  placeholder="例如：录入时选错渠道，现修改为正确渠道"
                  disabled={savingCorrection}
                  onChange={(event) =>
                    setCorrectionDraft((value) => ({
                      ...value,
                      reason: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <footer>
              <button type="button" onClick={() => setCorrection(null)}>
                取消
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={savingCorrection || correctionDraft.reason.trim().length < 2}
                onClick={() => void saveAttributionCorrection()}
              >
                {savingCorrection ? "保存中…" : "确认纠错并留痕"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {ledgerCustomer?.order ? (
        <div
          className={styles.modalBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setLedgerCustomer(null);
          }}
        >
          <section className={styles.financeModal}>
            <header>
              <div>
                <h3>客户资金流水</h3>
                <p>{ledgerCustomer.phone} · 每笔记录独立保存日期、金额和操作人</p>
                <p>这里只跟踪客户资金变化，不修改组员填写的公司认账财务。</p>
              </div>
              <button type="button" onClick={() => setLedgerCustomer(null)}>
                <X size={18} />
              </button>
            </header>
            <div className={styles.financeSummary}>
              <div><span>首充</span><strong>{money(ledgerCustomer.order.initialDepositCents)}</strong></div>
              <div><span>续充</span><strong>{money(ledgerCustomer.order.rechargeCents)}</strong></div>
              <div><span>出金</span><strong>{money(ledgerCustomer.order.withdrawalCents)}</strong></div>
              <div data-net="true"><span>当前净值</span><strong>{money(ledgerCustomer.order.initialDepositCents + ledgerCustomer.order.rechargeCents - ledgerCustomer.order.withdrawalCents)}</strong></div>
            </div>
            <div className={styles.financeHistory}>
              <div>
                <span>首充 · {ledgerCustomer.order.openedOn}</span>
                <strong>{money(ledgerCustomer.order.initialDepositCents)}</strong>
                <small>{depositMethodLabel(ledgerCustomer.order.initialDepositMethod)} · {ledgerCustomer.order.enteredBy?.name ?? "历史记录"}</small>
              </div>
              {ledgerCustomer.order.financeEvents.map((event) => (
                <div key={event.id}>
                  <span>
                    {event.kind === "RECHARGE"
                      ? `第 ${event.continuationNumber ?? "—"} 次续充`
                      : "出金"} · {event.occurredOn}
                  </span>
                  <strong data-kind={event.kind}>{event.kind === "WITHDRAWAL" ? "−" : "+"}{money(event.amountCents)}</strong>
                  <small>{event.kind === "RECHARGE" ? `${depositMethodLabel(event.depositMethod)} · ` : ""}{event.enteredBy?.name ?? "历史记录"}</small>
                </div>
              ))}
            </div>
            <footer className={styles.ledgerActions}>
              <button type="button" onClick={() => setLedgerCustomer(null)}>关闭</button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  const customer = ledgerCustomer;
                  setLedgerCustomer(null);
                  openFinance("RECHARGE", customer);
                }}
              >
                + 新增续充
              </button>
              <button
                type="button"
                className={styles.withdrawalButton}
                onClick={() => {
                  const customer = ledgerCustomer;
                  setLedgerCustomer(null);
                  openFinance("WITHDRAWAL", customer);
                }}
              >
                + 登记出金
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {finance ? (
        <div
          className={styles.modalBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setFinance(null);
          }}
        >
          <section className={styles.financeModal}>
            <header>
              <div>
                <h3>
                  {finance.kind === "INITIAL"
                    ? finance.customer.order
                      ? "开单与首充记录"
                      : "登记开单与首充"
                    : finance.kind === "RECHARGE"
                      ? "续充明细"
                      : "出金明细"}
                </h3>
                <p>
                  {finance.customer.phone} ·
                  每笔资金单独记录日期、金额和操作账号
                </p>
                <p>
                  这里只记录客户实际发生的资金变化，不计入公司认账业绩；公司业绩以组员填写的每日财务数据为准。
                </p>
              </div>
              <button type="button" onClick={() => setFinance(null)}>
                <X size={18} />
              </button>
            </header>
            {finance.kind === "INITIAL" && finance.customer.order ? (
              <div className={styles.financeHistory}>
                <div>
                  <span>{finance.customer.order.openedOn}</span>
                  <strong>
                    {money(finance.customer.order.initialDepositCents)}
                  </strong>
                  <small>
                    {finance.customer.order.enteredBy?.name ?? "历史记录"}
                  </small>
                </div>
              </div>
            ) : finance.kind !== "INITIAL" &&
              finance.customer.order?.financeEvents.filter(
                (event) => event.kind === finance.kind,
              ).length ? (
              <div className={styles.financeHistory}>
                {finance.customer.order.financeEvents
                  .filter((event) => event.kind === finance.kind)
                  .map((event) => (
                    <div key={event.id}>
                      <span>{event.occurredOn}</span>
                      <strong>{money(event.amountCents)}</strong>
                      <small>{event.enteredBy?.name ?? "历史记录"}</small>
                    </div>
                  ))}
              </div>
            ) : null}
            {finance.kind !== "INITIAL" || !finance.customer.order ? (
              <div className={styles.financeForm}>
                <label>
                  <span>
                    {finance.kind === "INITIAL"
                      ? "开单日期"
                      : finance.kind === "RECHARGE"
                        ? "续充日期"
                        : "出金日期"}
                  </span>
                  <input
                    type="date"
                    aria-label={
                      finance.kind === "INITIAL"
                        ? "开单日期"
                        : finance.kind === "RECHARGE"
                          ? "续充日期"
                          : "出金日期"
                    }
                    min={
                      finance.kind === "INITIAL"
                        ? finance.customer.registeredOn ?? undefined
                        : finance.customer.order?.openedOn
                    }
                    max={businessToday}
                    value={financeDraft.occurredOn}
                    onChange={(event) =>
                      setFinanceDraft((value) => ({
                        ...value,
                        occurredOn: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  <span>
                    {finance.kind === "INITIAL"
                      ? "开单金额（首充）"
                      : finance.kind === "RECHARGE"
                        ? "续充金额"
                        : "出金金额"}
                  </span>
                  <input
                    type="number"
                    aria-label={
                      finance.kind === "INITIAL"
                        ? "开单金额（首充）"
                        : finance.kind === "RECHARGE"
                          ? "续充金额"
                          : "出金金额"
                    }
                    min="0.01"
                    step="0.01"
                    value={financeDraft.amount}
                    autoFocus
                    placeholder="0.00"
                    onChange={(event) =>
                      setFinanceDraft((value) => ({
                        ...value,
                        amount: event.target.value,
                      }))
                    }
                  />
                </label>
                {finance.kind !== "WITHDRAWAL" ? (
                  <label>
                    <span>入金方式</span>
                    <select
                      value={financeDraft.depositMethod}
                      onChange={(event) =>
                        setFinanceDraft((value) => ({
                          ...value,
                          depositMethod: event.target.value as
                            | "CRYPTO"
                            | "BANK",
                        }))
                      }
                    >
                      <option value="CRYPTO">加密货币</option>
                      <option value="BANK">银行卡</option>
                    </select>
                  </label>
                ) : null}
              </div>
            ) : null}
            <footer>
              <button type="button" onClick={() => setFinance(null)}>
                {finance.kind === "INITIAL" && finance.customer.order
                  ? "关闭"
                  : "取消"}
              </button>
              {finance.kind !== "INITIAL" || !finance.customer.order ? (
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={savingFinance}
                  onClick={() => void saveFinance()}
                >
                  {savingFinance
                    ? "保存中…"
                    : finance.kind === "INITIAL"
                      ? "确认开单并登记首充"
                      : finance.kind === "RECHARGE"
                        ? "+ 确认本次续充"
                        : "+ 确认本次出金"}
                </button>
              ) : null}
            </footer>
          </section>
        </div>
      ) : null}
      {savedMessage ? <div className={styles.toast}>{savedMessage}</div> : null}
    </div>
  );
}
