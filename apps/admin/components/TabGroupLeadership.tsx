"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { IconCheck, IconKey, IconPlus } from "./Icons";
import {
  MY_DEPARTMENT_TIMEZONE, MY_TEAM_GROUP, TODAY,
  type CrossGroupTransfer, type Member, type TeamGroup,
} from "@/lib/mock-data";

function Badge({ children, tone }: { children: React.ReactNode; tone?: "ok" | "warn" | "mute" }) {
  return <span className="badge" data-tone={tone ?? "mute"}>{children}</span>;
}

/** 组长与人事——部门管理员对本部门组织结构的直接操作权：任免各组组长、发起跨组调组
 *  （需求文档 5.x，明确是"直接操作"，不是走审批流程）。客户数据本身对部门管理员仍然
 *  只读，这个页面管的是"人属于哪个组、谁是组长"，不碰任何客户记录——所以放在导航的
 *  "组织管理"分组下，跟"日常工作"里的只读页面分开。
 *
 *  两个动作都照抄组员管理里"开通账号"/"发起转岗"的两步交互：Modal 填自由表单 →
 *  ConfirmDialog 二次确认才真正生效。任免组长对德国一组可以从真实花名册里选人，
 *  德国二组/三组没有真实花名册，用姓名占位输入代替。发起调组只演示流程：不会真的
 *  改变目标组的汇总数字，也不会把这个人塞进目标组的花名册。 */
export function TabGroupLeadership({
  teamGroups, members, crossGroupTransfers,
  onAppointLead, onSubmitCrossGroupTransfer, onCreateGroup, onCreateGroupLeadAccount,
  onToast, onConfirm,
  transferScopeLabel = "部门内",
}: {
  teamGroups: TeamGroup[];
  members: Member[];
  crossGroupTransfers: CrossGroupTransfer[];
  onAppointLead: (groupId: string, leadMemberId: string | null, leadName: string) => void;
  onSubmitCrossGroupTransfer: (draft: { memberId: string; fromLabel: string; toLabel: string; effectiveDate: string; reason: string }) => void;
  onCreateGroup: (name: string) => void;
  onCreateGroupLeadAccount: (draft: { name: string; username: string; groupId: string }) => string;
  onToast: (msg: string, tone?: "ok" | "warn") => void;
  onConfirm: (c: Confirm) => void;
  /** "发起调组"文案里"调往 XX 其它小组"的范围描述——部门管理员用这个组件时 teamGroups
   *  只有本部门的组，文案是"部门内"；公司管理员越级复用同一个组件时（需求文档 5.6）
   *  teamGroups 是未过滤的全公司列表，调组目标可能跨部门/跨国，传"公司内"避免文案
   *  说小话。发起调组的来源组固定是 {MY_TEAM_GROUP}——这是本地演示数据里唯一有真实
   *  花名册可选人的组，两种角色复用时都一样，只是目的地范围的描述不同，仅影响文案，
   *  不影响这个演示流程本身的行为。 */
  transferScopeLabel?: string;
}) {
  const [appointGroupId, setAppointGroupId] = useState<string | null>(null);
  const [appointMemberId, setAppointMemberId] = useState("");
  const [appointFreeName, setAppointFreeName] = useState("");

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferDraft, setTransferDraft] = useState({ memberId: "", toGroupId: "", effectiveDate: TODAY, reason: "" });

  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  const [newLeadAccountOpen, setNewLeadAccountOpen] = useState(false);
  const [newLeadAccountDraft, setNewLeadAccountDraft] = useState({ name: "", username: "", groupId: "" });
  const [createdBanner, setCreatedBanner] = useState<{ name: string; username: string; password: string } | null>(null);

  const vacantGroups = teamGroups.filter((g) => !g.hasDetailData && !g.leadMemberId);

  const appointGroup = appointGroupId ? teamGroups.find((g) => g.id === appointGroupId) ?? null : null;
  const destinationGroups = teamGroups.filter((g) => g.name !== MY_TEAM_GROUP);

  function openAppoint(g: TeamGroup) {
    setAppointGroupId(g.id);
    setAppointMemberId(g.hasDetailData ? (g.leadMemberId ?? "") : "");
    setAppointFreeName(g.hasDetailData ? "" : g.leadName);
  }

  function submitAppoint() {
    if (!appointGroup) return;
    const leadMemberId = appointGroup.hasDetailData ? (appointMemberId || null) : null;
    const leadName = appointGroup.hasDetailData
      ? (members.find((m) => m.id === appointMemberId)?.name ?? "")
      : appointFreeName.trim();
    if (!leadName) { onToast("请选择或填写新组长人选", "warn"); return; }
    onConfirm({
      title: "确认任免组长", confirmLabel: "确认任命", target: `${appointGroup.name} · ${leadName}`,
      desc: `将 ${appointGroup.name} 的组长设为 ${leadName}${appointGroup.leadName ? `，原组长 ${appointGroup.leadName} 自动卸任` : ""}，此操作立即生效。`,
      onConfirm: () => {
        onAppointLead(appointGroup.id, leadMemberId, leadName);
        setAppointGroupId(null);
      },
    });
  }

  function openTransfer() {
    setTransferDraft({ memberId: "", toGroupId: "", effectiveDate: TODAY, reason: "" });
    setTransferOpen(true);
  }

  function submitTransferDraft() {
    const member = members.find((m) => m.id === transferDraft.memberId);
    const toGroup = teamGroups.find((g) => g.id === transferDraft.toGroupId);
    if (!member) { onToast("请选择要调动的组员", "warn"); return; }
    if (!toGroup) { onToast("请选择目标小组", "warn"); return; }
    if (!transferDraft.reason.trim()) { onToast("请填调组原因", "warn"); return; }
    onConfirm({
      title: "确认发起调组", confirmLabel: "确认调组", target: `${member.name} → ${toGroup.name}`, danger: true,
      desc: `将 ${member.name} 从 ${MY_TEAM_GROUP} 调至 ${toGroup.name}，生效日 ${transferDraft.effectiveDate}。仅演示流程，不会真的迁移这个人的历史成绩，也不会把他加进目标组的花名册。`,
      onConfirm: () => {
        onSubmitCrossGroupTransfer({
          memberId: member.id, fromLabel: MY_TEAM_GROUP, toLabel: toGroup.name,
          effectiveDate: transferDraft.effectiveDate, reason: transferDraft.reason.trim(),
        });
        setTransferOpen(false);
      },
    });
  }

  function submitNewGroup() {
    const name = newGroupName.trim();
    if (!name) { onToast("请填小组名称", "warn"); return; }
    onConfirm({
      title: "确认新建小组", confirmLabel: "确认新建", target: name,
      desc: `新建小组「${name}」，暂无组长、暂无数据，之后可以用"开设组长账号"给它配一个组长。`,
      onConfirm: () => {
        onCreateGroup(name);
        setNewGroupOpen(false);
        setNewGroupName("");
      },
    });
  }

  function submitNewLeadAccount() {
    const group = teamGroups.find((g) => g.id === newLeadAccountDraft.groupId);
    if (!newLeadAccountDraft.name.trim()) { onToast("请填组长姓名", "warn"); return; }
    if (!newLeadAccountDraft.username.trim()) { onToast("请填用户名", "warn"); return; }
    if (!group) { onToast("请选择要配组长的小组", "warn"); return; }
    onConfirm({
      title: "确认开设组长账号", confirmLabel: "确认开设", target: `${group.name} · ${newLeadAccountDraft.name}`,
      desc: `给「${group.name}」开设组长账号，账号开通后会生成初始密码。`,
      onConfirm: () => {
        const password = onCreateGroupLeadAccount({
          name: newLeadAccountDraft.name.trim(), username: newLeadAccountDraft.username.trim(), groupId: group.id,
        });
        setCreatedBanner({ name: newLeadAccountDraft.name.trim(), username: newLeadAccountDraft.username.trim(), password });
        setNewLeadAccountOpen(false);
        setNewLeadAccountDraft({ name: "", username: "", groupId: "" });
        onToast(`已给 ${group.name} 开设组长账号`);
      },
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {createdBanner ? (
        <div className="card" style={{ background: "var(--ok-soft)", borderColor: "var(--ok-line)" }}>
          <div style={{ padding: 16, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: "var(--ok)" }}>
                {createdBanner.name} 的组长账号开通好了，把下面这份信息发给本人
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 13.5 }}>
                用户名：<strong className="tnum">{createdBanner.username}</strong>
                <span style={{ margin: "0 10px", color: "var(--ink-3)" }}>·</span>
                初始密码：<strong className="tnum">{createdBanner.password}</strong>
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>首次登录必须修改密码，这份信息离开这页就看不到了。</p>
            </div>
            <button className="btn" data-size="sm" onClick={() => setCreatedBanner(null)}>我记下了</button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">组长与人事</h2>
            <p className="card-note">直接任免各组组长——客户数据本身仍然只读，这里管的是组织结构，不碰任何客户记录。</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" data-size="sm" onClick={() => { setNewGroupName(""); setNewGroupOpen(true); }}>
              <IconPlus size={13} />开设小组
            </button>
            <button className="btn" data-size="sm" data-variant="primary"
              onClick={() => { setNewLeadAccountDraft({ name: "", username: "", groupId: vacantGroups[0]?.id ?? "" }); setNewLeadAccountOpen(true); }}>
              <IconKey size={13} />开设组长账号
            </button>
          </div>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none" }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>小组</th>
                <th>现任组长</th>
                <th>组员规模</th>
                <th style={{ width: 120 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {teamGroups.map((g) => (
                <tr key={g.id}>
                  <td style={{ fontWeight: 600 }}>
                    {g.name}
                    {g.hasDetailData ? <span style={{ marginLeft: 6 }}><Badge tone="ok">有完整明细</Badge></span> : null}
                  </td>
                  <td>{g.leadName ? g.leadName : <Badge tone="warn">空缺</Badge>}</td>
                  <td className="tnum">{g.hasDetailData ? `${members.length} 人` : "—"}</td>
                  <td>
                    <button className="btn" data-size="sm" onClick={() => openAppoint(g)}>任免组长</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">发起调组</h2>
            <p className="card-note">
              把 {MY_TEAM_GROUP} 的组员调去{transferScopeLabel}其它小组——仅演示流程，不会改变目标组的汇总数字，也不会把这个人加进目标组的花名册。
            </p>
          </div>
          <button className="btn" data-size="sm" data-variant="primary" onClick={openTransfer}>
            <IconPlus size={13} />发起调组
          </button>
        </div>
        <div style={{ padding: crossGroupTransfers.length ? 0 : "30px 0", textAlign: crossGroupTransfers.length ? undefined : "center", color: "var(--ink-3)", fontSize: 13 }}>
          {crossGroupTransfers.length ? crossGroupTransfers.map((t) => {
            const m = members.find((x) => x.id === t.memberId);
            return (
              <div key={t.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", fontSize: 13.5 }}>
                <strong>{m?.name ?? t.memberId}</strong>
                <span style={{ color: "var(--ink-3)" }}>：{t.fromLabel} → {t.toLabel} · 生效 {t.effectiveDate}</span>
                <p style={{ margin: "3px 0 0", color: "var(--ink-3)" }}>{t.reason}</p>
              </div>
            );
          }) : "暂无调组记录"}
        </div>
      </div>

      {/* 任免组长弹窗 */}
      <Modal open={Boolean(appointGroup)} onClose={() => setAppointGroupId(null)}
        title={`任免组长 · ${appointGroup?.name ?? ""}`} note="选定人选后需要再确认一步才会真正生效。">
        {appointGroup ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="label">现任组长</label>
              <p style={{ margin: 0, fontSize: 13.5 }}>{appointGroup.leadName || "空缺"}</p>
            </div>
            {appointGroup.hasDetailData ? (
              <div>
                <label className="label">新组长 *</label>
                <select className="field" style={{ width: "100%" }}
                  value={appointMemberId} onChange={(e) => setAppointMemberId(e.target.value)}>
                  <option value="">请选择</option>
                  {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="label">新组长姓名 *（该组暂无系统账号，先用姓名占位）</label>
                <input className="field" style={{ width: "100%" }} placeholder="必填"
                  value={appointFreeName} onChange={(e) => setAppointFreeName(e.target.value)} />
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={() => setAppointGroupId(null)}>取消</button>
              <button className="btn" data-variant="primary" onClick={submitAppoint}>
                <IconCheck size={15} />提交
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 发起调组弹窗 */}
      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="发起调组"
        note={`从 ${MY_TEAM_GROUP} 调往${transferScopeLabel}其它小组，仅演示流程。`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">调动组员 *（仅{MY_TEAM_GROUP}有完整名单可选）</label>
            <select className="field" style={{ width: "100%" }}
              value={transferDraft.memberId} onChange={(e) => setTransferDraft({ ...transferDraft, memberId: e.target.value })}>
              <option value="">请选择</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="label">调往小组 *</label>
              <select className="field" style={{ width: "100%" }}
                value={transferDraft.toGroupId} onChange={(e) => setTransferDraft({ ...transferDraft, toGroupId: e.target.value })}>
                <option value="">请选择</option>
                {destinationGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">生效日期</label>
              <input className="field" type="date" style={{ width: "100%" }}
                value={transferDraft.effectiveDate} onChange={(e) => setTransferDraft({ ...transferDraft, effectiveDate: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">调组原因 *</label>
            <input className="field" style={{ width: "100%" }} placeholder="必填"
              value={transferDraft.reason} onChange={(e) => setTransferDraft({ ...transferDraft, reason: e.target.value })} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setTransferOpen(false)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitTransferDraft}>
              <IconCheck size={15} />提交调组
            </button>
          </div>
        </div>
      </Modal>

      {/* 开设小组弹窗 */}
      <Modal open={newGroupOpen} onClose={() => setNewGroupOpen(false)} title="开设小组"
        note="新组刚建好时没有组长、没有数据，跟真实情况一样——之后用「开设组长账号」给它配组长。">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">小组名称 *</label>
            <input className="field" style={{ width: "100%" }} placeholder="例如：德国四组"
              value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
          </div>
          <div>
            <label className="label">所属时区</label>
            <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)" }}>{MY_DEPARTMENT_TIMEZONE}</p>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
              国家属性挂在部门这一层，组跟着所属部门走，不能单独选时区。
            </p>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setNewGroupOpen(false)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitNewGroup}>
              <IconCheck size={15} />提交
            </button>
          </div>
        </div>
      </Modal>

      {/* 开设组长账号弹窗 */}
      <Modal open={newLeadAccountOpen} onClose={() => setNewLeadAccountOpen(false)} title="开设组长账号"
        note="只能给还没有组长账号的小组开设——已经有真实组长账号的小组（比如德国一组），走「任免组长」直接换人。">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">配给哪个小组 *</label>
            <select className="field" style={{ width: "100%" }}
              value={newLeadAccountDraft.groupId}
              onChange={(e) => setNewLeadAccountDraft({ ...newLeadAccountDraft, groupId: e.target.value })}>
              <option value="">请选择</option>
              {vacantGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            {!vacantGroups.length ? (
              <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
                目前没有空缺待配组长的小组——先用「开设小组」新建一个。
              </p>
            ) : null}
          </div>
          <div>
            <label className="label">组长姓名 *</label>
            <input className="field" style={{ width: "100%" }} placeholder="必填"
              value={newLeadAccountDraft.name} onChange={(e) => setNewLeadAccountDraft({ ...newLeadAccountDraft, name: e.target.value })} />
          </div>
          <div>
            <label className="label">用户名 *</label>
            <input className="field" style={{ width: "100%" }} placeholder="必填，登录用"
              value={newLeadAccountDraft.username} onChange={(e) => setNewLeadAccountDraft({ ...newLeadAccountDraft, username: e.target.value })} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setNewLeadAccountOpen(false)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitNewLeadAccount}>
              <IconCheck size={15} />提交
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
