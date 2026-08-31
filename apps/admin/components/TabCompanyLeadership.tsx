"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { TabGroupLeadership } from "./TabGroupLeadership";
import { IconCheck } from "./Icons";
import {
  type CrossGroupTransfer, type Department, type Member, type TeamGroup,
} from "@/lib/mock-data";

/** 部门与组长人事——公司管理员对组织结构"可越级"的两层直接操作权（需求文档 5.6）：
 *  1) 任免本公司各部门的部门管理员（本页新增）——部门这一层还没有真实账号系统可选人，
 *     照抄部门管理员任免组长时对没有真实花名册的组的处理方式，用姓名占位输入代替；
 *  2) 直接复用 TabGroupLeadership，但传全公司未过滤的 teamGroups（部门管理员那边传的
 *     是过滤到自己部门的子集）——这就是"可越级"：公司管理员不用先经过部门管理员，
 *     能直接任免任意部门下任意小组的组长、发起任意跨组调组。
 *
 *  总公司管理员的"全局人事"页面（TabHQLeadership）再往上越一级复用本组件——传全总公司
 *  未过滤的 departments/teamGroups（不再限定某一家公司）。这时候硬写死的"本公司"
 *  "公司内"两处文案会不准确，所以开了 scopeLabel/transferScopeLabel/companyNameOf
 *  三个纯 copy 用的可选 prop（不传就是原来公司管理员视角的文案和展示，行为完全不变）：
 *  照抄 transferScopeLabel 在 TabGroupLeadership 里的先例，不重写本组件内部逻辑。 */
export function TabCompanyLeadership({
  departments, teamGroups, members, crossGroupTransfers,
  onAppointDepartmentManager, onAppointLead, onSubmitCrossGroupTransfer, onCreateGroup, onCreateGroupLeadAccount,
  onToast, onConfirm,
  scopeLabel = "本公司",
  transferScopeLabel = "公司内",
  companyNameOf,
}: {
  departments: Department[];
  teamGroups: TeamGroup[];
  members: Member[];
  crossGroupTransfers: CrossGroupTransfer[];
  onAppointDepartmentManager: (departmentId: string, managerName: string) => void;
  onAppointLead: (groupId: string, leadMemberId: string | null, leadName: string) => void;
  onSubmitCrossGroupTransfer: (draft: { memberId: string; fromLabel: string; toLabel: string; effectiveDate: string; reason: string }) => void;
  onCreateGroup: (name: string) => void;
  onCreateGroupLeadAccount: (draft: { name: string; username: string; groupId: string }) => string;
  onToast: (msg: string, tone?: "ok" | "warn") => void;
  onConfirm: (c: Confirm) => void;
  /** "部门管理员人事"卡片文案里"XX各部门的部门管理员"的范围描述——公司管理员用本组件时
   *  是"本公司"，总公司管理员越级复用时传"全总公司"。 */
  scopeLabel?: string;
  /** 透传给内层 TabGroupLeadership 的调组范围文案，用法跟那边完全一致。 */
  transferScopeLabel?: string;
  /** 传了就在部门名旁边多显示一下这个部门属于哪家公司——总公司管理员越级复用时
   *  departments 横跨多家公司，加这一点上下文避免看着一头雾水；公司管理员自己用时
   *  不传，部门名旁边不多这一截，跟原来完全一样。 */
  companyNameOf?: (companyId: string) => string;
}) {
  const [appointDeptId, setAppointDeptId] = useState<string | null>(null);
  const [appointName, setAppointName] = useState("");

  const appointDept = appointDeptId ? departments.find((d) => d.id === appointDeptId) ?? null : null;

  function openAppoint(d: Department) {
    setAppointDeptId(d.id);
    setAppointName(d.managerName);
  }

  function submitAppoint() {
    if (!appointDept) return;
    const name = appointName.trim();
    if (!name) { onToast("请填写新部门管理员姓名", "warn"); return; }
    onConfirm({
      title: "确认任免部门管理员", confirmLabel: "确认任命", target: `${appointDept.name} · ${name}`,
      desc: `将 ${appointDept.name} 的部门管理员设为 ${name}${appointDept.managerName ? `，原部门管理员 ${appointDept.managerName} 自动卸任` : ""}，此操作立即生效。`,
      onConfirm: () => {
        onAppointDepartmentManager(appointDept.id, name);
        setAppointDeptId(null);
      },
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">部门管理员人事</h2>
            <p className="card-note">直接任免{scopeLabel}各部门的部门管理员——部门这一层还没有真实账号系统，先用姓名占位。</p>
          </div>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none" }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>部门</th>
                <th>现任部门管理员</th>
                <th>下辖小组数</th>
                <th style={{ width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>
                    {d.name}
                    <span style={{ marginLeft: 6, fontWeight: 500, fontSize: 11.5, color: "var(--ink-3)" }}>{d.timezone}</span>
                    {companyNameOf ? (
                      <span style={{ marginLeft: 6, fontWeight: 500, fontSize: 11.5, color: "var(--ink-3)" }}>· {companyNameOf(d.companyId)}</span>
                    ) : null}
                  </td>
                  <td>{d.managerName ? d.managerName : <span className="badge" data-tone="warn">空缺</span>}</td>
                  <td className="tnum">{teamGroups.filter((g) => g.departmentId === d.id).length} 组</td>
                  <td>
                    <button className="btn" data-size="sm" onClick={() => openAppoint(d)}>任免部门管理员</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <TabGroupLeadership
        teamGroups={teamGroups} members={members} crossGroupTransfers={crossGroupTransfers}
        onAppointLead={onAppointLead} onSubmitCrossGroupTransfer={onSubmitCrossGroupTransfer}
        onCreateGroup={onCreateGroup} onCreateGroupLeadAccount={onCreateGroupLeadAccount}
        onToast={onToast} onConfirm={onConfirm}
        transferScopeLabel={transferScopeLabel}
      />

      {/* 任免部门管理员弹窗 */}
      <Modal open={Boolean(appointDept)} onClose={() => setAppointDeptId(null)}
        title={`任免部门管理员 · ${appointDept?.name ?? ""}`} note="选定人选后需要再确认一步才会真正生效。">
        {appointDept ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="label">现任部门管理员</label>
              <p style={{ margin: 0, fontSize: 13.5 }}>{appointDept.managerName || "空缺"}</p>
            </div>
            <div>
              <label className="label">新部门管理员姓名 *（部门层暂无系统账号，先用姓名占位）</label>
              <input className="field" style={{ width: "100%" }} placeholder="必填"
                value={appointName} onChange={(e) => setAppointName(e.target.value)} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={() => setAppointDeptId(null)}>取消</button>
              <button className="btn" data-variant="primary" onClick={submitAppoint}>
                <IconCheck size={15} />提交
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
