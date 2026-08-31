"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { IconCheck, IconPlus } from "./Icons";
import {
  CHAT_ACCOUNT_STATUS_META,
  type ChatAccountProfile, type ChatAccountStatus, type Member, type PhysicalDevice,
} from "@/lib/mock-data";

type Sub = "device" | "chat";

function Badge({ children, tone }: { children: React.ReactNode; tone: "ok" | "warn" | "bad" | "mute" }) {
  return <span className="badge" data-tone={tone}>{children}</span>;
}

/** 设备管理——需求文档7.2"两套并存"。实体设备号只分配给接粉（接粉只能用分配给自己的
 *  设备联系客户）；聊天号码档案只归属炒群/专家（炒群、专家只能用自己名下的号码联系
 *  客户）。两套资源结构相似（编号/归属人/状态），但字段不同、归属的岗位也不同，分两个
 *  子标签而不是硬凑成一张表。分配/收回/编辑都走 Modal 填表单 → ConfirmDialog 二次确认
 *  这个项目一贯的两步流程。 */
export function TabDeviceManagement({
  members, devices, chatAccounts, onAssignDevice, onUnassignDevice, onAddDevice,
  onAssignChatAccount, onUnassignChatAccount, onAddChatAccount, onEditChatAccount,
  onToast, onConfirm,
}: {
  members: Member[];
  devices: PhysicalDevice[];
  chatAccounts: ChatAccountProfile[];
  onAssignDevice: (deviceId: string, memberId: string) => void;
  onUnassignDevice: (deviceId: string) => void;
  onAddDevice: (deviceCode: string) => void;
  onAssignChatAccount: (accountId: string, memberId: string) => void;
  onUnassignChatAccount: (accountId: string) => void;
  onAddChatAccount: (draft: { vendor: string; phoneNumber: string; renewalDate: string; purpose: string }) => void;
  onEditChatAccount: (accountId: string, draft: { renewalDate: string; purpose: string; status: ChatAccountStatus }) => void;
  onToast: (msg: string, tone?: "ok" | "warn") => void;
  onConfirm: (c: Confirm) => void;
}) {
  const [sub, setSub] = useState<Sub>("device");
  const receptions = members.filter((m) => m.positions.includes("RECEPTION"));
  const chatEligible = members.filter((m) => m.positions.includes("GROUP_OPERATOR") || m.positions.includes("EXPERT"));

  const [newDeviceOpen, setNewDeviceOpen] = useState(false);
  const [newDeviceCode, setNewDeviceCode] = useState("");
  const [assignDeviceId, setAssignDeviceId] = useState<string | null>(null);
  const [assignDeviceMemberId, setAssignDeviceMemberId] = useState("");

  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatDraft, setNewChatDraft] = useState({ vendor: "", phoneNumber: "", renewalDate: "", purpose: "" });
  const [assignChatId, setAssignChatId] = useState<string | null>(null);
  const [assignChatMemberId, setAssignChatMemberId] = useState("");
  const [editChatId, setEditChatId] = useState<string | null>(null);
  const [editChatDraft, setEditChatDraft] = useState({ renewalDate: "", purpose: "", status: "ACTIVE" as ChatAccountStatus });

  function submitNewDevice() {
    const code = newDeviceCode.trim();
    if (!code) { onToast("请填设备编号", "warn"); return; }
    onConfirm({
      title: "确认新增设备", confirmLabel: "确认新增", target: code,
      desc: `新增设备「${code}」，先不分配，之后再指定给某个接粉。`,
      onConfirm: () => { onAddDevice(code); setNewDeviceOpen(false); setNewDeviceCode(""); },
    });
  }

  function submitAssignDevice() {
    const device = devices.find((d) => d.id === assignDeviceId);
    const member = receptions.find((m) => m.id === assignDeviceMemberId);
    if (!device) return;
    if (!member) { onToast("请选择要分配的接粉", "warn"); return; }
    onConfirm({
      title: "确认分配设备", confirmLabel: "确认分配", target: `${device.deviceCode} → ${member.name}`,
      desc: `把设备「${device.deviceCode}」分配给 ${member.name}，${member.name}联系客户时只能用这台设备。`,
      onConfirm: () => { onAssignDevice(device.id, member.id); setAssignDeviceId(null); },
    });
  }

  function askUnassignDevice(d: PhysicalDevice) {
    const owner = members.find((m) => m.id === d.assignedMemberId);
    onConfirm({
      title: "确认收回设备", confirmLabel: "确认收回", target: d.deviceCode, danger: true,
      desc: `把设备「${d.deviceCode}」从 ${owner?.name ?? ""} 名下收回，收回后变为闲置，${owner?.name ?? "该成员"}不能再用它联系客户。`,
      onConfirm: () => onUnassignDevice(d.id),
    });
  }

  function submitNewChat() {
    if (!newChatDraft.vendor.trim() || !newChatDraft.phoneNumber.trim() || !newChatDraft.renewalDate) {
      onToast("号商、号码、续费日期都是必填", "warn");
      return;
    }
    onConfirm({
      title: "确认新增号码档案", confirmLabel: "确认新增", target: newChatDraft.phoneNumber,
      desc: `新增号码档案「${newChatDraft.phoneNumber}」，先不分配，之后再指定给某个炒群或专家。`,
      onConfirm: () => {
        onAddChatAccount({ ...newChatDraft, vendor: newChatDraft.vendor.trim(), phoneNumber: newChatDraft.phoneNumber.trim() });
        setNewChatOpen(false);
        setNewChatDraft({ vendor: "", phoneNumber: "", renewalDate: "", purpose: "" });
      },
    });
  }

  function submitAssignChat() {
    const account = chatAccounts.find((c) => c.id === assignChatId);
    const member = chatEligible.find((m) => m.id === assignChatMemberId);
    if (!account) return;
    if (!member) { onToast("请选择要分配的炒群或专家", "warn"); return; }
    onConfirm({
      title: "确认分配号码", confirmLabel: "确认分配", target: `${account.phoneNumber} → ${member.name}`,
      desc: `把号码「${account.phoneNumber}」分配给 ${member.name}，${member.name}联系客户时只能用自己名下的号码。`,
      onConfirm: () => { onAssignChatAccount(account.id, member.id); setAssignChatId(null); },
    });
  }

  function askUnassignChat(c: ChatAccountProfile) {
    const owner = members.find((m) => m.id === c.ownerMemberId);
    onConfirm({
      title: "确认收回号码", confirmLabel: "确认收回", target: c.phoneNumber, danger: true,
      desc: `把号码「${c.phoneNumber}」从 ${owner?.name ?? ""} 名下收回，收回后变为闲置。`,
      onConfirm: () => onUnassignChatAccount(c.id),
    });
  }

  function openEditChat(c: ChatAccountProfile) {
    setEditChatId(c.id);
    setEditChatDraft({ renewalDate: c.renewalDate, purpose: c.purpose, status: c.status });
  }

  function submitEditChat() {
    const account = chatAccounts.find((c) => c.id === editChatId);
    if (!account) return;
    onConfirm({
      title: "确认保存修改", confirmLabel: "保存", target: account.phoneNumber,
      desc: `修改号码「${account.phoneNumber}」的续费日期/用途/状态，保存后立刻生效。`,
      onConfirm: () => { onEditChatAccount(account.id, editChatDraft); setEditChatId(null); },
    });
  }

  const assignDevice = assignDeviceId ? devices.find((d) => d.id === assignDeviceId) ?? null : null;
  const assignChat = assignChatId ? chatAccounts.find((c) => c.id === assignChatId) ?? null : null;
  const editChat = editChatId ? chatAccounts.find((c) => c.id === editChatId) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {([["device", "实体设备号"], ["chat", "聊天号码档案"]] as const).map(([id, label]) => (
          <button key={id} className="btn" data-variant={sub === id ? "primary" : undefined} onClick={() => setSub(id)}>
            {label}
          </button>
        ))}
      </div>

      {sub === "device" ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">实体设备号</h2>
              <p className="card-note">分配给具体接粉——接粉联系客户只能用分配给自己的设备（需求文档 7.2）。</p>
            </div>
            <button className="btn" data-size="sm" data-variant="primary" onClick={() => { setNewDeviceCode(""); setNewDeviceOpen(true); }}>
              <IconPlus size={13} />新增设备
            </button>
          </div>
          <div className="table-scroll" style={{ maxHeight: "none" }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>设备编号</th>
                  <th>分配给</th>
                  <th>状态</th>
                  <th style={{ width: 120 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const owner = members.find((m) => m.id === d.assignedMemberId);
                  return (
                    <tr key={d.id}>
                      <td style={{ fontWeight: 600 }}>{d.deviceCode}</td>
                      <td>{owner ? owner.name : <span style={{ color: "var(--ink-3)" }}>空闲</span>}</td>
                      <td><Badge tone={d.status === "ACTIVE" ? "ok" : "mute"}>{d.status === "ACTIVE" ? "在用" : "闲置"}</Badge></td>
                      <td>
                        {owner ? (
                          <button className="btn" data-size="sm" onClick={() => askUnassignDevice(d)}>收回</button>
                        ) : (
                          <button className="btn" data-size="sm" onClick={() => { setAssignDeviceId(d.id); setAssignDeviceMemberId(""); }}>分配</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">聊天号码档案</h2>
              <p className="card-note">归属到具体炒群/专家——炒群、专家联系客户只能用自己名下的号码（需求文档 7.2）。</p>
            </div>
            <button className="btn" data-size="sm" data-variant="primary" onClick={() => { setNewChatDraft({ vendor: "", phoneNumber: "", renewalDate: "", purpose: "" }); setNewChatOpen(true); }}>
              <IconPlus size={13} />新增号码
            </button>
          </div>
          <div className="table-scroll" style={{ maxHeight: "none" }}>
            <table className="grid-table">
              <thead>
                <tr>
                  <th>号商</th>
                  <th>号码</th>
                  <th>续费日期</th>
                  <th>用途</th>
                  <th>状态</th>
                  <th>归属人</th>
                  <th style={{ width: 160 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {chatAccounts.map((c) => {
                  const owner = members.find((m) => m.id === c.ownerMemberId);
                  const meta = CHAT_ACCOUNT_STATUS_META[c.status];
                  return (
                    <tr key={c.id}>
                      <td>{c.vendor}</td>
                      <td className="tnum">{c.phoneNumber}</td>
                      <td className="tnum">{c.renewalDate}</td>
                      <td>{c.purpose}</td>
                      <td><Badge tone={meta.tone}>{meta.label}</Badge></td>
                      <td>{owner ? owner.name : <span style={{ color: "var(--ink-3)" }}>空闲</span>}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button className="btn" data-size="sm" onClick={() => openEditChat(c)}>编辑</button>
                          {owner ? (
                            <button className="btn" data-size="sm" onClick={() => askUnassignChat(c)}>收回</button>
                          ) : (
                            <button className="btn" data-size="sm" onClick={() => { setAssignChatId(c.id); setAssignChatMemberId(""); }}>分配</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 新增设备弹窗 */}
      <Modal open={newDeviceOpen} onClose={() => setNewDeviceOpen(false)} title="新增设备">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">设备编号 *</label>
            <input className="field" style={{ width: "100%" }} placeholder="例如：DE-IP-007"
              value={newDeviceCode} onChange={(e) => setNewDeviceCode(e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setNewDeviceOpen(false)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitNewDevice}><IconCheck size={15} />提交</button>
          </div>
        </div>
      </Modal>

      {/* 分配设备弹窗 */}
      <Modal open={Boolean(assignDevice)} onClose={() => setAssignDeviceId(null)} title={`分配设备 · ${assignDevice?.deviceCode ?? ""}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">分配给（接粉）*</label>
            <select className="field" style={{ width: "100%" }}
              value={assignDeviceMemberId} onChange={(e) => setAssignDeviceMemberId(e.target.value)}>
              <option value="">请选择</option>
              {receptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setAssignDeviceId(null)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitAssignDevice}><IconCheck size={15} />提交</button>
          </div>
        </div>
      </Modal>

      {/* 新增号码弹窗 */}
      <Modal open={newChatOpen} onClose={() => setNewChatOpen(false)} title="新增号码档案" width={480}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="label">号商 *</label>
              <input className="field" style={{ width: "100%" }} placeholder="必填"
                value={newChatDraft.vendor} onChange={(e) => setNewChatDraft({ ...newChatDraft, vendor: e.target.value })} />
            </div>
            <div>
              <label className="label">号码 *</label>
              <input className="field" style={{ width: "100%" }} placeholder="必填"
                value={newChatDraft.phoneNumber} onChange={(e) => setNewChatDraft({ ...newChatDraft, phoneNumber: e.target.value })} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="label">续费日期 *</label>
              <input className="field" type="date" style={{ width: "100%" }}
                value={newChatDraft.renewalDate} onChange={(e) => setNewChatDraft({ ...newChatDraft, renewalDate: e.target.value })} />
            </div>
            <div>
              <label className="label">用途</label>
              <input className="field" style={{ width: "100%" }} placeholder="例如：炒群联系 / 专家谈单"
                value={newChatDraft.purpose} onChange={(e) => setNewChatDraft({ ...newChatDraft, purpose: e.target.value })} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setNewChatOpen(false)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitNewChat}><IconCheck size={15} />提交</button>
          </div>
        </div>
      </Modal>

      {/* 分配号码弹窗 */}
      <Modal open={Boolean(assignChat)} onClose={() => setAssignChatId(null)} title={`分配号码 · ${assignChat?.phoneNumber ?? ""}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">分配给（炒群/专家）*</label>
            <select className="field" style={{ width: "100%" }}
              value={assignChatMemberId} onChange={(e) => setAssignChatMemberId(e.target.value)}>
              <option value="">请选择</option>
              {chatEligible.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setAssignChatId(null)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitAssignChat}><IconCheck size={15} />提交</button>
          </div>
        </div>
      </Modal>

      {/* 编辑号码弹窗 */}
      <Modal open={Boolean(editChat)} onClose={() => setEditChatId(null)} title={`编辑号码 · ${editChat?.phoneNumber ?? ""}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">续费日期</label>
            <input className="field" type="date" style={{ width: "100%" }}
              value={editChatDraft.renewalDate} onChange={(e) => setEditChatDraft({ ...editChatDraft, renewalDate: e.target.value })} />
          </div>
          <div>
            <label className="label">用途</label>
            <input className="field" style={{ width: "100%" }}
              value={editChatDraft.purpose} onChange={(e) => setEditChatDraft({ ...editChatDraft, purpose: e.target.value })} />
          </div>
          <div>
            <label className="label">状态</label>
            <select className="field" style={{ width: "100%" }}
              value={editChatDraft.status} onChange={(e) => setEditChatDraft({ ...editChatDraft, status: e.target.value as ChatAccountStatus })}>
              {(Object.keys(CHAT_ACCOUNT_STATUS_META) as ChatAccountStatus[]).map((s) => (
                <option key={s} value={s}>{CHAT_ACCOUNT_STATUS_META[s].label}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setEditChatId(null)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitEditChat}><IconCheck size={15} />保存</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
