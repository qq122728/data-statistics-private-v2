"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { IconCheck, IconEdit, IconKey, IconPlus, IconTrash } from "./Icons";
import {
  POSITION_META,
  POSITION_ORDER,
  TODAY,
  type Member,
  type Position,
  type TransferRecord,
} from "@/lib/mock-data";

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

/** 组员管理——组长给前台开设账号（姓名/用户名/初始密码）、设置岗位、配置接粉炒群配对、
 *  指定专家；发起转岗时强制要求先选交接人（需求文档 1.6 ⚠️）。开通账号/设置岗位/发起
 *  转岗都是弹窗表单，提交后走 ConfirmDialog 二次确认才真正生效。 */
export function TabMembers({
  members,
  transfers,
  defaultDualFrontline = false,
  onUpdateMemberSetup,
  onSubmitTransfer,
  onCreateAccount,
  onResetPassword,
  onDeleteAccount,
  onPreviewHandoff,
  onConfirmHandoff,
  onToast,
  onConfirm,
}: {
  members: Member[];
  transfers: TransferRecord[];
  defaultDualFrontline?: boolean;
  onUpdateMemberSetup: (
    memberId: string,
    positions: Position[],
    pairedGroupOperatorId: string | null,
    profile: { name: string; username: string },
  ) => Promise<void>;
  onSubmitTransfer?: (draft: {
    memberId: string;
    toLabel: string;
    fromLabel: string;
    effectiveDate: string;
    reason: string;
    handoffToId: string;
  }) => Promise<void>;
  onCreateAccount: (draft: {
    name: string;
    username: string;
    positions: Position[];
    pairedGroupOperatorId?: string;
  }) => Promise<string>;
  onResetPassword: (memberId: string) => Promise<string>;
  onDeleteAccount: (memberId: string) => Promise<void>;
  onPreviewHandoff: (draft: {
    receptionistId: string;
    fromGroupOperatorId: string;
    toGroupOperatorId: string;
  }) => Promise<number>;
  onConfirmHandoff: (draft: {
    receptionistId: string;
    fromGroupOperatorId: string;
    toGroupOperatorId: string;
    expectedCount: number;
    reason: string;
  }) => Promise<number>;
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
  const [transferDraft, setTransferDraft] = useState<{
    memberId: string;
    toPositions: Position[];
    effectiveDate: string;
    reason: string;
    handoffToId: string;
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
  const [handoffDraft, setHandoffDraft] = useState({
    receptionistId: "",
    fromGroupOperatorId: "",
    toGroupOperatorId: "",
    reason: "",
  });
  const [handoffPreviewCount, setHandoffPreviewCount] = useState<number | null>(
    null,
  );
  const [handoffBusy, setHandoffBusy] = useState(false);

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

  function openTransferDraft(m: Member) {
    setTransferDraft({
      memberId: m.id,
      toPositions: m.positions,
      effectiveDate: TODAY,
      reason: "",
      handoffToId: "",
    });
  }

  function submitTransfer() {
    if (!transferDraft) return;
    const m = members.find((x) => x.id === transferDraft.memberId);
    if (!m) return;
    if (!transferDraft.reason.trim()) {
      onToast("请填转岗原因", "warn");
      return;
    }
    // 只要这个人当前有岗位在办客户（简化：只要有岗位就视为可能有在办客户），转岗前必须选交接人
    if (m.positions.length && !transferDraft.handoffToId) {
      onToast("转岗前必须先把手上在办客户交接给一个人，请选交接对象", "warn");
      return;
    }
    const fromLabel =
      m.positions.map((p) => POSITION_META[p]).join("+") || "（无岗位）";
    const toLabel =
      transferDraft.toPositions.map((p) => POSITION_META[p]).join("+") ||
      "（无岗位）";
    const handoffName =
      members.find((x) => x.id === transferDraft.handoffToId)?.name ?? "";
    onConfirm({
      title: "确认提交转岗",
      confirmLabel: "确认转岗",
      target: m.name,
      danger: true,
      desc: `${m.name}：${fromLabel} → ${toLabel}，生效日 ${transferDraft.effectiveDate}${handoffName ? `，在办客户交接给 ${handoffName}` : ""}。旧岗位期间的历史成绩会保留在旧榜单里，不会因为转岗消失。`,
      onConfirm: async () => {
        if (!onSubmitTransfer) return;
        await onSubmitTransfer({
          memberId: m.id,
          fromLabel,
          toLabel,
          effectiveDate: transferDraft.effectiveDate,
          reason: transferDraft.reason.trim(),
          handoffToId: transferDraft.handoffToId,
        });
        setTransferDraft(null);
        onToast(`已提交 ${m.name} 的转岗`);
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

  function PositionTable({ position }: { position: Position }) {
    const list = members.filter((m) => m.positions.includes(position));
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 13.5,
              fontWeight: 700,
              color: "var(--ink-2)",
            }}
          >
            {POSITION_META[position]}
          </h3>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
            {list.length} 人
          </span>
        </div>
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}
        >
          {list.map((m, i) => {
            const pairedGroupOperator = m.pairedGroupOperatorId
              ? members.find((x) => x.id === m.pairedGroupOperatorId)
              : undefined;
            const pairedReceptions = members.filter(
              (x) => x.pairedGroupOperatorId === m.id,
            );
            const otherPositions = m.positions.filter((p) => p !== position);
            return (
              <div
                key={m.id}
                style={{
                  padding: "10px 12px",
                  background: "var(--surface)",
                  borderTop: i ? "1px solid var(--line)" : undefined,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 999,
                    background: "var(--surface-sunken)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  {m.name[0]}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <strong style={{ fontSize: 13.5 }}>{m.name}</strong>
                    {otherPositions.map((p) => (
                      <Badge key={p}>兼{POSITION_META[p]}</Badge>
                    ))}
                    {m.isDefaultExpert ? (
                      <Badge tone="ok">默认专家</Badge>
                    ) : null}
                  </div>
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: 12,
                      color: "var(--ink-3)",
                    }}
                  >
                    用户名：{m.username} · {position === "GROUP_OPERATOR"
                      ? pairedReceptions.length
                        ? `配对：${pairedReceptions.map((r) => r.name).join("、")}`
                        : "暂无配对接粉"
                      : position === "RECEPTION"
                        ? `配对：${m.pairedGroupOperatorId === m.id ? "兼任·本人承接" : (pairedGroupOperator?.name ?? "未配对")}`
                        : `入组 ${m.joinedGroupDate}`}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    className="btn"
                    data-size="sm"
                    title="编辑成员资料与配对"
                    onClick={() => openEdit(m)}
                  >
                    <IconEdit size={12} />
                  </button>
                  <button
                    className="btn"
                    data-size="sm"
                    title="重置密码"
                    onClick={() => askResetPassword(m)}
                  >
                    <IconKey size={12} />
                  </button>
                  <button
                    className="btn"
                    data-size="sm"
                    title="删除误开账号"
                    style={{ color: "var(--bad)" }}
                    onClick={() => askDeleteAccount(m)}
                  >
                    <IconTrash size={12} />
                  </button>
                  {onSubmitTransfer ? (
                    <button
                      className="btn"
                      data-size="sm"
                      onClick={() => openTransferDraft(m)}
                    >
                      转岗
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {!list.length ? (
            <div
              style={{
                padding: "20px 0",
                textAlign: "center",
                color: "var(--ink-3)",
                fontSize: 12.5,
              }}
            >
              暂无成员
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const editingMember = editingMemberId
    ? members.find((m) => m.id === editingMemberId)
    : null;
  const transferMember = transferDraft
    ? members.find((m) => m.id === transferDraft.memberId)
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
            <h2 className="card-title">组员管理</h2>
            <p className="card-note">
              接粉、炒群、专家可以任意组合在同一个账号。这里改岗位、配对，都是给员工账号“开权限”，不是复制人员或客户。
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
            gridTemplateColumns: "repeat(3, minmax(0,1fr))",
            gap: 18,
          }}
        >
          <PositionTable position="RECEPTION" />
          <PositionTable position="GROUP_OPERATOR" />
          <PositionTable position="EXPERT" />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">在办客户交接</h2>
            <p className="card-note">
              换配对只影响之后的新客户；已有在办客户必须在这里先预览数量，再明确确认交接。
            </p>
          </div>
        </div>
        <div
          style={{
            padding: 16,
            display: "grid",
            gridTemplateColumns: "repeat(4,minmax(0,1fr))",
            gap: 12,
            alignItems: "end",
          }}
        >
          <label>
            <span className="label">接粉员</span>
            <select
              className="field"
              style={{ width: "100%" }}
              value={handoffDraft.receptionistId}
              onChange={(e) => {
                setHandoffDraft({
                  ...handoffDraft,
                  receptionistId: e.target.value,
                });
                setHandoffPreviewCount(null);
              }}
            >
              <option value="">请选择</option>
              {members
                .filter((m) => m.positions.includes("RECEPTION"))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="label">原炒群负责人</span>
            <select
              className="field"
              style={{ width: "100%" }}
              value={handoffDraft.fromGroupOperatorId}
              onChange={(e) => {
                setHandoffDraft({
                  ...handoffDraft,
                  fromGroupOperatorId: e.target.value,
                });
                setHandoffPreviewCount(null);
              }}
            >
              <option value="">请选择</option>
              {groupOperators.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">新炒群负责人</span>
            <select
              className="field"
              style={{ width: "100%" }}
              value={handoffDraft.toGroupOperatorId}
              onChange={(e) => {
                setHandoffDraft({
                  ...handoffDraft,
                  toGroupOperatorId: e.target.value,
                });
                setHandoffPreviewCount(null);
              }}
            >
              <option value="">请选择</option>
              {groupOperators
                .filter((m) => m.id !== handoffDraft.fromGroupOperatorId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            className="btn"
            data-variant="primary"
            disabled={handoffBusy}
            onClick={async () => {
              if (
                !handoffDraft.receptionistId ||
                !handoffDraft.fromGroupOperatorId ||
                !handoffDraft.toGroupOperatorId
              ) {
                onToast("请完整选择接粉员、新旧炒群负责人", "warn");
                return;
              }
              setHandoffBusy(true);
              try {
                setHandoffPreviewCount(await onPreviewHandoff(handoffDraft));
              } catch (caught) {
                onToast(
                  caught instanceof Error ? caught.message : "预览失败",
                  "warn",
                );
              } finally {
                setHandoffBusy(false);
              }
            }}
          >
            {handoffBusy ? "正在查询…" : "预览交接数量"}
          </button>
        </div>
        {handoffPreviewCount !== null ? (
          <div
            style={{
              margin: "0 16px 16px",
              padding: 14,
              border: "1px solid var(--warn-line)",
              background: "var(--warn-soft)",
              borderRadius: 10,
            }}
          >
            <strong>将交接 {handoffPreviewCount} 个在办客户</strong>
            <div
              style={{
                display: "flex",
                gap: 10,
                marginTop: 10,
                alignItems: "end",
              }}
            >
              <label style={{ flex: 1 }}>
                <span className="label">交接原因</span>
                <input
                  className="field"
                  style={{ width: "100%" }}
                  value={handoffDraft.reason}
                  onChange={(e) =>
                    setHandoffDraft({ ...handoffDraft, reason: e.target.value })
                  }
                  placeholder="至少填写2个字"
                />
              </label>
              <button
                className="btn"
                data-variant="primary"
                data-confirm-action="交接在办客户"
                data-confirm-description="确认后，预览到的在办客户会改由新炒群负责人承接。"
                disabled={handoffBusy || handoffDraft.reason.trim().length < 2}
                onClick={async () => {
                  setHandoffBusy(true);
                  try {
                    const count = await onConfirmHandoff({
                      ...handoffDraft,
                      expectedCount: handoffPreviewCount,
                    });
                    onToast(`已交接 ${count} 个在办客户`);
                    setHandoffPreviewCount(null);
                    setHandoffDraft({
                      receptionistId: "",
                      fromGroupOperatorId: "",
                      toGroupOperatorId: "",
                      reason: "",
                    });
                  } catch (caught) {
                    onToast(
                      caught instanceof Error
                        ? caught.message
                        : "交接失败，请重新预览",
                      "warn",
                    );
                    setHandoffPreviewCount(null);
                  } finally {
                    setHandoffBusy(false);
                  }
                }}
              >
                确认交接
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {onSubmitTransfer ? (
        <div className="card">
          <div className="card-head">
            <div>
              <h2 className="card-title">转岗记录</h2>
              <p className="card-note">
                转岗前必须先交接在办客户；旧岗位期间的历史成绩不会因转岗消失，留在旧榜单里。
              </p>
            </div>
          </div>
          <div
            style={{
              padding: transfers.length ? 0 : "30px 0",
              textAlign: transfers.length ? undefined : "center",
              color: "var(--ink-3)",
              fontSize: 13,
            }}
          >
            {transfers.length
              ? transfers.map((t) => {
                  const m = members.find((x) => x.id === t.memberId);
                  const handoffName = t.handoffToId
                    ? members.find((x) => x.id === t.handoffToId)?.name
                    : null;
                  return (
                    <div
                      key={t.id}
                      style={{
                        padding: "12px 16px",
                        borderBottom: "1px solid var(--line)",
                        fontSize: 13.5,
                      }}
                    >
                      <strong>{m?.name}</strong>
                      <span style={{ color: "var(--ink-3)" }}>
                        ：{t.fromLabel} → {t.toLabel} · 生效 {t.effectiveDate}
                      </span>
                      {handoffName ? (
                        <span style={{ color: "var(--ink-3)" }}>
                          {" "}
                          · 交接给 {handoffName}
                        </span>
                      ) : null}
                      <p style={{ margin: "3px 0 0", color: "var(--ink-3)" }}>
                        {t.reason}
                      </p>
                    </div>
                  );
                })
              : "暂无转岗记录"}
          </div>
        </div>
      ) : null}

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

      {/* 发起转岗弹窗 */}
      <Modal
        open={Boolean(transferDraft && transferMember)}
        onClose={() => setTransferDraft(null)}
        title={`发起转岗 · ${transferMember?.name ?? ""}`}
        note="修改目标岗位、生效日期，手上有在办客户必须选交接对象才能提交。"
      >
        {transferDraft && transferMember ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="label">转去哪些岗位</label>
              <PositionPicker
                value={transferDraft.toPositions}
                onToggle={(p) =>
                  setTransferDraft({
                    ...transferDraft,
                    toPositions: togglePositionValue(
                      transferDraft.toPositions,
                      p,
                    ),
                  })
                }
              />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <div>
                <label className="label">生效日期</label>
                <input
                  className="field"
                  type="date"
                  style={{ width: "100%" }}
                  value={transferDraft.effectiveDate}
                  onChange={(e) =>
                    setTransferDraft({
                      ...transferDraft,
                      effectiveDate: e.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label className="label">交接给谁 *（有在办客户必须选）</label>
                <select
                  className="field"
                  style={{ width: "100%" }}
                  value={transferDraft.handoffToId}
                  onChange={(e) =>
                    setTransferDraft({
                      ...transferDraft,
                      handoffToId: e.target.value,
                    })
                  }
                >
                  <option value="">未选择</option>
                  {members
                    .filter((x) => x.id !== transferMember.id)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label">转岗原因</label>
              <input
                className="field"
                style={{ width: "100%" }}
                placeholder="必填"
                value={transferDraft.reason}
                onChange={(e) =>
                  setTransferDraft({ ...transferDraft, reason: e.target.value })
                }
              />
            </div>
            <div
              style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}
            >
              <button className="btn" onClick={() => setTransferDraft(null)}>
                取消
              </button>
              <button
                className="btn"
                data-variant="primary"
                onClick={submitTransfer}
              >
                <IconCheck size={15} />
                提交转岗
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
