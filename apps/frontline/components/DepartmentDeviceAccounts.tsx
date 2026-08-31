"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import styles from "./DepartmentOperations.module.css";

type Member = { id: string; name: string };
type Group = { id: string; name: string; members: Member[] };
type Device = { id: string; code: string; active: boolean; group: { id: string; name: string }; member: Member | null };
type Account = { id: string; accountType: "NORMAL_WS" | "BUSINESS_WS" | "RCS" | "SIG"; provider: string; accountNumber: string; renewalDate: string | null; purpose: string | null; situation: string | null; phoneCode: string | null; group: { id: string; name: string }; owner: Member };
type Payload = { groups: Group[]; devices: Device[]; accounts: Account[] };
const TYPE = { NORMAL_WS: "普通 WS", BUSINESS_WS: "商业 WS", RCS: "RCS", SIG: "SIG" } as const;

export default function DepartmentDeviceAccounts() {
  const [data, setData] = useState<Payload>({ groups: [], devices: [], accounts: [] });
  const [groupId, setGroupId] = useState("");
  const [tab, setTab] = useState<"devices" | "accounts">("devices");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ groupId: "", code: "" });
  const [assigning, setAssigning] = useState<Device | null>(null);
  const [memberId, setMemberId] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { setData(await requestJson<Payload>("/api/org/department-assets")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "设备账号读取失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const devices = useMemo(() => data.devices.filter((item) => !groupId || item.group.id === groupId), [data.devices, groupId]);
  const accounts = useMemo(() => data.accounts.filter((item) => !groupId || item.group.id === groupId), [data.accounts, groupId]);
  const assignGroup = assigning ? data.groups.find((group) => group.id === assigning.group.id) : null;
  function showNotice(value: string) { setNotice(value); window.setTimeout(() => setNotice(""), 3500); }
  async function createDevice(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await requestJson("/api/org/department-assets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) }); setCreating(false); showNotice("设备已新增到指定小组"); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "新增设备失败"); }
    finally { setBusy(false); }
  }
  async function assign() {
    if (!assigning) return; setBusy(true); setError("");
    try { await requestJson("/api/org/department-assets", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: assigning.id, memberId: memberId || null }) }); setAssigning(null); showNotice(memberId ? "设备分配已更新" : "设备已收回为空闲"); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "设备分配失败"); }
    finally { setBusy(false); }
  }
  return <div className={styles.page}>
    {notice ? <div className={styles.success}>{notice}</div> : null}{error ? <div className={styles.error}>{error}</div> : null}
    <section className={`fresh-sheet-card ${styles.panel}`}><div className={styles.filters}><span className={styles.note}>筛选小组</span><select aria-label="筛选设备所属小组" value={groupId} onChange={(event) => setGroupId(event.target.value)}><option value="">全部小组</option>{data.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><span className={styles.badge}>设备 {devices.length} 台</span><span className={styles.badge}>账号 {accounts.length} 个</span><button style={{ marginLeft: "auto" }} disabled={loading} onClick={() => void load()}>刷新</button></div></section>
    <div className={styles.tabs}><button data-active={tab === "devices"} aria-pressed={tab === "devices"} onClick={() => setTab("devices")}>实体设备</button><button data-active={tab === "accounts"} aria-pressed={tab === "accounts"} onClick={() => setTab("accounts")}>聊天账号</button></div>
    {tab === "devices" ? <section className="fresh-sheet-card"><div className={`fresh-sheet-title ${styles.panelHead}`}><div><h2>本部门实体设备</h2><p>部门管理员可新增、分配和收回；人员跨组时设备会自动跟随。</p></div><button className={styles.action} data-primary="true" disabled={!data.groups.length} onClick={() => { setDraft({ groupId: groupId || data.groups[0]?.id || "", code: "" }); setCreating(true); setError(""); }}>＋ 新增设备</button></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>小组</th><th>设备编号</th><th>当前使用人</th><th>状态</th><th>操作</th></tr></thead><tbody>{loading ? <tr><td colSpan={5}>正在读取设备…</td></tr> : devices.map((device) => <tr key={device.id}><td>{device.group.name}</td><td><strong>{device.code}</strong></td><td>{device.member?.name ?? "—"}</td><td><span className={styles.badge} data-active={Boolean(device.member)}>{device.member ? "在用" : "空闲"}</span></td><td><button className={styles.rowAction} onClick={() => { setAssigning(device); setMemberId(device.member?.id ?? ""); setError(""); }}>{device.member ? "调整/收回" : "分配"}</button></td></tr>)}{!loading && !devices.length ? <tr><td colSpan={5}>当前筛选范围暂无设备</td></tr> : null}</tbody></table></div></section> : <section className="fresh-sheet-card"><div className={`fresh-sheet-title ${styles.panelHead}`}><div><h2>本部门聊天账号</h2><p>这里集中查看；账号内容由账号本人或所在组组长维护，防止误改。</p></div></div><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>小组</th><th>账号类型</th><th>账号平台/号商</th><th>号码</th><th>归属人</th><th>机号</th><th>用途</th><th>当前情况</th><th>续费日期</th></tr></thead><tbody>{loading ? <tr><td colSpan={9}>正在读取账号…</td></tr> : accounts.map((account) => <tr key={account.id}><td>{account.group.name}</td><td>{TYPE[account.accountType]}</td><td>{account.provider}</td><td><strong>{account.accountNumber}</strong></td><td>{account.owner.name}</td><td>{account.phoneCode ?? "—"}</td><td>{account.purpose ?? "—"}</td><td>{account.situation ?? "—"}</td><td>{account.renewalDate ?? "—"}</td></tr>)}{!loading && !accounts.length ? <tr><td colSpan={9}>当前筛选范围暂无聊天账号</td></tr> : null}</tbody></table></div></section>}
    {creating ? <div className={styles.modalBack} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreating(false); }}><section className={styles.modal}><h2>新增实体设备</h2><form className={styles.form} onSubmit={createDevice}><label>所属小组<select value={draft.groupId} onChange={(event) => setDraft({ ...draft, groupId: event.target.value })} required>{data.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label><label>设备编号<input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} required autoFocus /></label>{error ? <div className={styles.error}>{error}</div> : null}<div className={styles.formActions}><button type="button" className={styles.action} onClick={() => setCreating(false)}>取消</button><button className={styles.action} data-primary="true" disabled={busy}>{busy ? "保存中…" : "确认新增"}</button></div></form></section></div> : null}
    {assigning ? <div className={styles.modalBack} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setAssigning(null); }}><section className={styles.modal}><h2>分配设备 · {assigning.code}</h2><div className={styles.form}><label>使用人<select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">收回并设为空闲</option>{assignGroup?.members.map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label><span className={styles.note}>只能选择设备所在小组的在职成员。</span>{error ? <div className={styles.error}>{error}</div> : null}<div className={styles.formActions}><button className={styles.action} onClick={() => setAssigning(null)}>取消</button><button className={styles.action} data-primary="true" disabled={busy} onClick={() => void assign()}>保存分配</button></div></div></section></div> : null}
  </div>;
}
