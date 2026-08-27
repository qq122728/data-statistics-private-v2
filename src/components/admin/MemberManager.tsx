"use client";

import { Info, Plus } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MemberDrawer } from "./MemberDrawer";
import { MemberTransferDialog } from "./MemberTransferDialog";
import {
  adminRoleOptions,
  MemberTable,
  type AdminDepartment,
  type AdminGroup,
  type AdminMember,
  type ResourceChannelOption,
} from "./MemberTable";
import { adminMutationSuccessMessage, requestAdminMutation } from "./admin-display";

export function MemberManager({ members, groups, departments, resourceChannels, stageContext }: { members: AdminMember[]; groups: AdminGroup[]; departments: AdminDepartment[]; resourceChannels: ResourceChannelOption[]; stageContext: { businessDate: string; trainingDays: number; observationDays: number } }) {
  const router = useRouter(); const [drawer, setDrawer] = useState<AdminMember | "new" | null>(null);
  const [transferMember, setTransferMember] = useState<AdminMember | null>(null);
  const [search, setSearch] = useState(""); const [group, setGroup] = useState(""); const [role, setRole] = useState(""); const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const filtered = useMemo(() => members.filter((member) => {
    const query = search.trim().toLowerCase();
    return (!query || `${member.employeeCode ?? ""} ${member.name} ${member.username}`.toLowerCase().includes(query)) && (!group || member.groupId === group) && (!role || member.role === role) && (!status || String(member.active) === status);
  }), [members, search, group, role, status]);
  const selected = drawer === "new" || drawer === null ? null : drawer;

  function openDrawer(value: AdminMember | "new") { setNotice(""); setDrawer(value); }
  async function save(body: object) {
    const name = typeof (body as { name?: unknown }).name === "string" ? (body as { name: string }).name : selected?.name ?? "成员";
    await requestAdminMutation("/api/admin/users", selected ? { id: selected.id, ...body } : body, selected ? "PATCH" : "POST");
    setNotice(adminMutationSuccessMessage("member", selected ? "update" : "create", name)); setDrawer(null); router.refresh();
  }
  async function action(body: object) {
    if (!selected) return;
    await requestAdminMutation("/api/admin/users", { id: selected.id, ...body }, "PATCH");
    const data = body as { password?: unknown; active?: unknown };
    const mutation = Object.prototype.hasOwnProperty.call(data, "password") ? "reset" : data.active === true ? "enable" : "disable";
    setNotice(adminMutationSuccessMessage("member", mutation, selected.name)); setDrawer(null); router.refresh();
  }
  async function transfer(body: object) {
    if (!transferMember) return;
    await requestAdminMutation("/api/admin/users/transfer", body, "POST");
    setNotice(`已办理“${transferMember.name}”的人员调动，旧客户和旧业绩仍保留在原小组`);
    setTransferMember(null);
    router.refresh();
  }

  return <section>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-2xl font-bold text-slate-950">成员与权限</h2><p className="mt-1 text-sm text-slate-600">管理成员资料、角色、分组与登录状态。</p></div><button type="button" onClick={() => openDrawer("new")} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"><Plus size={17} weight="bold" aria-hidden="true" />添加成员</button></div>
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900"><Info size={20} weight="fill" className="mt-0.5 shrink-0 text-blue-600" aria-hidden="true" /><p>成员可在“数据录入”中创建本小组渠道；不会自动出现在其他公司。管理员可在系统设置中控制此权限。</p></div>
    {notice && <p role="status" className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
    <div className="mb-4 grid gap-3 md:grid-cols-4"><input aria-label="搜索成员" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索代号、姓名或账号" className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm" /><select aria-label="按小组筛选" value={group} onChange={(e) => setGroup(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">全部小组</option>{groups.map((item) => <option key={item.id} value={item.id}>{item.departmentName ? `${item.departmentName} / ` : ""}{item.name}</option>)}</select><select aria-label="按角色筛选" value={role} onChange={(e) => setRole(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">全部角色</option>{adminRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><select aria-label="按状态筛选" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">全部状态</option><option value="true">启用</option><option value="false">停用</option></select></div>
    <MemberTable members={filtered} onEdit={openDrawer} onTransfer={(member) => { setNotice(""); setTransferMember(member); }} /><p className="mt-3 text-sm text-slate-500">共 {filtered.length} 位成员</p>
    {drawer && <MemberDrawer member={selected} groups={groups} departments={departments} resourceChannels={resourceChannels} stageContext={stageContext} onClose={() => setDrawer(null)} onSave={save} onAction={action} />}
    {transferMember ? <MemberTransferDialog member={transferMember} members={members} groups={groups} businessDate={stageContext.businessDate} onClose={() => setTransferMember(null)} onSave={transfer} /> : null}
  </section>;
}
