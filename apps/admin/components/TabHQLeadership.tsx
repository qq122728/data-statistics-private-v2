"use client";

import { useState } from "react";
import type { Confirm } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { TabCompanyLeadership } from "./TabCompanyLeadership";
import { IconCheck, IconPlus } from "./Icons";
import {
  type Company, type CrossGroupTransfer, type Department, type Member, type TeamGroup,
} from "@/lib/mock-data";

/** 新建部门时可选的时区列表——这是全应用唯一一处时区真的是表单选择项（需求文档 1.2、
 *  5.6），跟 TabGroupLeadership 建组时时区只读展示、继承自所属部门是两回事。列表随便
 *  编几个有代表性的即可，不需要穷举全球时区。 */
const TIMEZONE_OPTIONS = [
  "德国时间（UTC+1）", "美国东部时间（UTC-5）", "英国时间（UTC+0）", "日本时间（UTC+9）", "新加坡时间（UTC+8）",
];

/** 全局人事——总公司管理员对组织结构"可越级"的顶层操作权（需求文档 5.6），分三段：
 *  1) 任免各公司的公司管理员（本页新增）——公司这一层还没有真实账号系统可选人，照抄
 *     部门管理员/组长任免时对没有真实花名册的对象的处理方式，用姓名占位输入代替；
 *  2) 直接复用 TabCompanyLeadership，但传全总公司未过滤的 departments/teamGroups
 *     （公司管理员那边传的是过滤到自己公司的子集）——这是再往下一层的"可越级"：总公司
 *     管理员不用先经过公司管理员，能直接任免任意公司任意部门的部门管理员、任意小组的
 *     组长。TabCompanyLeadership 原本的文案是"本公司""公司内"，这里用它新开的
 *     scopeLabel/transferScopeLabel/companyNameOf 三个纯 copy 用的可选 prop 换成
 *     "全总公司"口径，不重写它的内部逻辑；
 *  3) 新建公司/新建部门——这是下级角色都没有的新能力。新建公司一步到位（填公司名称+
 *     负责人姓名，不像组长开号那样单独拆一步"开设账号"，保持简单）；新建部门要选所属
 *     公司和时区（时区是全应用唯一一处真正的表单选择，其余地方时区都是继承展示）。
 *     新建的公司/部门都从空白的组织单元开始（部门管理员/组长空缺、部门零小组），不
 *     预先编一份假花名册——零小组的部门往下钻由 TabDepartmentDrilldown 自己的空状态
 *     兜底，本组件不用管。 */
export function TabHQLeadership({
  companies, departments, teamGroups, members, crossGroupTransfers,
  onAppointCompanyManager, onAppointDepartmentManager, onAppointLead, onSubmitCrossGroupTransfer,
  onCreateGroup, onCreateGroupLeadAccount, onCreateCompany, onCreateDepartment,
  onToast, onConfirm,
}: {
  companies: Company[];
  departments: Department[];
  teamGroups: TeamGroup[];
  members: Member[];
  crossGroupTransfers: CrossGroupTransfer[];
  onAppointCompanyManager: (companyId: string, managerName: string) => void;
  onAppointDepartmentManager: (departmentId: string, managerName: string) => void;
  onAppointLead: (groupId: string, leadMemberId: string | null, leadName: string) => void;
  onSubmitCrossGroupTransfer: (draft: { memberId: string; fromLabel: string; toLabel: string; effectiveDate: string; reason: string }) => void;
  onCreateGroup: (name: string) => void;
  onCreateGroupLeadAccount: (draft: { name: string; username: string; groupId: string }) => string;
  onCreateCompany: (name: string, managerName: string) => void;
  onCreateDepartment: (name: string, companyId: string, timezone: string) => void;
  onToast: (msg: string, tone?: "ok" | "warn") => void;
  onConfirm: (c: Confirm) => void;
}) {
  const [appointCoId, setAppointCoId] = useState<string | null>(null);
  const [appointName, setAppointName] = useState("");

  const [newCoOpen, setNewCoOpen] = useState(false);
  const [newCoDraft, setNewCoDraft] = useState({ name: "", managerName: "" });

  const [newDeptOpen, setNewDeptOpen] = useState(false);
  const [newDeptDraft, setNewDeptDraft] = useState({ name: "", companyId: "", timezone: TIMEZONE_OPTIONS[0] });

  const appointCo = appointCoId ? companies.find((c) => c.id === appointCoId) ?? null : null;
  const companyNameOf = (companyId: string) => companies.find((c) => c.id === companyId)?.name ?? companyId;

  function openAppoint(c: Company) {
    setAppointCoId(c.id);
    setAppointName(c.managerName);
  }

  function submitAppoint() {
    if (!appointCo) return;
    const name = appointName.trim();
    if (!name) { onToast("请填写新公司管理员姓名", "warn"); return; }
    onConfirm({
      title: "确认任免公司管理员", confirmLabel: "确认任命", target: `${appointCo.name} · ${name}`,
      desc: `将 ${appointCo.name} 的公司管理员设为 ${name}${appointCo.managerName ? `，原公司管理员 ${appointCo.managerName} 自动卸任` : ""}，此操作立即生效。`,
      onConfirm: () => {
        onAppointCompanyManager(appointCo.id, name);
        setAppointCoId(null);
      },
    });
  }

  function submitNewCompany() {
    const name = newCoDraft.name.trim();
    const managerName = newCoDraft.managerName.trim();
    if (!name) { onToast("请填公司名称", "warn"); return; }
    if (!managerName) { onToast("请填负责人姓名", "warn"); return; }
    onConfirm({
      title: "确认新建公司", confirmLabel: "确认新建", target: `${name} · ${managerName}`,
      desc: `新建公司「${name}」，公司管理员设为 ${managerName}，此操作立即生效。`,
      onConfirm: () => {
        onCreateCompany(name, managerName);
        setNewCoOpen(false);
        setNewCoDraft({ name: "", managerName: "" });
      },
    });
  }

  function submitNewDept() {
    const name = newDeptDraft.name.trim();
    const company = companies.find((c) => c.id === newDeptDraft.companyId);
    if (!name) { onToast("请填部门名称", "warn"); return; }
    if (!company) { onToast("请选择所属公司", "warn"); return; }
    onConfirm({
      title: "确认新建部门", confirmLabel: "确认新建", target: `${company.name} · ${name}`,
      desc: `在 ${company.name} 下新建部门「${name}」，时区设为 ${newDeptDraft.timezone}，暂无部门管理员、暂无小组，之后可以用"任免部门管理员""开设小组"继续配置。`,
      onConfirm: () => {
        onCreateDepartment(name, company.id, newDeptDraft.timezone);
        setNewDeptOpen(false);
        setNewDeptDraft({ name: "", companyId: "", timezone: TIMEZONE_OPTIONS[0] });
      },
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">公司管理员人事</h2>
            <p className="card-note">直接任免各公司的公司管理员——公司这一层还没有真实账号系统，先用姓名占位。</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" data-size="sm" onClick={() => { setNewCoDraft({ name: "", managerName: "" }); setNewCoOpen(true); }}>
              <IconPlus size={13} />新建公司
            </button>
            <button className="btn" data-size="sm" data-variant="primary"
              onClick={() => { setNewDeptDraft({ name: "", companyId: companies[0]?.id ?? "", timezone: TIMEZONE_OPTIONS[0] }); setNewDeptOpen(true); }}>
              <IconPlus size={13} />新建部门
            </button>
          </div>
        </div>
        <div className="table-scroll" style={{ maxHeight: "none" }}>
          <table className="grid-table">
            <thead>
              <tr>
                <th>公司</th>
                <th>现任公司管理员</th>
                <th>下辖部门数</th>
                <th style={{ width: 140 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.managerName ? c.managerName : <span className="badge" data-tone="warn">空缺</span>}</td>
                  <td className="tnum">{departments.filter((d) => d.companyId === c.id).length} 个</td>
                  <td>
                    <button className="btn" data-size="sm" onClick={() => openAppoint(c)}>任免公司管理员</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <TabCompanyLeadership
        departments={departments} teamGroups={teamGroups} members={members} crossGroupTransfers={crossGroupTransfers}
        onAppointDepartmentManager={onAppointDepartmentManager}
        onAppointLead={onAppointLead} onSubmitCrossGroupTransfer={onSubmitCrossGroupTransfer}
        onCreateGroup={onCreateGroup} onCreateGroupLeadAccount={onCreateGroupLeadAccount}
        onToast={onToast} onConfirm={onConfirm}
        scopeLabel="全总公司"
        transferScopeLabel="全总公司范围内"
        companyNameOf={companyNameOf}
      />

      {/* 任免公司管理员弹窗 */}
      <Modal open={Boolean(appointCo)} onClose={() => setAppointCoId(null)}
        title={`任免公司管理员 · ${appointCo?.name ?? ""}`} note="选定人选后需要再确认一步才会真正生效。">
        {appointCo ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label className="label">现任公司管理员</label>
              <p style={{ margin: 0, fontSize: 13.5 }}>{appointCo.managerName || "空缺"}</p>
            </div>
            <div>
              <label className="label">新公司管理员姓名 *（公司层暂无系统账号，先用姓名占位）</label>
              <input className="field" style={{ width: "100%" }} placeholder="必填"
                value={appointName} onChange={(e) => setAppointName(e.target.value)} />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn" onClick={() => setAppointCoId(null)}>取消</button>
              <button className="btn" data-variant="primary" onClick={submitAppoint}>
                <IconCheck size={15} />提交
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 新建公司弹窗 */}
      <Modal open={newCoOpen} onClose={() => setNewCoOpen(false)} title="新建公司"
        note="一步创建公司并指定负责人，不像组长开号那样单独拆一步「开设账号」。">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">公司名称 *</label>
            <input className="field" style={{ width: "100%" }} placeholder="例如：公司C"
              value={newCoDraft.name} onChange={(e) => setNewCoDraft({ ...newCoDraft, name: e.target.value })} />
          </div>
          <div>
            <label className="label">负责人姓名 *</label>
            <input className="field" style={{ width: "100%" }} placeholder="必填，公司管理员姓名"
              value={newCoDraft.managerName} onChange={(e) => setNewCoDraft({ ...newCoDraft, managerName: e.target.value })} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setNewCoOpen(false)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitNewCompany}>
              <IconCheck size={15} />提交
            </button>
          </div>
        </div>
      </Modal>

      {/* 新建部门弹窗 */}
      <Modal open={newDeptOpen} onClose={() => setNewDeptOpen(false)} title="新建部门"
        note="新部门刚建好时没有部门管理员、没有小组，跟真实情况一样——之后用「任免部门管理员」「开设小组」继续配置。">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">部门名称 *</label>
            <input className="field" style={{ width: "100%" }} placeholder="例如：法国部"
              value={newDeptDraft.name} onChange={(e) => setNewDeptDraft({ ...newDeptDraft, name: e.target.value })} />
          </div>
          <div>
            <label className="label">所属公司 *</label>
            <select className="field" style={{ width: "100%" }}
              value={newDeptDraft.companyId} onChange={(e) => setNewDeptDraft({ ...newDeptDraft, companyId: e.target.value })}>
              <option value="">请选择</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">所属时区 *</label>
            <select className="field" style={{ width: "100%" }}
              value={newDeptDraft.timezone} onChange={(e) => setNewDeptDraft({ ...newDeptDraft, timezone: e.target.value })}>
              {TIMEZONE_OPTIONS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
            <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
              国家属性挂在部门这一层（需求文档 1.2）——这是全应用唯一一处时区真的可以选，组建组时只会继承部门的时区，不能单独选。
            </p>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setNewDeptOpen(false)}>取消</button>
            <button className="btn" data-variant="primary" onClick={submitNewDept}>
              <IconCheck size={15} />提交
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
