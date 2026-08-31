"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import { IconCheck, IconPlus } from "./Icons";
import { Modal } from "./Modal";

type AccountType = "NORMAL_WS" | "BUSINESS_WS" | "RCS";
type Member = { id: string; name: string; active: boolean; positions?: string[] };
type Device = { id: string; code: string; active: boolean; member: { id: string; name: string } | null };
type Account = { id: string; accountType: AccountType; provider: string; accountNumber: string; renewalDate: string | null; purpose: string | null; situation: string | null; phoneCode: string | null; followUp: string | null; owner: { id: string; name: string } };
type Draft = { ownerId: string; accountType: AccountType; provider: string; accountNumber: string; renewalDate: string; purpose: string; situation: string; phoneCode: string; followUp: string };
const EMPTY: Draft = { ownerId: "", accountType: "NORMAL_WS", provider: "", accountNumber: "", renewalDate: "", purpose: "", situation: "", phoneCode: "", followUp: "" };
const LABEL: Record<AccountType, string> = { NORMAL_WS: "普通 WS", BUSINESS_WS: "商业 WS", RCS: "RCS" };

export function RealGroupDeviceManagement({ members }: { members: Member[] }) {
  const [sub, setSub] = useState<"device" | "chat">("device");
  const [devices, setDevices] = useState<Device[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [deviceCode, setDeviceCode] = useState("");
  const [assignDevice, setAssignDevice] = useState<Device | null>(null);
  const [assignMemberId, setAssignMemberId] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const activeMembers = members.filter((member) => member.active);
  const receptions = useMemo(() => activeMembers.filter((member) => !member.positions?.length || member.positions.includes("RECEPTION")), [activeMembers]);
  const chatEligible = useMemo(() => activeMembers.filter((member) => !member.positions?.length || member.positions.some((position) => position === "GROUP_OPERATOR" || position === "EXPERT" || position === "LEAD")), [activeMembers]);

  async function load() {
    setLoading(true); setError("");
    try {
      const [deviceData, accountData] = await Promise.all([
        requestJson<{ devices: Device[] }>("/api/group-devices"),
        requestJson<{ accounts: Account[] }>("/api/device-accounts"),
      ]);
      setDevices(deviceData.devices); setAccounts(accountData.accounts);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "设备账号加载失败"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function createDevice(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await requestJson("/api/group-devices", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: deviceCode }) });
      setDeviceOpen(false); setDeviceCode(""); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "新增设备失败"); }
    finally { setBusy(false); }
  }

  async function saveAssignment(memberId: string | null) {
    if (!assignDevice) return; setBusy(true); setError("");
    try {
      await requestJson("/api/group-devices", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: assignDevice.id, memberId }) });
      setAssignDevice(null); setAssignMemberId(""); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "设备分配失败"); }
    finally { setBusy(false); }
  }

  function openNewAccount() {
    setEditingId(null); setDraft({ ...EMPTY, ownerId: chatEligible[0]?.id ?? "" }); setAccountOpen(true);
  }
  function openEditAccount(account: Account) {
    setEditingId(account.id); setDraft({ ownerId: account.owner.id, accountType: account.accountType, provider: account.provider, accountNumber: account.accountNumber, renewalDate: account.renewalDate ?? "", purpose: account.purpose ?? "", situation: account.situation ?? "", phoneCode: account.phoneCode ?? "", followUp: account.followUp ?? "" }); setAccountOpen(true);
  }
  async function saveAccount(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await requestJson("/api/device-accounts", { method: editingId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(editingId ? { id: editingId } : {}), ...draft, renewalDate: draft.renewalDate || null, purpose: draft.purpose || null, situation: draft.situation || null, phoneCode: draft.phoneCode || null, followUp: draft.followUp || null }) });
      setAccountOpen(false); setEditingId(null); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存号码失败"); }
    finally { setBusy(false); }
  }

  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <div style={{ display: "flex", gap: 8 }}><button className="btn" data-variant={sub === "device" ? "primary" : undefined} onClick={() => setSub("device")}>实体设备号</button><button className="btn" data-variant={sub === "chat" ? "primary" : undefined} onClick={() => setSub("chat")}>聊天号码档案</button></div>
    {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)", borderColor: "var(--bad-line)" }}>{error}</div> : null}
    {sub === "device" ? <section className="card">
      <div className="card-head"><div><h2 className="card-title">实体设备号</h2><p className="card-note">实体设备分配给具体接粉；客户进度里记录的设备号来自这里。</p></div><button className="btn" data-size="sm" data-variant="primary" onClick={() => setDeviceOpen(true)}><IconPlus size={13} />新增设备</button></div>
      <div className="table-scroll" style={{ maxHeight: "none" }}><table className="grid-table"><thead><tr><th>设备编号</th><th>分配给</th><th>状态</th><th>操作</th></tr></thead><tbody>{loading ? <tr><td colSpan={4} style={{ padding: 36, textAlign: "center" }}>正在读取设备…</td></tr> : devices.map((device) => <tr key={device.id}><td><strong>{device.code}</strong></td><td>{device.member?.name ?? <span className="muted">空闲</span>}</td><td><span className="badge" data-tone={device.member ? "ok" : "mute"}>{device.member ? "在用" : "闲置"}</span></td><td><button className="btn" data-size="sm" onClick={() => { setAssignDevice(device); setAssignMemberId(device.member?.id ?? ""); }}>{device.member ? "调整/收回" : "分配"}</button></td></tr>)}{!loading && !devices.length ? <tr><td colSpan={4} style={{ padding: 36, textAlign: "center", color: "var(--ink-3)" }}>暂无实体设备</td></tr> : null}</tbody></table></div>
    </section> : <section className="card">
      <div className="card-head"><div><h2 className="card-title">聊天号码档案</h2><p className="card-note">归属到具体炒群、专家或组长专家，用弹窗新增和编辑。</p></div><button className="btn" data-size="sm" data-variant="primary" onClick={openNewAccount}><IconPlus size={13} />新增号码</button></div>
      <div className="table-scroll" style={{ maxHeight: "none" }}><table className="grid-table"><thead><tr><th>类型</th><th>号商</th><th>号码</th><th>续费日期</th><th>用途</th><th>归属人</th><th>操作</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}><td>{LABEL[account.accountType]}</td><td>{account.provider}</td><td className="tnum">{account.accountNumber}</td><td>{account.renewalDate ?? "—"}</td><td>{account.purpose ?? "—"}</td><td>{account.owner.name}</td><td><button className="btn" data-size="sm" onClick={() => openEditAccount(account)}>编辑</button></td></tr>)}{!loading && !accounts.length ? <tr><td colSpan={7} style={{ padding: 36, textAlign: "center", color: "var(--ink-3)" }}>暂无聊天号码档案</td></tr> : null}</tbody></table></div>
    </section>}
    <Modal open={deviceOpen} onClose={() => !busy && setDeviceOpen(false)} title="新增设备"><form onSubmit={createDevice} style={{ display: "flex", flexDirection: "column", gap: 12 }}><label><span className="label">设备编号 *</span><input className="field" style={{ width: "100%" }} value={deviceCode} onChange={(event) => setDeviceCode(event.target.value)} required /></label><div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" onClick={() => setDeviceOpen(false)}>取消</button><button className="btn" data-variant="primary" data-confirm-action="新增实体设备" disabled={busy}><IconCheck size={14} />确认新增</button></div></form></Modal>
    <Modal open={Boolean(assignDevice)} onClose={() => !busy && setAssignDevice(null)} title={`分配设备 · ${assignDevice?.code ?? ""}`}><div style={{ display: "flex", flexDirection: "column", gap: 12 }}><label><span className="label">分配给接粉</span><select className="field" style={{ width: "100%" }} value={assignMemberId} onChange={(event) => setAssignMemberId(event.target.value)}><option value="">收回并设为空闲</option>{receptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button className="btn" onClick={() => setAssignDevice(null)}>取消</button><button className="btn" data-variant="primary" data-confirm-action="保存设备分配" disabled={busy} onClick={() => void saveAssignment(assignMemberId || null)}><IconCheck size={14} />保存</button></div></div></Modal>
    <Modal open={accountOpen} onClose={() => !busy && setAccountOpen(false)} title={editingId ? "编辑号码档案" : "新增号码档案"} width={620}><form onSubmit={saveAccount} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}><label><span className="label">归属人员 *</span><select className="field" style={{ width: "100%" }} value={draft.ownerId} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })} required>{chatEligible.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label><span className="label">账号类型</span><select className="field" style={{ width: "100%" }} value={draft.accountType} onChange={(event) => setDraft({ ...draft, accountType: event.target.value as AccountType })}>{Object.entries(LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="label">号商 *</span><input className="field" style={{ width: "100%" }} value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value })} required /></label><label><span className="label">号码 *</span><input className="field" style={{ width: "100%" }} value={draft.accountNumber} onChange={(event) => setDraft({ ...draft, accountNumber: event.target.value })} required /></label><label><span className="label">续费日期</span><input className="field" type="date" style={{ width: "100%" }} value={draft.renewalDate} onChange={(event) => setDraft({ ...draft, renewalDate: event.target.value })} /></label><label><span className="label">用途</span><input className="field" style={{ width: "100%" }} value={draft.purpose} onChange={(event) => setDraft({ ...draft, purpose: event.target.value })} /></label><label><span className="label">当前情况</span><input className="field" style={{ width: "100%" }} value={draft.situation} onChange={(event) => setDraft({ ...draft, situation: event.target.value })} /></label><label><span className="label">手机编号</span><input className="field" style={{ width: "100%" }} value={draft.phoneCode} onChange={(event) => setDraft({ ...draft, phoneCode: event.target.value })} /></label><label style={{ gridColumn: "span 2" }}><span className="label">跟进备注</span><textarea className="field" style={{ width: "100%", minHeight: 80 }} value={draft.followUp} onChange={(event) => setDraft({ ...draft, followUp: event.target.value })} /></label><div style={{ gridColumn: "span 2", display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" onClick={() => setAccountOpen(false)}>取消</button><button className="btn" data-variant="primary" data-confirm-action="保存号码档案" disabled={busy}><IconCheck size={14} />保存</button></div></form></Modal>
  </div>;
}
