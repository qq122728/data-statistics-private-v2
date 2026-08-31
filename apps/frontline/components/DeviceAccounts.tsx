"use client";

import { useEffect, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import { IconPlus } from "./Icons";

type AccountType = "NORMAL_WS" | "BUSINESS_WS" | "RCS";
type Account = {
  id: string; accountType: AccountType; provider: string; accountNumber: string; renewalDate: string | null;
  purpose: string | null; situation: string | null; phoneCode: string | null; followUp: string | null;
  owner: { id: string; name: string; role: string };
};
type Draft = { accountType: AccountType; provider: string; accountNumber: string; renewalDate: string; purpose: string; situation: string; phoneCode: string; followUp: string };
const EMPTY: Draft = { accountType: "NORMAL_WS", provider: "", accountNumber: "", renewalDate: "", purpose: "", situation: "", phoneCode: "", followUp: "" };
const TYPE_LABEL: Record<AccountType, string> = { NORMAL_WS: "普通 WS", BUSINESS_WS: "商业 WS", RCS: "RCS" };

export function DeviceAccounts() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { setAccounts((await requestJson<{ accounts: Account[] }>("/api/device-accounts")).accounts); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "设备账号加载失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function edit(account: Account) {
    setEditingId(account.id);
    setDraft({ accountType: account.accountType, provider: account.provider, accountNumber: account.accountNumber, renewalDate: account.renewalDate ?? "", purpose: account.purpose ?? "", situation: account.situation ?? "", phoneCode: account.phoneCode ?? "", followUp: account.followUp ?? "" });
    setError(""); setSuccess("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setSuccess("");
    try {
      await requestJson("/api/device-accounts", {
        method: editingId ? "PATCH" : "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(editingId ? { id: editingId } : {}), ...draft, renewalDate: draft.renewalDate || null, purpose: draft.purpose || null, situation: draft.situation || null, phoneCode: draft.phoneCode || null, followUp: draft.followUp || null }),
      });
      setSuccess(editingId ? "设备账号已保存" : "设备账号已添加");
      setEditingId(null); setDraft(EMPTY); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function remove(account: Account) {
    if (!window.confirm(`确认删除设备账号 ${account.accountNumber}？`)) return;
    setBusy(true); setError("");
    try { await requestJson("/api/device-accounts", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: account.id }) }); await load(); setSuccess("设备账号已删除"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "删除失败"); }
    finally { setBusy(false); }
  }

  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <form className="card" onSubmit={submit}>
      <div className="card-head"><div><h2 className="card-title">设备账号</h2><p className="card-note">这里已经连接真实设备账号库。普通岗位只能维护自己的账号；组长可在管理端维护全组账号。</p></div><span className="badge" data-tone="ok">真实数据</span></div>
      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 10 }}>
        <label><span className="label">账号类型</span><select className="field" style={{ width: "100%" }} value={draft.accountType} onChange={(event) => setDraft((value) => ({ ...value, accountType: event.target.value as AccountType }))}>{Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span className="label">号商 *</span><input className="field" style={{ width: "100%" }} value={draft.provider} onChange={(event) => setDraft((value) => ({ ...value, provider: event.target.value }))} required /></label>
        <label><span className="label">账号号码 *</span><input className="field" style={{ width: "100%" }} value={draft.accountNumber} onChange={(event) => setDraft((value) => ({ ...value, accountNumber: event.target.value }))} required /></label>
        <label><span className="label">续费日期</span><input className="field" type="date" style={{ width: "100%" }} value={draft.renewalDate} onChange={(event) => setDraft((value) => ({ ...value, renewalDate: event.target.value }))} /></label>
        <label><span className="label">用途</span><input className="field" style={{ width: "100%" }} value={draft.purpose} onChange={(event) => setDraft((value) => ({ ...value, purpose: event.target.value }))} /></label>
        <label><span className="label">当前情况</span><input className="field" style={{ width: "100%" }} value={draft.situation} onChange={(event) => setDraft((value) => ({ ...value, situation: event.target.value }))} /></label>
        <label><span className="label">手机编号</span><input className="field" style={{ width: "100%" }} value={draft.phoneCode} onChange={(event) => setDraft((value) => ({ ...value, phoneCode: event.target.value }))} /></label>
        <label><span className="label">跟进备注</span><input className="field" style={{ width: "100%" }} value={draft.followUp} onChange={(event) => setDraft((value) => ({ ...value, followUp: event.target.value }))} /></label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "0 16px 16px" }}>{editingId ? <button type="button" className="btn" onClick={() => { setEditingId(null); setDraft(EMPTY); }}>取消编辑</button> : null}<button className="btn" data-variant="primary" data-confirm-action={editingId ? "保存设备账号修改" : "添加设备账号"} disabled={busy}><IconPlus size={15} />{busy ? "正在保存…" : editingId ? "保存修改" : "添加设备账号"}</button></div>
    </form>
    {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error}</div> : null}
    {success ? <div className="card" role="status" style={{ padding: 14, color: "var(--ok)", borderColor: "var(--ok-line)" }}>{success}</div> : null}
    <div className="card" style={{ overflow: "hidden" }}><div className="table-scroll"><table className="grid-table"><thead><tr><th>账号</th><th>归属</th><th>号商</th><th>用途 / 情况</th><th>续费日期</th><th>手机编号</th><th>跟进备注</th><th>操作</th></tr></thead><tbody>
      {loading && !accounts.length ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 30 }}>正在读取真实设备账号…</td></tr> : null}
      {!loading && !accounts.length ? <tr><td colSpan={8} style={{ textAlign: "center", padding: 30, color: "var(--ink-3)" }}>还没有设备账号。</td></tr> : null}
      {accounts.map((account) => <tr key={account.id}><td><strong>{account.accountNumber}</strong><div className="muted">{TYPE_LABEL[account.accountType]}</div></td><td>{account.owner.name}</td><td>{account.provider}</td><td>{account.purpose || "—"}<div className="muted">{account.situation || "未填写情况"}</div></td><td>{account.renewalDate || "—"}</td><td>{account.phoneCode || "—"}</td><td>{account.followUp || "—"}</td><td><div style={{ display: "flex", gap: 7 }}><button className="btn" data-size="sm" onClick={() => edit(account)}>编辑</button><button className="btn" data-size="sm" disabled={busy} onClick={() => void remove(account)}>删除</button></div></td></tr>)}
    </tbody></table></div></div>
  </div>;
}
