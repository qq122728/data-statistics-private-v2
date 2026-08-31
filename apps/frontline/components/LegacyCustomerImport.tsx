"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { requestJson } from "@/lib/backend";
import { localToday } from "@/lib/frontline-workbench";
import styles from "./LegacyCustomerImport.module.css";

type EditableField = "joinedOn" | "phone" | "attributionMemberName" | "sourceChannelName" | "groupOperatorName" | "deviceCode" | "groupSituation" | "leaveType" | "expertName" | "expertSituation" | "registeredOn" | "initialDeposit" | "recharge" | "withdrawal";
type LegacyRow = {
  id: string;
  joinedOn: string | null;
  phone: string;
  attributionMemberName: string;
  sourceChannelName: string;
  groupOperatorName: string;
  deviceCode: string;
  groupSituation: string;
  leaveType: string;
  leftOn: string | null;
  expertName: string;
  expertSituation: string;
  registeredOn: string | null;
  initialDeposit: string;
  recharge: string;
  withdrawal: string;
  netPerformanceCents: number;
  updatedAt: string;
};
type ChannelOption = { id: string; name: string };

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(cents / 100);

function daysInGroup(joinedOn: string | null, leftOn: string | null) {
  if (!joinedOn) return "—";
  const start = Date.parse(`${joinedOn}T00:00:00Z`);
  const end = Date.parse(`${leftOn || localToday()}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";
  return `第${Math.max(1, Math.floor((end - start) / 86_400_000) + 1)}天`;
}

function FreeInput({ label, value, field, rowId, saving, multiline, moneyField, focusRef, onDraft, onSave }: {
  label: string; value: string; field: EditableField; rowId: string; saving: boolean; multiline?: boolean; moneyField?: boolean;
  focusRef?: React.RefObject<HTMLInputElement | null>;
  onDraft: (value: string) => void; onSave: (value: string) => Promise<void>;
}) {
  const original = useRef(value);
  useEffect(() => { original.current = value; }, [value]);
  async function finish() { if (value !== original.current) await onSave(value); }
  if (multiline) return <textarea aria-label={label} value={value} rows={2} maxLength={500} disabled={saving} onChange={(event) => onDraft(event.target.value)} onBlur={() => void finish()} />;
  return <input ref={focusRef} aria-label={label} value={value} maxLength={moneyField ? 30 : 80} inputMode={moneyField ? "decimal" : undefined} placeholder={field === "joinedOn" || field === "registeredOn" ? "YYYY-MM-DD" : "点击填写"} disabled={saving} onChange={(event) => onDraft(event.target.value)} onBlur={() => void finish()} onKeyDown={(event) => { if (event.key === "Enter") { event.currentTarget.blur(); } }} />;
}

export function LegacyCustomerImport({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<LegacyRow[]>([]);
  const [channelOptions, setChannelOptions] = useState<ChannelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const newRowInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void requestJson<{ rows: LegacyRow[]; channelOptions: ChannelOption[] }>("/api/legacy-customer-rows")
      .then((result) => { if (!cancelled) { setRows(result.rows); setChannelOptions(result.channelOptions); } })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "老客户表读取失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => `${row.phone} ${row.attributionMemberName} ${row.sourceChannelName} ${row.groupOperatorName} ${row.deviceCode} ${row.groupSituation} ${row.expertName} ${row.expertSituation}`.toLowerCase().includes(needle));
  }, [query, rows]);

  function flash(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 2200); }
  function updateDraft(rowId: string, field: EditableField, value: string) {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, [field]: value } : row));
  }
  async function saveField(rowId: string, field: EditableField, value: string) {
    const key = `${rowId}:${field}`; setSaving(key); setError("");
    try {
      const result = await requestJson<{ row: LegacyRow }>(`/api/legacy-customer-rows/${rowId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ [field]: value }) });
      setRows((current) => current.map((row) => row.id === rowId ? result.row : row));
      flash(`${field === "leaveType" ? "退群日期已自动记录，" : ""}已自动保存`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      const fresh = await requestJson<{ rows: LegacyRow[]; channelOptions: ChannelOption[] }>("/api/legacy-customer-rows").catch(() => null);
      if (fresh) { setRows(fresh.rows); setChannelOptions(fresh.channelOptions); }
    } finally { setSaving(""); }
  }
  async function addRow() {
    if (creating) return;
    setCreating(true); setError(""); setQuery("");
    try {
      const result = await requestJson<{ row: LegacyRow }>("/api/legacy-customer-rows", { method: "POST" });
      setRows((current) => [...current, result.row]);
      flash("已增加一行，请直接填写");
      window.setTimeout(() => newRowInput.current?.focus(), 0);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "添加失败"); }
    finally { setCreating(false); }
  }

  const input = (row: LegacyRow, field: EditableField, label: string, options?: { multiline?: boolean; moneyField?: boolean; focus?: boolean }) => (
    <FreeInput label={label} value={String(row[field] ?? "")} field={field} rowId={row.id} saving={saving === `${row.id}:${field}`} multiline={options?.multiline} moneyField={options?.moneyField} focusRef={options?.focus && row.id === rows.at(-1)?.id ? newRowInput : undefined} onDraft={(value) => updateDraft(row.id, field, value)} onSave={(value) => saveField(row.id, field, value)} />
  );

  return <div className={styles.workspace}>
    <section className={styles.toolbar}>
      <button type="button" className={styles.back} onClick={onBack}><ArrowLeft size={16} />返回新客户进度</button>
      <label className={styles.search}><MagnifyingGlass size={14} /><input aria-label="搜索老客户" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索号码、组员、渠道或负责人" /></label>
      <button type="button" className={styles.add} disabled={creating || loading} onClick={() => void addRow()}><Plus size={15} weight="bold" />{creating ? "添加中…" : "添加一行"}</button>
    </section>
    {error ? <div className={styles.error}>{error}</div> : null}
    <section className={styles.card}>
      <header><div><h2>老客户导入</h2><p>老客户与新客户分开记录；双击不用，直接点击格子填写，离开格子自动保存</p></div><span><i />组内实时共享</span></header>
      <div className={styles.tableWrap}>
        <table>
          <thead><tr><th>进群日期</th><th>客户号码</th><th>归属组员</th><th>来源渠道</th><th>炒群负责人</th><th>设备号</th><th>群内天数</th><th>炒群情况</th><th>退群类型</th><th>退群日期（自动）</th><th>专家负责人</th><th>专家情况</th><th>注册日期</th><th>首充</th><th>续充</th><th>出金</th><th>净业绩</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={17} className={styles.empty}>正在读取老客户共享表…</td></tr> : visibleRows.map((row) => <tr key={row.id}>
              <td>{input(row, "joinedOn", "进群日期", { focus: true })}</td>
              <td>{input(row, "phone", "客户号码")}</td>
              <td>{input(row, "attributionMemberName", "归属组员")}</td>
              <td><select aria-label="来源渠道" value={row.sourceChannelName} disabled={saving === `${row.id}:sourceChannelName`} onChange={(event) => { const value = event.target.value; updateDraft(row.id, "sourceChannelName", value); void saveField(row.id, "sourceChannelName", value); }}><option value="">请选择渠道</option>{row.sourceChannelName && !channelOptions.some((option) => option.name === row.sourceChannelName) ? <option value={row.sourceChannelName}>{row.sourceChannelName}（历史）</option> : null}{channelOptions.map((option) => <option key={option.id} value={option.name}>{option.name}</option>)}</select></td>
              <td>{input(row, "groupOperatorName", "炒群负责人")}</td>
              <td>{input(row, "deviceCode", "设备号")}</td>
              <td className={styles.derived}>{daysInGroup(row.joinedOn, row.leftOn)}</td>
              <td>{input(row, "groupSituation", "炒群情况", { multiline: true })}</td>
              <td>{input(row, "leaveType", "退群类型")}</td>
              <td className={styles.derived}>{row.leftOn || "—"}</td>
              <td>{input(row, "expertName", "专家负责人")}</td>
              <td>{input(row, "expertSituation", "专家情况", { multiline: true })}</td>
              <td>{input(row, "registeredOn", "注册日期")}</td>
              <td>{input(row, "initialDeposit", "首充", { moneyField: true })}</td>
              <td>{input(row, "recharge", "续充", { moneyField: true })}</td>
              <td>{input(row, "withdrawal", "出金", { moneyField: true })}</td>
              <td className={styles.net}>{money(row.netPerformanceCents)}</td>
            </tr>)}
            {!loading && visibleRows.length === 0 ? <tr><td colSpan={17} className={styles.empty}>{rows.length ? "没有符合搜索条件的老客户" : "还没有老客户，点击右上角“添加一行”开始填写"}</td></tr> : null}
          </tbody>
        </table>
      </div>
      <footer><span>共 {visibleRows.length} 行</span><span>群内天数、退群日期和净业绩由系统自动计算</span></footer>
    </section>
    {notice ? <div className={styles.notice}>{notice}</div> : null}
  </div>;
}
