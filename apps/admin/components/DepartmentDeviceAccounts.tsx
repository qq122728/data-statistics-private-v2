"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { requestJson } from "@/lib/backend";
import { Modal } from "./Modal";

type Role = "LEAD" | "RECEPTION" | "GROUP_OPERATOR" | "EXPERT";
type Member = { id: string; name: string; role: Role; roleAssignments: Array<{ role: Role }> };
type Group = { id: string; name: string; departmentId: string; department: { id: string; name: string }; members: Member[] };
type Device = { id: string; code: string; active: boolean; group: { id: string; name: string }; member: { id: string; name: string } | null };
type Account = {
  id: string;
  accountType: "NORMAL_WS" | "BUSINESS_WS" | "RCS";
  provider: string;
  accountNumber: string;
  renewalDate: string | null;
  purpose: string | null;
  situation: string | null;
  phoneCode: string | null;
  followUp: string | null;
  group: { id: string; name: string };
  owner: { id: string; name: string; role: Role };
};
type Payload = { groups: Group[]; devices: Device[]; accounts: Account[]; accountMaintenance: "OWNER_OR_LEAD" };

const ACCOUNT_LABEL: Record<Account["accountType"], string> = {
  NORMAL_WS: "普通 WS",
  BUSINESS_WS: "商业 WS",
  RCS: "RCS",
};

export function DepartmentDeviceAccounts({
  onToast,
}: {
  onToast: (message: string, tone?: "ok" | "warn") => void;
}) {
  const [data, setData] = useState<Payload>({ groups: [], devices: [], accounts: [], accountMaintenance: "OWNER_OR_LEAD" });
  const [groupId, setGroupId] = useState("");
  const [tab, setTab] = useState<"devices" | "accounts">("devices");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newDevice, setNewDevice] = useState({ groupId: "", code: "" });
  const [assigning, setAssigning] = useState<Device | null>(null);
  const [memberId, setMemberId] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await requestJson<Payload>("/api/org/department-assets");
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "设备账号读取失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const devices = useMemo(() => data.devices.filter((item) => !groupId || item.group.id === groupId), [data.devices, groupId]);
  const accounts = useMemo(() => data.accounts.filter((item) => !groupId || item.group.id === groupId), [data.accounts, groupId]);
  const assignmentGroup = assigning ? data.groups.find((item) => item.id === assigning.group.id) : null;

  function openCreate() {
    setNewDevice({ groupId: groupId || data.groups[0]?.id || "", code: "" });
    setCreateOpen(true);
  }

  async function createDevice(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await requestJson("/api/org/department-assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newDevice),
      });
      setCreateOpen(false);
      onToast("设备已新增到指定小组");
      await load();
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : "新增设备失败", "warn");
    } finally {
      setBusy(false);
    }
  }

  async function saveAssignment() {
    if (!assigning) return;
    setBusy(true);
    try {
      await requestJson("/api/org/department-assets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: assigning.id, memberId: memberId || null }),
      });
      setAssigning(null);
      onToast(memberId ? "设备分配已更新" : "设备已收回为空闲");
      await load();
    } catch (caught) {
      onToast(caught instanceof Error ? caught.message : "设备分配失败", "warn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <header>
        <h1 className="page-title">设备账号</h1>
        <p className="page-subtitle">按小组查看本部门实体设备和聊天账号。员工跨组调动后，在用设备和本人账号会自动跟随。</p>
      </header>
      <div className="card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span className="label">筛选小组</span>
        <select className="field" value={groupId} onChange={(event) => setGroupId(event.target.value)}>
          <option value="">全部小组</option>
          {data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
        <span className="badge" data-tone="mute">设备 {devices.length} 台</span>
        <span className="badge" data-tone="mute">账号 {accounts.length} 个</span>
        <button className="btn" style={{ marginLeft: "auto" }} onClick={() => void load()} disabled={loading}>刷新</button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn" data-variant={tab === "devices" ? "primary" : undefined} onClick={() => setTab("devices")}>实体设备</button>
        <button className="btn" data-variant={tab === "accounts" ? "primary" : undefined} onClick={() => setTab("accounts")}>聊天账号</button>
      </div>
      {error ? <div className="card" role="alert" style={{ padding: 14, color: "var(--bad)" }}>{error}</div> : null}
      {tab === "devices" ? (
        <section className="card">
          <div className="card-head">
            <div><h2 className="card-title">实体设备</h2><p className="card-note">部门管理员可以新增、分配和收回本部门设备。</p></div>
            <button className="btn" data-variant="primary" data-size="sm" disabled={!data.groups.length} onClick={openCreate}>＋ 新增设备</button>
          </div>
          <div className="table-scroll" style={{ maxHeight: "none" }}><table className="grid-table"><thead><tr><th>小组</th><th>设备编号</th><th>当前使用人</th><th>状态</th><th>操作</th></tr></thead><tbody>
            {loading ? <tr><td colSpan={5} style={{ padding: 36, textAlign: "center" }}>正在读取设备…</td></tr> : devices.map((device) => <tr key={device.id}><td>{device.group.name}</td><td><strong>{device.code}</strong></td><td>{device.member?.name ?? "—"}</td><td><span className="badge" data-tone={device.member ? "ok" : "mute"}>{device.member ? "在用" : "空闲"}</span></td><td><button className="btn" data-size="sm" onClick={() => { setAssigning(device); setMemberId(device.member?.id ?? ""); }}>{device.member ? "调整/收回" : "分配"}</button></td></tr>)}
            {!loading && !devices.length ? <tr><td colSpan={5} style={{ padding: 36, textAlign: "center" }} className="muted">当前筛选范围暂无设备</td></tr> : null}
          </tbody></table></div>
        </section>
      ) : (
        <section className="card">
          <div className="card-head"><div><h2 className="card-title">聊天账号</h2><p className="card-note">部门管理员集中查看；账号内容由账号本人或所在组组长维护，避免误改。</p></div></div>
          <div className="table-scroll" style={{ maxHeight: "none" }}><table className="grid-table"><thead><tr><th>小组</th><th>类型</th><th>号商/平台</th><th>号码</th><th>归属人</th><th>手机编号</th><th>用途</th><th>当前情况</th><th>续费日期</th></tr></thead><tbody>
            {loading ? <tr><td colSpan={9} style={{ padding: 36, textAlign: "center" }}>正在读取账号…</td></tr> : accounts.map((account) => <tr key={account.id}><td>{account.group.name}</td><td>{ACCOUNT_LABEL[account.accountType]}</td><td>{account.provider}</td><td className="tnum">{account.accountNumber}</td><td>{account.owner.name}</td><td>{account.phoneCode ?? "—"}</td><td>{account.purpose ?? "—"}</td><td>{account.situation ?? "—"}</td><td>{account.renewalDate ?? "—"}</td></tr>)}
            {!loading && !accounts.length ? <tr><td colSpan={9} style={{ padding: 36, textAlign: "center" }} className="muted">当前筛选范围暂无聊天账号</td></tr> : null}
          </tbody></table></div>
        </section>
      )}
      <Modal open={createOpen} onClose={() => !busy && setCreateOpen(false)} title="新增部门设备">
        <form onSubmit={createDevice} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label><span className="label">所属小组 *</span><select className="field" style={{ width: "100%" }} value={newDevice.groupId} onChange={(event) => setNewDevice({ ...newDevice, groupId: event.target.value })} required>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label><span className="label">设备编号 *</span><input className="field" style={{ width: "100%" }} value={newDevice.code} onChange={(event) => setNewDevice({ ...newDevice, code: event.target.value })} required /></label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" className="btn" onClick={() => setCreateOpen(false)}>取消</button><button className="btn" data-variant="primary" disabled={busy}>确认新增</button></div>
        </form>
      </Modal>
      <Modal open={Boolean(assigning)} onClose={() => !busy && setAssigning(null)} title={`分配设备 · ${assigning?.code ?? ""}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label><span className="label">使用人</span><select className="field" style={{ width: "100%" }} value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">收回并设为空闲</option>{assignmentGroup?.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <p className="card-note">只能选择设备所属小组的在职成员。</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button className="btn" onClick={() => setAssigning(null)}>取消</button><button className="btn" data-variant="primary" disabled={busy} onClick={() => void saveAssignment()}>保存分配</button></div>
        </div>
      </Modal>
    </div>
  );
}
