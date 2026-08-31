"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson, type BackendUser } from "@/lib/backend";
import { localToday } from "@/lib/frontline-workbench";
import styles from "./DepartmentCustomerProgress.module.css";

export type DepartmentCustomerGroup = { id: string; name: string };
type Owner = { id: string; name: string } | null;
type Activity = { kind: string; occurredOn: string; note: string | null };
type Customer = {
  id: string; phone: string; customerName: string | null; groupStatus: string; joinedOn: string | null;
  leftNote: string | null; leftWithOrder: boolean; expertIntroducedOn: string | null; expertContactNote: string | null;
  expertWorkflowStage: string | null; registeredOn: string | null; expertNotes: string | null; nextPlan: string | null; nextFollowUpOn: string | null;
  owner: Owner; groupOperatorOwner: Owner; expertOwner: Owner; device: { id: string; code: string } | null;
  batch: { sourceDate: string; channel: { name: string } };
  order: { initialDepositCents: number; rechargeCents: number; withdrawalCents: number } | null; activities: Activity[];
};
type Payload = {
  page: number; pageSize: number; total: number; customers: Customer[]; channels: string[];
  channelOptions: Array<{ id: string; name: string }>; memberOptions: Array<{ id: string; name: string }>;
  summary: { customerCount: number; orderCount: number; initialDepositCents: number; rechargeCents: number; withdrawalCents: number };
};
type ReportingPayload = { groups: DepartmentCustomerGroup[] };

const expertLabels: Record<string, string> = { QUEUED: "待专家接待", MATERIALS: "准备资料", TRACKING: "专家跟进中", PENDING_REGISTRATION: "待注册", PENDING_ORDER: "待开单", DECLINED_DEPOSIT: "暂不首充", ORDERED: "已开单", STALLED: "停止维护" };
const activityLabels: Record<string, string> = { JOINED_GROUP: "客户已进群", LEFT_GROUP: "客户已退群", GROUP_PROGRESS_UPDATED: "炒群情况已更新", EXPERT_INTRODUCED: "已推送专家", EXPERT_CONTACTED: "专家已接待", REGISTERED: "客户已注册", PLAN_UPDATED: "跟进计划已更新" };
const money = (cents = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
function latestText(customer: Customer) { const item = customer.activities[0]; return item ? item.note?.trim() || activityLabels[item.kind] || "客户进度已更新" : "暂无跟进记录"; }
function latestGroupText(customer: Customer) { return customer.activities.find((item) => item.kind === "GROUP_PROGRESS_UPDATED")?.note?.trim() || customer.leftNote || (customer.expertIntroducedOn ? "已推专家" : "暂无炒群记录"); }

function EditableSituation({ label, value, editable, saving, onSave }: { label: string; value: string; editable: boolean; saving: boolean; onSave: (value: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (!editing) setDraft(value); }, [editing, value]);

  async function finish() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === value.trim()) { setDraft(value); return; }
    await onSave(next);
  }

  if (editing) return <textarea className={styles.cellEditor} aria-label={label} value={draft} maxLength={300} rows={2} autoFocus onChange={(event) => setDraft(event.target.value)} onBlur={() => void finish()} />;
  return <button type="button" className={styles.situationCell} data-editable={editable} disabled={!editable || saving} onClick={() => setEditing(true)} title={editable ? `点击填写${label}` : `${label}仅当前负责人或组长可修改`}><span>{value || "暂无记录"}</span><small>{saving ? "保存中…" : editable ? "点击填写" : "只读"}</small></button>;
}

export function DepartmentCustomerProgress({ groups, member }: { groups?: DepartmentCustomerGroup[]; member?: BackendUser }) {
  const [availableGroups, setAvailableGroups] = useState(groups ?? []);
  const [groupId, setGroupId] = useState(groups?.[0]?.id ?? "");
  const [page, setPage] = useState(1); const [channel, setChannel] = useState("");
  const [draftQuery, setDraftQuery] = useState(""); const [query, setQuery] = useState("");
  const [payload, setPayload] = useState<Payload | null>(null); const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""); const [reloadKey, setReloadKey] = useState(0);
  const [savingCell, setSavingCell] = useState("");
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
    const params = new URLSearchParams({ groupId, stage: "group", page: String(page) }); if (query) params.set("q", query);
    if (channel) params.set("channel", channel);
    void requestJson<Payload>(`/api/lead/customer-reporting?${params}`).then((result) => { if (!cancelled) setPayload(result); }).catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "客户进度读取失败"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [groupId, page, query, channel, reloadKey]);

  const selectedGroup = useMemo(() => availableGroups.find((group) => group.id === groupId), [availableGroups, groupId]);
  const channels = payload?.channels ?? [];
  const customers = payload?.customers ?? [];
  const totals = payload?.summary ?? { customerCount: 0, orderCount: 0, initialDepositCents: 0, rechargeCents: 0, withdrawalCents: 0 };
  const pageCount = Math.max(1, Math.ceil((payload?.total ?? 0) / (payload?.pageSize ?? 50)));
  function submitSearch(event: FormEvent) { event.preventDefault(); setPage(1); setQuery(draftQuery.trim()); }
  async function saveSituation(customer: Customer, kind: "group" | "expert", note: string) {
    const key = `${customer.id}:${kind}`; setSavingCell(key); setError("");
    try {
      await requestJson(`/api/leads/${customer.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(kind === "group" ? { action: "updateGroupProgress", progressNote: note, occurredOn: localToday() } : { action: "updateExpertDetails", expertNotes: note, occurredOn: localToday() }) });
      setReloadKey((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "客户进度保存失败"); throw caught; }
    finally { setSavingCell(""); }
  }
  async function createCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreating(true); setError("");
    try {
      await requestJson("/api/lead/customer-reporting", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      setAdding(false); setDraft({ phone: "", customerName: "", channelId: "", joinedOn: localToday(), deviceCode: "", attributionOwnerId: member?.id ?? "" });
      setPage(1); setReloadKey((value) => value + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "新增客户失败"); }
    finally { setCreating(false); }
  }

  return <div className={styles.workspace}>
    <section className={styles.toolbar}>
      <div className={styles.intro}><strong>组内共享客户进度表</strong><span>只显示已经进过群的客户；一位客户一行，炒群和专家在各自负责列继续填写</span></div>
      <label className={styles.field}><span>查看小组</span><select aria-label="查看小组" disabled={loading} value={groupId} onChange={(event) => { setGroupId(event.target.value); setChannel(""); setPage(1); }}><option value="">请选择小组</option>{availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label className={styles.field}><span>来源渠道</span><select aria-label="来源渠道" disabled={loading} value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1); }}><option value="">全部渠道</option>{channels.map((name) => <option key={name}>{name}</option>)}</select></label>
      <form className={`${styles.field} ${styles.search}`} aria-busy={loading} onSubmit={submitSearch}><label className={styles.field}><span>搜索客户</span><input aria-label="搜索客户" value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="输入号码或客户姓名" /></label><button className={styles.primary} disabled={!groupId || loading}>{loading ? "查询中…" : "搜索"}</button>{query ? <button type="button" className={styles.secondary} disabled={loading} onClick={() => { setDraftQuery(""); setQuery(""); setPage(1); }}>清除</button> : null}</form>
      {member ? <button className={styles.primary} disabled={!groupId || loading} onClick={() => { setAdding((value) => !value); setDraft((value) => ({ ...value, channelId: value.channelId || payload?.channelOptions[0]?.id || "", attributionOwnerId: value.attributionOwnerId || member.id })); }}>＋ 新增一行</button> : null}
      <button className={styles.secondary} disabled={!groupId || loading} onClick={() => setReloadKey((value) => value + 1)}>{loading ? "刷新中…" : "刷新"}</button>
    </section>
    {adding && member ? <form className={styles.addRow} onSubmit={createCustomer}>
      <div><strong>新增已进群客户</strong><span>一位客户一行，保存后立即进入组内共享表</span></div>
      <label><span>客户号码 *</span><input value={draft.phone} onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value }))} placeholder="填写客户号码" required /></label>
      <label><span>客户姓名</span><input value={draft.customerName} onChange={(event) => setDraft((value) => ({ ...value, customerName: event.target.value }))} placeholder="可不填" /></label>
      <label><span>来源渠道 *</span><select value={draft.channelId} onChange={(event) => setDraft((value) => ({ ...value, channelId: event.target.value }))} required><option value="">请选择渠道</option>{payload?.channelOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>进群日期 *</span><input type="date" value={draft.joinedOn} onChange={(event) => setDraft((value) => ({ ...value, joinedOn: event.target.value }))} required /></label>
      <label><span>设备号</span><input value={draft.deviceCode} onChange={(event) => setDraft((value) => ({ ...value, deviceCode: event.target.value }))} placeholder="可不填" /></label>
      <label><span>接粉归属 *</span><select value={draft.attributionOwnerId} onChange={(event) => setDraft((value) => ({ ...value, attributionOwnerId: event.target.value }))} required>{payload?.memberOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className={styles.addActions}><button type="button" className={styles.secondary} onClick={() => setAdding(false)}>取消</button><button className={styles.primary} disabled={creating}>{creating ? "保存中…" : "保存到共享表"}</button></div>
    </form> : null}
    <section className={styles.summary}><article><span>进群客户</span><strong>{totals.customerCount}</strong></article><article><span>已开单</span><strong>{totals.orderCount}</strong></article><article><span>首充</span><strong>{money(totals.initialDepositCents)}</strong></article><article><span>续充</span><strong>{money(totals.rechargeCents)}</strong></article><article><span>净业绩</span><strong>{money(totals.initialDepositCents + totals.rechargeCents - totals.withdrawalCents)}</strong></article></section>
    {error ? <div className={styles.error}>{error}</div> : null}
    {groupId ? <section className={styles.card}><div className={styles.head}><div><h2>{selectedGroup?.name ?? "所选小组"} · 已进群客户共享表</h2><p>接粉归属、设备号、炒群情况、专家情况和资金结果全部放在同一行</p></div><span className={styles.readonly}>{member ? "组内共享 · 分栏填写" : "管理账号只读"}</span></div>
      {loading ? <div className={styles.empty}>正在读取客户进度…</div> : !error && customers.length === 0 ? <div className={styles.empty}><strong>没有符合条件的进群客户</strong><span>{query || channel ? "可以清除筛选后重新查看。" : "该小组还没有已经进群的客户明细。"}</span></div> : !error ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>#</th><th>客户号码／姓名</th><th>设备号</th><th>进群日期</th><th>来源渠道</th><th>接粉归属</th><th>炒群负责人</th><th>炒群情况</th><th>专家负责人</th><th>专家情况</th><th>注册日期</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th><th>最后更新</th></tr></thead><tbody>{customers.map((customer, index) => { const net = (customer.order?.initialDepositCents ?? 0) + (customer.order?.rechargeCents ?? 0) - (customer.order?.withdrawalCents ?? 0); const isLead = Boolean(member?.roles.includes("LEAD")); const canEditGroup = Boolean(member && (isLead || customer.groupOperatorOwner?.id === member.id)); const canEditExpert = Boolean(member && (isLead || customer.expertOwner?.id === member.id)); return <tr key={customer.id}><td>{(page - 1) * (payload?.pageSize ?? 50) + index + 1}</td><td><div className={styles.customer}><strong>{customer.phone}</strong><small>{customer.customerName?.trim() || "未填写姓名"}</small></div></td><td>{customer.device?.code ?? "—"}</td><td>{customer.joinedOn ?? "—"}</td><td>{customer.batch.channel.name}</td><td>{customer.owner?.name ?? "未分配"}</td><td>{customer.groupOperatorOwner?.name ?? "待分配"}</td><td className={styles.situation}><EditableSituation label="炒群情况" value={latestGroupText(customer)} editable={canEditGroup} saving={savingCell === `${customer.id}:group`} onSave={(note) => saveSituation(customer, "group", note)} /></td><td>{customer.expertOwner?.name ?? "待分配"}</td><td className={styles.situation}><EditableSituation label="专家情况" value={customer.expertNotes?.trim() || customer.nextPlan || customer.expertContactNote || (customer.expertIntroducedOn ? (expertLabels[customer.expertWorkflowStage ?? ""] ?? "专家跟进中") : "尚未推专家")} editable={canEditExpert} saving={savingCell === `${customer.id}:expert`} onSave={(note) => saveSituation(customer, "expert", note)} /></td><td>{customer.registeredOn ?? "—"}</td><td className={styles.money}>{money(customer.order?.initialDepositCents)}</td><td className={styles.money}>{money(customer.order?.rechargeCents)}</td><td>{money(customer.order?.withdrawalCents)}</td><td className={styles.money}>{money(net)}</td><td><div className={styles.latest}>{latestText(customer)}</div><span className={styles.subtle}>{customer.activities[0]?.occurredOn ?? "—"}</span></td></tr>; })}</tbody></table></div> : null}
      <footer className={styles.foot}><span>共 {payload?.total ?? 0} 位进群客户 · 当前显示 {customers.length} 位 · 第 {payload?.page ?? page} / {pageCount} 页</span><div className={styles.pages}><button disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button disabled={loading || page >= pageCount} onClick={() => setPage((value) => value + 1)}>下一页</button></div></footer>
    </section> : <section className={`${styles.card} ${styles.empty}`}><strong>暂无可查看的小组</strong></section>}
  </div>;
}
