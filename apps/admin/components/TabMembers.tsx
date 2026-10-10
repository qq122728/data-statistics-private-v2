"use client";
import { WORKSPACE_LABELS as labels } from "../../../packages/workspace/navigation";

import { useState } from "react";
import { MemberWorkHandover } from "./MemberWorkHandover";
import type { Confirm } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { IconCheck, IconEdit, IconKey, IconPlus, IconTrash } from "./Icons";
import {
  POSITION_META,
  POSITION_ORDER,
  type Member,
  type Position,
} from "@/lib/member-metadata";

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "ok" | "mute";
}) {
  return (
    <span className="badge" data-tone={tone ?? "mute"}>
      {children}
    </span>
  );
}

function PositionPicker({
  value,
  onToggle,
  disabled = false,
}: {
  value: Position[];
  onToggle: (p: Position) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {POSITION_ORDER.map((p) => (
        <button
          key={p}
          type="button"
          className="btn"
          data-size="sm"
          data-variant={value.includes(p) ? "primary" : undefined}
          disabled={disabled}
          onClick={() => onToggle(p)}
        >
          {POSITION_META[p]}
        </button>
      ))}
    </div>
  );
}

/** 一个账号可同时拥有接粉、炒群、专家权限；至少保留一个岗位由提交时校验。 */
function togglePositionValue(current: Position[], p: Position): Position[] {
  const has = current.includes(p);
  return has ? current.filter((x) => x !== p) : [...current, p];
}

/** 组员账号、岗位设置与配对交接。人员转岗由页面中的 PersonnelTransferPanel 处理。 */
export function TabMembers({
  members,
  defaultDualFrontline = false,
  onUpdateMemberSetup,
  onCreateAccount,
  onResetPassword,
  onDeleteAccount,
  lead,
  onHandoverComplete,
  onToast,
  onConfirm,
}: {
  members: Member[];
  defaultDualFrontline?: boolean;
  onUpdateMemberSetup: (
    memberId: string,
    positions: Position[],
    pairedGroupOperatorId: string | null,
    profile: { name: string; username: string },
  ) => Promise<void>;
  onCreateAccount: (draft: {
    name: string;
    username: string;
    positions: Position[];
    pairedGroupOperatorId?: string;
  }) => Promise<string>;
  onResetPassword: (memberId: string) => Promise<string>;
  onDeleteAccount: (memberId: string) => Promise<void>;
  lead: { id: string; name: string };
  onHandoverComplete: () => Promise<void>;
  onToast: (msg: string, tone?: "ok" | "warn") => void;
  onConfirm: (c: Confirm) => void;
}) {
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    username: string;
    positions: Position[];
    pairedGroupOperatorId: string;
  } | null>(null);
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [newAccountDraft, setNewAccountDraft] = useState({
    name: "",
    username: "",
    positions: (defaultDualFrontline ? ["RECEPTION", "GROUP_OPERATOR"] : ["RECEPTION"]) as Position[],
    pairedGroupOperatorId: "",
  });
  const [createdBanner, setCreatedBanner] = useState<{
    kind: "created" | "reset";
    name: string;
    username: string;
    password: string;
  } | null>(null);
  const groupOperators = members.filter((m) =>
    m.positions.includes("GROUP_OPERATOR"),
  );

  function askResetPassword(m: Member) {
    onConfirm({
      title: "确认重置密码",
      confirmLabel: "确认重置",
      target: `${m.name}（${m.username}）`,
      danger: true,
      desc: `重置后会生成一个新的初始密码，${m.name}现在用的密码立刻失效，首次登录必须修改新密码。`,
      onConfirm: async () => {
        try {
          const password = await onResetPassword(m.id);
          setCreatedBanner({
            kind: "reset",
            name: m.name,
            username: m.username,
            password,
          });
          onToast(`已重置 ${m.name} 的密码`);
        } catch (caught) {
          onToast(
            caught instanceof Error ? caught.message : "重置密码失败",
            "warn",
          );
        }
      },
    });
  }

  function openEdit(m: Member) {
    setEditingMemberId(m.id);
    setEditDraft({
      name: m.name,
      username: m.username,
      positions: m.positions,
      pairedGroupOperatorId: m.pairedGroupOperatorId ?? "",
    });
  }

  function askDeleteAccount(member: Member) {
    onConfirm({
      title: "确认永久删除账号",
      confirmLabel: "确认删除",
      target: `${member.name}（${member.username}）`,
      desc: "只有尚未产生客户、日报、资金、设备或操作记录的误开账号才能删除。删除后无法恢复；已有业务记录的账号会被系统拒绝删除，请改为停用。",
      onConfirm: async () => {
        try {
          await onDeleteAccount(member.id);
          onToast(`已永久删除误开账号“${member.name}”`);
        } catch (caught) {
          onToast(caught instanceof Error ? caught.message : "账号删除失败", "warn");
        }
      },
    });
  }

  function submitEdit() {
    const m = members.find((x) => x.id === editingMemberId);
    if (!m || !editDraft) return;
    const name = editDraft.name.trim();
    const username = editDraft.username.trim();
    if (!name) {
      onToast("成员姓名不能为空", "warn");
      return;
    }
    if (!username) {
      onToast("登录用户名不能为空", "warn");
      return;
    }
    if (members.some((member) => member.id !== m.id && member.username === username)) {
      onToast("这个用户名已经有人用了，换一个", "warn");
      return;
    }
    if (!editDraft.positions.length) {
      onToast("至少要保留一个岗位，不能清空", "warn");
      return;
    }
    onConfirm({
      title: "确认修改成员资料",
      confirmLabel: "确认保存",
      target: `${m.name}（${m.username}）`,
      desc: `姓名将保存为“${name}”，登录用户名将保存为“${username}”。修改用户名后，该员工下次必须使用新用户名登录；历史数据不会丢失。`,
      onConfirm: async () => {
        try {
          await onUpdateMemberSetup(
            m.id,
            editDraft.positions,
            editDraft.positions.includes("RECEPTION")
              ? editDraft.pairedGroupOperatorId || null
              : null,
            { name, username },
          );
          setEditingMemberId(null);
          setEditDraft(null);
          onToast(`已更新 ${name} 的资料与配对设置`);
        } catch (caught) {
          onToast(
            caught instanceof Error ? caught.message : "成员资料保存失败",
            "warn",
          );
        }
      },
    });
  }

  function submitNewAccount() {
    const name = newAccountDraft.name.trim();
    const username = newAccountDraft.username.trim();
    if (!name) {
      onToast("请填姓名", "warn");
      return;
    }
    if (!username) {
      onToast("请填用户名", "warn");
      return;
    }
    if (members.some((m) => m.username === username)) {
      onToast("这个用户名已经有人用了，换一个", "warn");
      return;
    }
    if (!newAccountDraft.positions.length) {
      onToast("至少要选一个岗位", "warn");
      return;
    }
    const positionLabel = newAccountDraft.positions
      .map((p) => POSITION_META[p])
      .join("+");
    onConfirm({
      title: "确认开通账号",
      confirmLabel: "确认开通",
      target: `${name}（${username}）`,
      desc: `给 ${name} 开通账号，岗位设为「${positionLabel}」。开通后会生成一个初始密码，首次登录必须修改。`,
      onConfirm: async () => {
        try {
          const password = await onCreateAccount({
            name,
            username,
            positions: newAccountDraft.positions,
            pairedGroupOperatorId:
              newAccountDraft.positions.includes("RECEPTION") &&
              newAccountDraft.pairedGroupOperatorId
                ? newAccountDraft.pairedGroupOperatorId
                : undefined,
          });
          setCreatedBanner({ kind: "created", name, username, password });
          setNewAccountDraft({
            name: "",
            username: "",
            positions: defaultDualFrontline ? ["RECEPTION", "GROUP_OPERATOR"] : ["RECEPTION"],
            pairedGroupOperatorId: "",
          });
          setNewAccountOpen(false);
          onToast(`已给 ${name} 开通账号`);
        } catch (caught) {
          onToast(
            caught instanceof Error ? caught.message : "开通账号失败",
            "warn",
          );
        }
      },
    });
  }

  function MemberList() {
    return <div style={{ border: "1px solid var(--line)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      {members.map((m, i) => {
        const paired = members.find(x => x.id === m.pairedGroupOperatorId);
        const receptions = members.filter(x => x.pairedGroupOperatorId === m.id);
        return <div key={m.id} className="member-account-row" style={{ padding: "14px 12px", borderTop: i ? "1px solid var(--line)" : undefined, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}><strong>{m.name}</strong>{m.positions.map(p => <Badge key={p}>{POSITION_META[p]}</Badge>)}{!m.active ? <Badge>已停用</Badge> : null}{m.isDefaultExpert ? <Badge tone="ok">默认专家</Badge> : null}</div>
            <p style={{ margin: "5px 0 0", color: "var(--ink-2)", fontSize: 12 }}>登录账号：{m.username}</p>
            <p style={{ margin: "3px 0 0", color: "var(--ink-2)", fontSize: 12 }}>{m.positions.includes("RECEPTION") ? `配对炒群：${m.pairedGroupOperatorId === m.id ? "本人承接" : paired?.name ?? "未配对"}` : ""}{m.positions.includes("RECEPTION") && receptions.length ? " · " : ""}{receptions.length ? `配对接粉：${receptions.map(r => r.name).join("、")}` : ""}</p>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button className="btn" data-size="sm" aria-label={`编辑 ${m.name} 的资料与配对`} onClick={() => openEdit(m)}><IconEdit size={13} />编辑资料</button>
            <button className="btn" data-size="sm" aria-label={`重置 ${m.name} 的密码`} onClick={() => askResetPassword(m)}><IconKey size={13} />重置密码</button>
            <button className="btn" data-size="sm" aria-label={`删除误开账号 ${m.name}`} style={{ color: "var(--bad)" }} onClick={() => askDeleteAccount(m)}><IconTrash size={13} />删除误开账号</button>
          </div>
        </div>;
      })}
      {!members.length ? <p style={{ padding: 16 }}>暂无成员，请先开通账号。</p> : null}
    </div>;
  }

  const editingMember = editingMemberId
    ? members.find((m) => m.id === editingMemberId)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {createdBanner ? (
        <div
          className="card"
          style={{
            background: "var(--ok-soft)",
            borderColor: "var(--ok-line)",
          }}
        >
          <div
            style={{
              padding: 16,
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div>
              <p
                style={{
                  margin: 0,
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: "var(--ok)",
                }}
              >
                {createdBanner.name} 的
                {createdBanner.kind === "created"
                  ? "账号开通好了"
                  : "密码重置好了"}
                ，把下面这份信息发给本人
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 13.5 }}>
                用户名：
                <strong className="tnum">{createdBanner.username}</strong>
                <span style={{ margin: "0 10px", color: "var(--ink-3)" }}>
                  ·
                </span>
                {createdBanner.kind === "created" ? "初始密码" : "新密码"}：
                <strong className="tnum">{createdBanner.password}</strong>
              </p>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 12.5,
                  color: "var(--ink-3)",
                }}
              >
                首次登录必须修改密码，这份信息离开这页就看不到了。
              </p>
            </div>
            <button
              className="btn"
              data-size="sm"
              onClick={() => setCreatedBanner(null)}
            >
              我记下了
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">{labels.members}</h2>
            <p className="card-note">
              每人只显示一行，岗位权限列在姓名旁。这里编辑资料、配对或重置密码；需要调整岗位时使用下方人员调岗。
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
              共 {members.length} 人
            </span>
            <button
              className="btn"
              data-size="sm"
              data-variant="primary"
              onClick={() => setNewAccountOpen(true)}
            >
              <IconPlus size={13} />
              开通账号
            </button>
          </div>
        </div>
        <div
          style={{
            padding: 16,
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr)",
            gap: 18,
          }}
        >
          <MemberList />
        </div>
      </div>

      <MemberWorkHandover members={members} lead={lead} onComplete={onHandoverComplete} onToast={onToast} />

      {/* 开通账号弹窗 */}
      <Modal
        open={newAccountOpen}
        onClose={() => setNewAccountOpen(false)}
        title="开通账号"
        note="给新组员开一个前台账号，设置岗位后保存，会生成一个初始密码。"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <div>
              <label className="label">姓名 *</label>
              <input
                className="field"
                style={{ width: "100%" }}
                placeholder="必填"
                value={newAccountDraft.name}
                onChange={(e) =>
                  setNewAccountDraft({
                    ...newAccountDraft,
                    name: e.target.value,
                  })
                }
              />
            </div>
            <div>
              <label className="label">用户名 *</label>
              <input
                className="field"
                style={{ width: "100%" }}
                placeholder="登录用的账号，不能重复"
                value={newAccountDraft.username}
                onChange={(e) =>
                  setNewAccountDraft({
                    ...newAccountDraft,
                    username: e.target.value,
                  })
                }
              />
            </div>
          </div>
          <div>
            <label className="label">岗位权限（可多选）</label>
            {defaultDualFrontline ? <div className="card-note" style={{ marginBottom: 8 }}>黑客组新组员默认开通接粉＋炒群；专家账号仍可单独选择专家。</div> : null}
            <PositionPicker
              value={newAccountDraft.positions}
              onToggle={(p) => {
                let positions = togglePositionValue(newAccountDraft.positions, p);
                if (defaultDualFrontline && (p === "RECEPTION" || p === "GROUP_OPERATOR")) {
                  const pairWasEnabled = newAccountDraft.positions.includes("RECEPTION") && newAccountDraft.positions.includes("GROUP_OPERATOR");
                  positions = pairWasEnabled
                    ? positions.filter((position) => position !== "RECEPTION" && position !== "GROUP_OPERATOR")
                    : [...new Set([...positions, "RECEPTION", "GROUP_OPERATOR"])] as Position[];
                }
                setNewAccountDraft({ ...newAccountDraft, positions });
              }}
            />
          </div>
          {newAccountDraft.positions.includes("RECEPTION") ? (
            <div>
              <label className="label">配对炒群</label>
              <select
                className="field"
                style={{ width: "100%" }}
                value={newAccountDraft.pairedGroupOperatorId}
                onChange={(e) =>
                  setNewAccountDraft({
                    ...newAccountDraft,
                    pairedGroupOperatorId: e.target.value,
                  })
                }
              >
                <option value="">
                  {newAccountDraft.positions.includes("GROUP_OPERATOR")
                    ? "兼任·本人承接（自动）"
                    : "待配对"}
                </option>
                {groupOperators.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setNewAccountOpen(false)}>
              取消
            </button>
            <button
              className="btn"
              data-variant="primary"
              onClick={submitNewAccount}
            >
              <IconCheck size={15} />
              开通账号
            </button>
          </div>
        </div>
      </Modal>

      {/* 设置岗位弹窗 */}
      <Modal
        open={Boolean(editingMember && editDraft)}
        onClose={() => {
          setEditingMemberId(null);
          setEditDraft(null);
        }}
        title={`编辑成员 · ${editingMember?.name ?? ""}`}
        note="组长可以修正成员姓名、登录用户名和配对；岗位变化仍使用人员调岗，避免历史成绩归错。"
      >
        {editingMember && editDraft ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="form-grid cols-2">
              <label><span className="label">成员姓名</span><input className="field" value={editDraft.name} onChange={(event) => setEditDraft({ ...editDraft, name: event.target.value })} required style={{ width: "100%" }} /></label>
              <label><span className="label">登录用户名</span><input className="field" value={editDraft.username} onChange={(event) => setEditDraft({ ...editDraft, username: event.target.value })} required style={{ width: "100%" }} /><small className="muted">保存后，员工需要使用新的用户名登录。</small></label>
            </div>
            <div>
              <label className="label">岗位权限（可多选）</label>
              <PositionPicker
                value={editDraft.positions}
                onToggle={(p) => {
                  if (editingMember.positions.includes(p)) {
                    onToast("已有岗位不能在这里关闭；如需取消岗位，请使用人员调岗", "warn");
                    return;
                  }
                  setEditDraft({
                    ...editDraft,
                    positions: togglePositionValue(editDraft.positions, p),
                  });
                }}
              />
              <p className="card-note" style={{ marginTop: 6 }}>可以给旧账号新增炒群或专家权限；已有岗位不能在这里关闭。取消岗位或正式转岗请使用页面下方“人员调岗与跨组调动”。</p>
            </div>
            {editDraft.positions.includes("RECEPTION") ? (
              <div>
                <label className="label">配对炒群</label>
                <select
                  className="field"
                  style={{ width: "100%" }}
                  value={editDraft.pairedGroupOperatorId}
                  onChange={(e) =>
                    setEditDraft({
                      ...editDraft,
                      pairedGroupOperatorId: e.target.value,
                    })
                  }
                >
                  <option value="">待配对</option>
                  {editDraft.positions.includes("GROUP_OPERATOR") ? (
                    <option value={editingMember.id}>兼任·本人承接</option>
                  ) : null}
                  {groupOperators
                    .filter((g) => g.id !== editingMember.id)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                </select>
              </div>
            ) : null}
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
            >
              <button
                className="btn"
                onClick={() => {
                  setEditingMemberId(null);
                  setEditDraft(null);
                }}
              >
                取消
              </button>
              <button
                className="btn"
                data-variant="primary"
                onClick={submitEdit}
              >
                <IconCheck size={15} />
                保存
              </button>
            </div>
          </div>
        ) : null}
      </Modal>


    </div>
  );
}
