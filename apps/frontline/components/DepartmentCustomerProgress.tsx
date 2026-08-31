"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { requestJson, type BackendUser } from "@/lib/backend";
import { localToday } from "@/lib/frontline-workbench";
import styles from "./DepartmentCustomerProgress.module.css";

export type DepartmentCustomerGroup = { id: string; name: string };
type Owner = { id: string; name: string } | null;
type Activity = { id?: string; kind: string; occurredOn: string; note: string | null; actor?: { name: string } };
type Customer = {
  id: string; phone: string; customerName: string | null; groupStatus: string; joinedOn: string | null; leftOn: string | null;
  leftNote: string | null; leftWithOrder: boolean; expertIntroducedOn: string | null; expertContactNote: string | null;
  expertWorkflowStage: string | null; registeredOn: string | null; expertNotes: string | null; nextPlan: string | null;
  owner: Owner; groupOperatorOwner: Owner; expertOwner: Owner; device: { id: string; code: string } | null;
  batch: { sourceDate: string; channel: { name: string } };
  order: { initialDepositCents: number; rechargeCents: number; withdrawalCents: number } | null;
  activities: Activity[];
};
type Payload = {
  page: number; pageSize: number; total: number; customers: Customer[]; channels: string[];
  channelOptions: Array<{ id: string; name: string }>; memberOptions: Array<{ id: string; name: string }>;
};
type ReportingPayload = { groups: DepartmentCustomerGroup[] };
type ProgressFilter = "全部进度" | "群内维护" | "已推专家" | "已开单" | "已退群";

const money = (cents = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const expertLabels: Record<string, string> = { QUEUED: "待专家接待", MATERIALS: "已经交资料，等待进一步沟通", TRACKING: "专家跟进中", PENDING_REGISTRATION: "待注册", PENDING_ORDER: "待开单", DECLINED_DEPOSIT: "暂不首充", ORDERED: "已开单，等待客户后续维护", STALLED: "停止维护" };
const activityLabels: Record<string, string> = { JOINED_GROUP: "客户已进群", LEFT_GROUP: "客户已退群", GROUP_PROGRESS_UPDATED: "炒群情况已更新", EXPERT_INTRODUCED: "已推专家", EXPERT_CONTACTED: "专家已接待", REGISTERED: "客户已注册", PLAN_UPDATED: "专家情况已更新" };
const progressFilters: ProgressFilter[] = ["全部进度", "群内维护", "已推专家", "已开单", "已退群"];

function latestGroupText(customer: Customer) {
  return customer.activities.find((item) => item.kind === "GROUP_PROGRESS_UPDATED")?.note?.trim()
    || customer.leftNote || (customer.expertIntroducedOn ? "已推专家" : "暂无炒群记录");
}
function latestExpertText(customer: Customer) {
  return customer.expertNotes?.trim() || customer.nextPlan || customer.expertContactNote
    || (customer.expertIntroducedOn ? (expertLabels[customer.expertWorkflowStage ?? ""] ?? "专家跟进中") : "—");
}
function progressOf(customer: Customer): Exclude<ProgressFilter, "全部进度"> {
  if (customer.groupStatus === "LEFT") return "已退群";
  if (customer.order) return "已开单";
  if (customer.expertIntroducedOn) return "已推专家";
  return "群内维护";
}
function daysInGroup(joinedOn: string | null, leftOn: string | null) {
  if (!joinedOn) return "—";
  const start = Date.parse(`${joinedOn}T00:00:00Z`);
  const end = Date.parse(`${leftOn || localToday()}T00:00:00Z`);
  return `第${Math.max(1, Math.floor((end - start) / 86_400_000) + 1)}天`;
}

function EditableCell({ label, value, editable, saving, onSave }: { label: string; value: string; editable: boolean; saving: boolean; onSave: (value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [editing, value]);
  async function finish() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === value.trim()) { setDraft(value); return; }
    await onSave(next);
  }
  if (editing) return <textarea aria-label={label} className={styles.cellEditor} value={draft} maxLength={300} rows={2} autoFocus onChange={(event) => setDraft(event.target.value)} onBlur={() => void finish()} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void finish(); } }} />;
  return <button type="button" className={styles.editableCell} data-editable={editable} disabled={!editable || saving} onDoubleClick={() => setEditing(true)} title={editable ? `双击修改${label}` : `${label}只读`}><span>{value || "—"}</span>{saving ? <small>保存中…</small> : null}</button>;
}

export function DepartmentCustomerProgress({ groups, member }: { groups?: DepartmentCustomerGroup[]; member?: BackendUser }) {
  const [availableGroups, setAvailableGroups] = useState(groups ?? []);
  const [groupId, setGroupId] = useState(groups?.[0]?.id ?? "");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [page, setPage] = useState(1); const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState(""); const [progress, setProgress] = useState<ProgressFilter>("全部进度");
  const [savingCell, setSavingCell] = useState(""); const [savedMessage, setSavedMessage] = useState("");
  const [adding, setAdding] = useState(false); const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ phone: "", customerName: "", channelId: "", joinedOn: localToday(), deviceCode: "", attributionOwnerId: member?.id ?? "" });

  useEffect(() => {
    if (groups) { setAvailableGroups(groups); setGroupId((current) => groups.some((group) => group.id === current) ? current : groups[0]?.id ?? ""); return; }
    let cancelled = false;
    void requestJson<ReportingPayload>("/api/org/reporting?range=month").then((result) => { if (!cancelled) { setAvailableGroups(result.groups); setGroupId((current) => current || result.groups[0]?.id || ""); } }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "小组读取失败"); });
    return () => { cancelled = true; };
  }, [groups]);

  useEffect(() => {
    if (!groupId) { setPayload(null); setLoading(false); return; }
    let cancelled = false; setLoading(true); setError("");
    const params = new URLSearchParams({ groupId, stage: "group", page: String(page) });
    void requestJson<Payload>(`/api/lead/customer-reporting?${params}`).then((result) => { if (!cancelled) setPayload(result); }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "客户进度读取失败"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId, page, reloadKey]);

  const customers = useMemo(() => (payload?.customers ?? []).filter((customer) => {
    const haystack = `${customer.phone} ${customer.customerName ?? ""} ${customer.owner?.name ?? ""} ${customer.batch.channel.name} ${customer.groupOperatorOwner?.name ?? ""} ${customer.expertOwner?.name ?? ""} ${latestGroupText(customer)} ${latestExpertText(customer)}`.toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (progress === "全部进度" || progressOf(customer) === progress);
  }), [payload?.customers, progress, query]);
  const pageCount = Math.max(1, Math.ceil((payload?.total ?? 0) / (payload?.pageSize ?? 50)));
  function showSaved(message: string) { setSavedMessage(message); window.setTimeout(() => setSavedMessage(""), 2400); }
  function beginAdd() {
    setAdding(true); setError("");
    setDraft((value) => ({ ...value, channelId: value.channelId || payload?.channelOptions[0]?.id || "", attributionOwnerId: value.attributionOwnerId || member?.id || "" }));
  }
  async function saveSituation(customer: Customer, kind: "group" | "expert", note: string) {
    const key = `${customer.id}:${kind}`; setSavingCell(key); setError("");
    try {
      await requestJson(`/api/leads/${customer.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(kind === "group" ? { action: "updateGroupProgress", progressNote: note, occurredOn: localToday() } : { action: "updateExpertDetails", expertNotes: note, occurredOn: localToday() }) });
      showSaved(`${kind === "group" ? "炒群情况" : "专家情况"}已自动保存`); setReloadKey((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "客户进度保存失败"); throw caught; }
    finally { setSavingCell(""); }
  }
  async function createCustomer(event: FormEvent) {
    event.preventDefault(); setCreating(true); setError("");
    try {
      await requestJson("/api/lead/customer-reporting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      setAdding(false); setDraft({ phone: "", customerName: "", channelId: payload?.channelOptions[0]?.id ?? "", joinedOn: localToday(), deviceCode: "", attributionOwnerId: member?.id ?? "" });
      setPage(1); setProgress("全部进度"); showSaved("客户已加入组内共享表"); setReloadKey((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "新增客户失败"); }
    finally { setCreating(false); }
  }

  return <div className={styles.sheetWorkspace}>
    <section className={styles.toolbar}>
      <label className={styles.search}><MagnifyingGlass size={14} /><input aria-label="搜索客户" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索号码、组员、渠道或进度" /></label>
      {availableGroups.length > 1 ? <select aria-label="查看小组" value={groupId} onChange={(event) => { setGroupId(event.target.value); setPage(1); }}>{availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select> : null}
      <select aria-label="进度筛选" value={progress} onChange={(event) => setProgress(event.target.value as ProgressFilter)}>{progressFilters.map((item) => <option key={item}>{item}</option>)}</select>
      {member ? <button className={styles.addButton} disabled={!groupId || loading} onClick={beginAdd}><Plus size={15} weight="bold" />新增已进群客户</button> : null}
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}
    <section className={styles.sheetCard}>
      <header className={styles.sheetHeader}><div><h2>组内共享客户进度</h2><p>只登记已经进群的客户；修改单元格后自动保存</p></div><span><i />实时共享</span></header>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>进群日期（自动）</th><th>客户号码</th><th>归属组员</th><th>来源渠道</th><th>炒群负责人</th><th>设备号</th><th>群内天数</th><th>炒群情况</th><th>退群类型</th><th>退群日期（自动）</th><th>专家负责人</th><th>专家情况</th><th>注册日期</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th><th>最后修改</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={18} className={styles.empty}>正在读取组内共享数据…</td></tr> : customers.map((customer) => {
            const canEdit = Boolean(member); const net = (customer.order?.initialDepositCents ?? 0) + (customer.order?.rechargeCents ?? 0) - (customer.order?.withdrawalCents ?? 0);
            return <tr key={customer.id}><td>{customer.joinedOn ?? "—"}</td><td className={styles.phone}><strong>{customer.phone}</strong>{customer.customerName?.trim() ? <small>{customer.customerName}</small> : null}</td><td>{customer.owner?.name ?? "未分配"}</td><td>{customer.batch.channel.name}</td><td>{customer.groupOperatorOwner?.name ?? "待分配"}</td><td>{customer.device?.code ?? "—"}</td><td className={styles.dayCell}>{daysInGroup(customer.joinedOn, customer.leftOn)}</td><td className={styles.progressCell}><EditableCell label="炒群情况" value={latestGroupText(customer)} editable={canEdit} saving={savingCell === `${customer.id}:group`} onSave={(note) => saveSituation(customer, "group", note)} /></td><td>{customer.groupStatus === "LEFT" ? (customer.leftWithOrder ? "正常退群" : "异常退群") : "—"}</td><td>{customer.leftOn ?? "—"}</td><td>{customer.expertOwner?.name ?? "未分配"}</td><td className={styles.progressCell}><EditableCell label="专家情况" value={latestExpertText(customer)} editable={canEdit} saving={savingCell === `${customer.id}:expert`} onSave={(note) => saveSituation(customer, "expert", note)} /></td><td>{customer.registeredOn ?? "—"}</td><td className={styles.money}>{money(customer.order?.initialDepositCents)}</td><td className={styles.money}>{money(customer.order?.rechargeCents)}</td><td>{money(customer.order?.withdrawalCents)}</td><td className={styles.net}>{money(net)}</td><td className={styles.updated}>{customer.activities[0]?.actor?.name ?? "系统"}<small>{customer.activities[0]?.occurredOn ?? "—"}</small></td></tr>;
          })}{!loading && customers.length === 0 ? <tr><td colSpan={18} className={styles.empty}>没有符合当前条件的已进群客户</td></tr> : null}</tbody>
        </table>
      </div>
      <footer className={styles.footer}><span>共 {payload?.total ?? 0} 位客户 · 双击可填写单元格修改</span><div><span>每次修改都记录账号和时间</span><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><b>{page} / {pageCount}</b><button disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
    </section>

    {adding && member ? <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setAdding(false); }}><form className={styles.modal} onSubmit={createCustomer}><header><div><h3>新增已进群客户</h3><p>保存后直接出现在组内共享表，客户业绩归属所选组员。</p></div><button type="button" onClick={() => setAdding(false)}><X size={18} /></button></header><div className={styles.formGrid}><label><span>客户号码 *</span><input value={draft.phone} onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value }))} required autoFocus /></label><label><span>客户姓名</span><input value={draft.customerName} onChange={(event) => setDraft((value) => ({ ...value, customerName: event.target.value }))} /></label><label><span>来源渠道 *</span><select value={draft.channelId} onChange={(event) => setDraft((value) => ({ ...value, channelId: event.target.value }))} required><option value="">请选择</option>{payload?.channelOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>归属组员 *</span><select value={draft.attributionOwnerId} onChange={(event) => setDraft((value) => ({ ...value, attributionOwnerId: event.target.value }))} required><option value="">请选择</option>{payload?.memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>进群日期 *</span><input type="date" value={draft.joinedOn} onChange={(event) => setDraft((value) => ({ ...value, joinedOn: event.target.value }))} required /></label><label><span>设备号</span><input value={draft.deviceCode} onChange={(event) => setDraft((value) => ({ ...value, deviceCode: event.target.value }))} /></label></div><footer><button type="button" onClick={() => setAdding(false)}>取消</button><button type="submit" disabled={creating}>{creating ? "保存中…" : "保存到共享表"}</button></footer></form></div> : null}
    {savedMessage ? <div className={styles.toast}>{savedMessage}</div> : null}
  </div>;
}
