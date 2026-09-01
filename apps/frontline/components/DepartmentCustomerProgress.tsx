"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, Plus, X } from "@phosphor-icons/react";
import { requestJson, type BackendUser } from "@/lib/backend";
import { localToday } from "@/lib/frontline-workbench";
import styles from "./DepartmentCustomerProgress.module.css";
import { LegacyCustomerImport } from "./LegacyCustomerImport";

export type DepartmentCustomerGroup = { id: string; name: string };
type Owner = { id: string; name: string } | null;
type Option = { id: string; name: string };
type Activity = { id?: string; kind: string; occurredOn: string; note: string | null; actor?: { name: string } };
type FinanceEvent = { id: string; kind: "RECHARGE" | "WITHDRAWAL"; amountCents: number; occurredOn: string; continuationNumber: number | null; enteredBy?: Option };
type Customer = {
  id: string; phone: string; customerName: string | null; groupStatus: string; joinedOn: string | null; leftOn: string | null;
  leftNote: string | null; leftWithOrder: boolean; expertIntroducedOn: string | null; expertContactNote: string | null;
  expertWorkflowStage: string | null; registeredOn: string | null; expertNotes: string | null; nextPlan: string | null;
  owner: Owner; attributionOwner: Owner; groupOperatorOwner: Owner; expertOwner: Owner; device: { id: string; code: string } | null;
  batch: { id: string; sourceDate: string; channel: { name: string } };
  order: { id: string; openedOn: string; initialDepositCents: number; enteredBy: Option; rechargeCents: number; withdrawalCents: number; nextContinuationNumber: number; financeEvents: FinanceEvent[] } | null;
  activities: Activity[];
};
type Payload = {
  page: number; pageSize: number; total: number; customers: Customer[]; channels: string[];
  channelOptions: Option[]; memberOptions: Option[]; expertOptions: Option[];
};
type ReportingPayload = { groups: DepartmentCustomerGroup[] };
type ProgressFilter = "全部进度" | "群内维护" | "已推专家" | "已注册" | "已开单" | "已退群";
type FinanceKind = "INITIAL" | "RECHARGE" | "WITHDRAWAL";

const money = (cents = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const expertLabels: Record<string, string> = { QUEUED: "待专家接待", MATERIALS: "已经交资料，等待进一步沟通", TRACKING: "专家跟进中", PENDING_REGISTRATION: "待注册", PENDING_ORDER: "待开单", DECLINED_DEPOSIT: "暂不首充", ORDERED: "已开单，等待客户后续维护", STALLED: "停止维护" };
const progressFilters: ProgressFilter[] = ["全部进度", "群内维护", "已推专家", "已注册", "已开单", "已退群"];

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
  if (customer.registeredOn) return "已注册";
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
    const next = draft.trim(); setEditing(false);
    if (!next || next === value.trim()) { setDraft(value); return; }
    await onSave(next);
  }
  if (editing) return <textarea aria-label={label} className={styles.cellEditor} value={draft} maxLength={300} rows={2} autoFocus onChange={(event) => setDraft(event.target.value)} onBlur={() => void finish()} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void finish(); } }} />;
  return <button type="button" className={styles.editableCell} data-editable={editable} disabled={!editable || saving} onDoubleClick={() => setEditing(true)} title={editable ? `双击修改${label}` : `${label}只读`}><span>{value || "—"}</span>{saving ? <small>保存中…</small> : null}</button>;
}

export function DepartmentCustomerProgress({ groups, member }: { groups?: DepartmentCustomerGroup[]; member?: BackendUser }) {
  const [legacyMode, setLegacyMode] = useState(false);
  const [availableGroups, setAvailableGroups] = useState(groups ?? []);
  const [groupId, setGroupId] = useState(groups?.[0]?.id ?? "");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [page, setPage] = useState(1); const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState(""); const [progress, setProgress] = useState<ProgressFilter>("全部进度");
  const [savingCell, setSavingCell] = useState(""); const [savedMessage, setSavedMessage] = useState("");
  const [adding, setAdding] = useState(false); const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ phone: "", channelId: "", sourceDate: localToday(), joinedOn: localToday() });
  const [finance, setFinance] = useState<{ kind: FinanceKind; customer: Customer } | null>(null);
  const [financeDraft, setFinanceDraft] = useState({ occurredOn: localToday(), amount: "", depositMethod: "CRYPTO" as "CRYPTO" | "BANK" });
  const [savingFinance, setSavingFinance] = useState(false);
  const phoneInput = useRef<HTMLInputElement>(null);
  // 传入 member 代表当前是本组在职成员；管理员不传 member，继续只读。
  const canEdit = Boolean(member);


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
  useEffect(() => { if (adding) phoneInput.current?.focus(); }, [adding]);
  useEffect(() => {
    const refresh = () => setReloadKey((value) => value + 1);
    window.addEventListener("ai-data-updated", refresh);
    return () => window.removeEventListener("ai-data-updated", refresh);
  }, []);

  const customers = useMemo(() => (payload?.customers ?? []).filter((customer) => {
    const haystack = `${customer.phone} ${customer.customerName ?? ""} ${customer.attributionOwner?.name ?? customer.owner?.name ?? ""} ${customer.batch.channel.name} ${customer.groupOperatorOwner?.name ?? ""} ${customer.expertOwner?.name ?? ""} ${latestGroupText(customer)} ${latestExpertText(customer)}`.toLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (progress === "全部进度" || progressOf(customer) === progress);
  }), [payload?.customers, progress, query]);
  const pageCount = Math.max(1, Math.ceil((payload?.total ?? 0) / (payload?.pageSize ?? 50)));
  function showSaved(message: string) { setSavedMessage(message); window.dispatchEvent(new Event("ai-data-updated")); window.setTimeout(() => setSavedMessage(""), 2400); }
  function beginAdd() { const today = localToday(); setAdding(true); setError(""); setDraft({ phone: "", channelId: payload?.channelOptions[0]?.id ?? "", sourceDate: today, joinedOn: today }); }
  async function createCustomer() {
    if (!adding || creating || !draft.phone.trim()) return;
    setCreating(true); setError("");
    try {
      await requestJson("/api/lead/customer-reporting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      setAdding(false); setPage(1); setProgress("全部进度"); showSaved("客户已加入组内共享表"); setReloadKey((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "新增客户失败"); phoneInput.current?.focus(); }
    finally { setCreating(false); }
  }
  async function patchCell(customer: Customer, action: Record<string, unknown>, key: string, message: string) {
    setSavingCell(`${customer.id}:${key}`); setError("");
    try {
      await requestJson(`/api/lead/customer-reporting/${customer.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
      showSaved(message); setReloadKey((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "单元格保存失败"); }
    finally { setSavingCell(""); }
  }
  async function saveSituation(customer: Customer, kind: "group" | "expert", note: string) {
    const key = `${customer.id}:${kind}`; setSavingCell(key); setError("");
    try {
      await requestJson(`/api/leads/${customer.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(kind === "group" ? { action: "updateGroupProgress", progressNote: note, occurredOn: localToday() } : { action: "updateExpertDetails", expertNotes: note, occurredOn: localToday() }) });
      showSaved(`${kind === "group" ? "炒群情况" : "专家情况"}已自动保存`); setReloadKey((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "客户进度保存失败"); }
    finally { setSavingCell(""); }
  }
  function openFinance(kind: FinanceKind, customer: Customer) { setFinance({ kind, customer }); setFinanceDraft({ occurredOn: localToday(), amount: "", depositMethod: "CRYPTO" }); setError(""); }
  async function saveFinance() {
    if (!finance) return;
    const amount = Number(financeDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError("金额必须大于 0"); return; }
    setSavingFinance(true); setError("");
    try {
      if (finance.kind === "INITIAL") {
        await requestJson("/api/customer-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId: finance.customer.batch.id, leadId: finance.customer.id, phone: finance.customer.phone, openedOn: financeDraft.occurredOn, initialDepositCents: Math.round(amount * 100), initialDepositMethod: financeDraft.depositMethod }) });
      } else {
        const order = finance.customer.order;
        if (!order) throw new Error("请先登记首充");
        await requestJson("/api/customer-finance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerOrderId: order.id, occurredOn: financeDraft.occurredOn, kind: finance.kind, amountCents: Math.round(amount * 100), ...(finance.kind === "RECHARGE" ? { depositMethod: financeDraft.depositMethod, continuationNumber: order.nextContinuationNumber } : {}) }) });
      }
      showSaved(finance.kind === "INITIAL" ? "首充已登记" : finance.kind === "RECHARGE" ? "本次续充已登记" : "本次出金已登记");
      setFinance(null); setReloadKey((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "资金记录保存失败"); }
    finally { setSavingFinance(false); }
  }

  if (legacyMode) return <LegacyCustomerImport onBack={() => setLegacyMode(false)} />;

  return <div className={styles.sheetWorkspace}>
    <section className={styles.toolbar}>
      <label className={styles.search}><MagnifyingGlass size={14} /><input aria-label="搜索客户" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索号码、组员、渠道或进度" /></label>
      <span className={styles.toolbarSpacer} />
      {availableGroups.length > 1 ? <select aria-label="查看小组" value={groupId} onChange={(event) => { setGroupId(event.target.value); setPage(1); }}>{availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select> : null}
      {member ? <button type="button" className={styles.legacyButton} disabled={!groupId || loading} onClick={() => setLegacyMode(true)}>老客户导入</button> : null}
      {member ? <button className={styles.addButton} disabled={!groupId || loading || adding} onClick={beginAdd}><Plus size={15} weight="bold" />新增已进群客户</button> : null}
    </section>

    {error ? <div className={styles.error}>{error}</div> : null}
    <section className={styles.sheetCard}>
      <header className={styles.sheetHeader}>
        <div><h2>组内共享客户进度</h2><p>一位客户一行；同组组员和组长都可编辑，修改后自动保存并记录操作人</p></div>
        <nav className={styles.statusFilters} aria-label="按客户状态筛选">
          {progressFilters.map((item) => <button type="button" key={item} data-active={progress === item} aria-pressed={progress === item} onClick={() => setProgress(item)}>{item}</button>)}
        </nav>
        <span><i />实时共享</span>
      </header>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>接粉日期</th><th>进群日期</th><th>客户号码</th><th>归属组员</th><th>来源渠道</th><th>炒群负责人</th><th>设备号</th><th>群内天数</th><th>炒群情况</th><th>退群类型</th><th>退群日期（自动）</th><th>专家负责人</th><th>专家情况</th><th>注册</th><th>注册日期</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th><th>最后修改</th></tr></thead>
          <tbody>
            {adding && member ? <tr className={styles.draftRow}><td><input aria-label="新客户接粉日期" className={styles.dateInput} type="date" value={draft.sourceDate} max={draft.joinedOn} disabled={creating} onChange={(event) => setDraft((value) => ({ ...value, sourceDate: event.target.value }))} /></td><td><input aria-label="新客户进群日期" className={styles.dateInput} type="date" value={draft.joinedOn} min={draft.sourceDate} max={localToday()} disabled={creating} onChange={(event) => setDraft((value) => ({ ...value, joinedOn: event.target.value }))} /></td><td><div className={styles.draftPhone}><input ref={phoneInput} aria-label="新客户号码" value={draft.phone} inputMode="numeric" maxLength={6} placeholder="号码后 6 位" disabled={creating} onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value.replace(/\D/g, "").slice(-6) }))} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createCustomer(); } }} /><button type="button" title="确认新增" disabled={creating || draft.phone.length < 6} onClick={() => void createCustomer()}><Plus size={13} /></button><button type="button" title="取消新增" onClick={() => setAdding(false)}><X size={13} /></button></div></td><td>{member.name}</td><td><select value={draft.channelId} onChange={(event) => setDraft((value) => ({ ...value, channelId: event.target.value }))}>{payload?.channelOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td><td className={styles.draftHint} colSpan={15}>{creating ? "正在保存…" : "完整号码自动保留后 6 位；两个日期默认今天，可自行修改；按回车或点＋保存"}</td></tr> : null}
            {loading ? <tr><td colSpan={20} className={styles.empty}>正在读取组内共享数据…</td></tr> : customers.map((customer) => {
              const attributedOwner = customer.attributionOwner ?? customer.owner;
              const net = (customer.order?.initialDepositCents ?? 0) + (customer.order?.rechargeCents ?? 0) - (customer.order?.withdrawalCents ?? 0);
              const rechargeCount = customer.order?.financeEvents.filter((event) => event.kind === "RECHARGE").length ?? 0;
              const withdrawalCount = customer.order?.financeEvents.filter((event) => event.kind === "WITHDRAWAL").length ?? 0;
              return <tr key={customer.id}>
                <td>{canEdit ? <input key={customer.batch.sourceDate} className={styles.dateInput} type="date" defaultValue={customer.batch.sourceDate} max={customer.joinedOn ?? localToday()} disabled={Boolean(savingCell)} onChange={(event) => event.target.value && event.target.value !== customer.batch.sourceDate && void patchCell(customer, { action: "setSourceDate", occurredOn: event.target.value }, "sourceDate", "接粉日期已保存")} /> : customer.batch.sourceDate}</td>
                <td>{canEdit ? <input key={customer.joinedOn ?? "empty"} className={styles.dateInput} type="date" defaultValue={customer.joinedOn ?? ""} min={customer.batch.sourceDate} max={customer.leftOn ?? localToday()} disabled={Boolean(savingCell)} onChange={(event) => event.target.value && event.target.value !== customer.joinedOn && void patchCell(customer, { action: "setJoinedOn", occurredOn: event.target.value }, "joinedOn", "进群日期已保存")} /> : customer.joinedOn ?? "—"}</td>
                <td className={styles.phone}><strong>{customer.phone}</strong>{customer.customerName?.trim() ? <small>{customer.customerName}</small> : null}</td>
                <td>{canEdit ? <select className={styles.cellSelect} value={attributedOwner?.id ?? ""} disabled={Boolean(savingCell)} onChange={(event) => void patchCell(customer, { action: "setOwner", userId: event.target.value }, "owner", "接粉及业绩归属已保存")}>{payload?.memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : attributedOwner?.name ?? "未分配"}</td>
                <td>{canEdit ? <select className={styles.cellSelect} value={payload?.channelOptions.find((item) => item.name === customer.batch.channel.name)?.id ?? ""} disabled={Boolean(savingCell)} onChange={(event) => void patchCell(customer, { action: "setChannel", channelId: event.target.value }, "channel", "来源渠道已保存")}>{payload?.channelOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : customer.batch.channel.name}</td>
                <td>{canEdit ? <select className={styles.cellSelect} value={customer.groupOperatorOwner?.id ?? ""} disabled={Boolean(savingCell)} onChange={(event) => void patchCell(customer, { action: "assignGroupOperator", userId: event.target.value }, "operator", "炒群负责人已保存")}><option value="" disabled>点击选择</option>{payload?.memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : customer.groupOperatorOwner?.name ?? "待分配"}</td>
                <td>{canEdit ? <input key={customer.device?.code ?? "empty"} className={styles.deviceInput} defaultValue={customer.device?.code ?? ""} maxLength={100} placeholder="手动填写" disabled={Boolean(savingCell)} onBlur={(event) => { const code = event.target.value.trim(); if (code !== (customer.device?.code ?? "")) void patchCell(customer, { action: "setDeviceCode", code }, "device", "设备号已保存"); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /> : customer.device?.code ?? "—"}</td>
                <td className={styles.dayCell}>{daysInGroup(customer.joinedOn, customer.leftOn)}</td>
                <td className={styles.progressCell}><EditableCell label="炒群情况" value={latestGroupText(customer)} editable={canEdit} saving={savingCell === `${customer.id}:group`} onSave={(note) => saveSituation(customer, "group", note)} /></td>
                <td>{canEdit && customer.groupStatus !== "LEFT" ? <select className={styles.cellSelect} value="" disabled={Boolean(savingCell)} onChange={(event) => void patchCell(customer, { action: "setLeave", leaveType: event.target.value, occurredOn: localToday() }, "leave", "退群类型和日期已保存")}><option value="">—</option><option value="NORMAL">正常退群</option><option value="ABNORMAL">异常退群</option></select> : customer.groupStatus === "LEFT" ? (customer.leftWithOrder ? "正常退群" : "异常退群") : "—"}</td>
                <td>{customer.leftOn ?? "—"}</td>
                <td>{canEdit ? <select className={styles.cellSelect} value={customer.expertOwner?.id ?? ""} disabled={Boolean(savingCell)} onChange={(event) => void patchCell(customer, { action: "assignExpert", userId: event.target.value }, "expert", "专家负责人已保存")}><option value="" disabled>点击选择</option>{payload?.expertOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : customer.expertOwner?.name ?? "未分配"}</td>
                <td className={styles.progressCell}><EditableCell label="专家情况" value={latestExpertText(customer)} editable={canEdit} saving={savingCell === `${customer.id}:expert`} onSave={(note) => saveSituation(customer, "expert", note)} /></td>
                <td><span className={styles.registrationStatus} data-registered={Boolean(customer.registeredOn)}>{customer.registeredOn ? "已注册" : "未注册"}</span></td>
                <td>{canEdit ? <input key={customer.registeredOn ?? "empty"} className={styles.dateInput} type="date" defaultValue={customer.registeredOn ?? ""} min={customer.joinedOn ?? undefined} disabled={Boolean(savingCell)} onChange={(event) => event.target.value && void patchCell(customer, { action: "setRegistration", occurredOn: event.target.value }, "registration", "注册日期已保存")} /> : customer.registeredOn ?? "—"}</td>
                <td className={styles.money}>{customer.order ? <button className={styles.financeCell} onClick={() => canEdit && openFinance("INITIAL", customer)} disabled={!canEdit}>{money(customer.order.initialDepositCents)}</button> : <button className={styles.financeAdd} disabled={!canEdit || !customer.registeredOn} title={!customer.registeredOn ? "请先填写注册日期" : "登记首充"} onClick={() => openFinance("INITIAL", customer)}>+ 首充</button>}</td>
                <td className={styles.money}><button className={styles.financeCell} disabled={!canEdit || !customer.order} onClick={() => openFinance("RECHARGE", customer)}>{money(customer.order?.rechargeCents)}{rechargeCount ? <small>{rechargeCount}笔</small> : null}</button></td>
                <td><button className={styles.financeCell} disabled={!canEdit || !customer.order} onClick={() => openFinance("WITHDRAWAL", customer)}>{money(customer.order?.withdrawalCents)}{withdrawalCount ? <small>{withdrawalCount}笔</small> : null}</button></td>
                <td className={styles.net}>{money(net)}</td><td className={styles.updated}>{customer.activities[0]?.actor?.name ?? "系统"}<small>{customer.activities[0]?.occurredOn ?? "—"}</small></td>
              </tr>;
            })}
            {!loading && customers.length === 0 && !adding ? <tr><td colSpan={20} className={styles.empty}>没有符合当前条件的已进群客户</td></tr> : null}
          </tbody>
        </table>
      </div>
      <footer className={styles.footer}><span>共 {payload?.total ?? 0} 位客户 · 双击情况单元格编辑，选择框修改后自动保存</span><div><span>每次修改都记录账号和时间</span><button disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>上一页</button><b>{page} / {pageCount}</b><button disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
    </section>

    {finance ? <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setFinance(null); }}><section className={styles.financeModal}><header><div><h3>{finance.kind === "INITIAL" ? "首充记录" : finance.kind === "RECHARGE" ? "续充明细" : "出金明细"}</h3><p>{finance.customer.phone} · 每笔资金单独记录日期、金额和操作账号</p></div><button type="button" onClick={() => setFinance(null)}><X size={18} /></button></header>{finance.kind === "INITIAL" && finance.customer.order ? <div className={styles.financeHistory}><div><span>{finance.customer.order.openedOn}</span><strong>{money(finance.customer.order.initialDepositCents)}</strong><small>{finance.customer.order.enteredBy?.name ?? "历史记录"}</small></div></div> : finance.kind !== "INITIAL" && finance.customer.order?.financeEvents.filter((event) => event.kind === finance.kind).length ? <div className={styles.financeHistory}>{finance.customer.order.financeEvents.filter((event) => event.kind === finance.kind).map((event) => <div key={event.id}><span>{event.occurredOn}</span><strong>{money(event.amountCents)}</strong><small>{event.enteredBy?.name ?? "历史记录"}</small></div>)}</div> : null}{finance.kind !== "INITIAL" || !finance.customer.order ? <div className={styles.financeForm}><label><span>日期</span><input type="date" value={financeDraft.occurredOn} onChange={(event) => setFinanceDraft((value) => ({ ...value, occurredOn: event.target.value }))} /></label><label><span>金额</span><input type="number" min="0.01" step="0.01" value={financeDraft.amount} autoFocus placeholder="0.00" onChange={(event) => setFinanceDraft((value) => ({ ...value, amount: event.target.value }))} /></label>{finance.kind !== "WITHDRAWAL" ? <label><span>入金方式</span><select value={financeDraft.depositMethod} onChange={(event) => setFinanceDraft((value) => ({ ...value, depositMethod: event.target.value as "CRYPTO" | "BANK" }))}><option value="CRYPTO">加密货币</option><option value="BANK">银行卡</option></select></label> : null}</div> : null}<footer><button type="button" onClick={() => setFinance(null)}>{finance.kind === "INITIAL" && finance.customer.order ? "关闭" : "取消"}</button>{finance.kind !== "INITIAL" || !finance.customer.order ? <button type="button" className={styles.primaryButton} disabled={savingFinance} onClick={() => void saveFinance()}>{savingFinance ? "保存中…" : finance.kind === "INITIAL" ? "确认首充" : finance.kind === "RECHARGE" ? "+ 确认本次续充" : "+ 确认本次出金"}</button> : null}</footer></section></div> : null}
    {savedMessage ? <div className={styles.toast}>{savedMessage}</div> : null}
  </div>;
}
