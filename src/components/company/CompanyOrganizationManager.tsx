"use client";

import { Buildings, Key, Plus, SpinnerGap, UsersThree, X } from "@phosphor-icons/react";
import type { Duty } from "@prisma/client";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { BUSINESS_TIMEZONE_OPTIONS, businessTimezoneOption } from "../../lib/business-time-config";
import { normalizeOrgStructure, type OrgDepartment, type OrgStructureResponse } from "../../lib/org-structure-view";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

type Editor =
  | { kind: "company" }
  | { kind: "department"; companyId: string }
  | { kind: "group"; departmentId: string }
  | { kind: "company-manager"; companyId: string }
  | { kind: "department-manager"; departmentId: string }
  | null;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "操作失败，请稍后重试");
  return payload;
}

function StatusBadge({ active }: { active: boolean }) {
  return <Badge className={active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}>{active ? "启用" : "停用"}</Badge>;
}

function editorTitle(editor: Exclude<Editor, null>) {
  if (editor.kind === "company") return "新建公司";
  if (editor.kind === "department") return "新建部门";
  if (editor.kind === "group") return "开设小组";
  if (editor.kind === "company-manager") return "开设公司管理员账号";
  return "开设部门管理员账号";
}

export function CompanyOrganizationManager({ duty }: { duty: Extract<Duty, "DEPARTMENT_MANAGER" | "COMPANY_MANAGER" | "HQ_MANAGER"> }) {
  const [payload, setPayload] = useState<OrgStructureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<Editor>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setPayload(await requestJson<OrgStructureResponse>("/api/org/structure")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "组织结构加载失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const normalized = useMemo(() => payload ? normalizeOrgStructure(payload) : { companies: [], unassignedDepartments: [] }, [payload]);
  const departmentCount = normalized.companies.reduce((count, company) => count + company.departments.length, 0) + normalized.unassignedDepartments.length;
  const canCreateCompany = duty === "HQ_MANAGER";
  const canCreateDepartment = duty === "HQ_MANAGER";
  const canCreateCompanyManager = duty === "HQ_MANAGER";
  const canCreateDepartmentManager = duty === "HQ_MANAGER" || duty === "COMPANY_MANAGER";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const data = new FormData(event.currentTarget);
    let url: string;
    let body: Record<string, string>;
    let success: string;

    if (editor.kind === "company") {
      url = "/api/org/companies";
      body = { name: String(data.get("name") ?? "") };
      success = `已新建公司“${body.name}”`;
    } else if (editor.kind === "department") {
      url = "/api/org/departments";
      body = { companyId: String(data.get("companyId") ?? editor.companyId), name: String(data.get("name") ?? ""), timezone: String(data.get("timezone") ?? "") };
      success = `已新建部门“${body.name}”`;
    } else if (editor.kind === "group") {
      url = "/api/org/groups";
      body = { departmentId: editor.departmentId, name: String(data.get("name") ?? "") };
      success = `已开设小组“${body.name}”`;
    } else if (editor.kind === "company-manager") {
      url = "/api/org/company-managers";
      body = { companyId: editor.companyId, name: String(data.get("name") ?? ""), username: String(data.get("username") ?? ""), password: String(data.get("password") ?? "") };
      success = `已开设公司管理员账号“${body.name}”`;
    } else {
      url = "/api/org/department-managers";
      body = { departmentId: editor.departmentId, name: String(data.get("name") ?? ""), username: String(data.get("username") ?? ""), password: String(data.get("password") ?? "") };
      success = `已开设部门管理员账号“${body.name}”`;
    }

    setBusy(true);
    setError("");
    try {
      await requestJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      setNotice(success);
      setEditor(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请稍后重试");
    } finally { setBusy(false); }
  }

  const scopeLabel = duty === "HQ_MANAGER" ? "总公司" : duty === "COMPANY_MANAGER" ? "本公司" : "本部门";

  return <main className="page-shell space-y-5">
    <div className="page-heading">
      <div><h1 className="page-title">组织管理</h1><p className="page-description">查看{scopeLabel}的公司、部门和小组，并按权限开设组织单元和管理账号。</p></div>
      <div className="flex flex-wrap gap-2">
        {canCreateCompany ? <Button type="button" variant="secondary" onClick={() => { setError(""); setEditor({ kind: "company" }); }}><Plus size={16} />新建公司</Button> : null}
        {canCreateDepartment ? <Button type="button" disabled={!normalized.companies.some((company) => company.active)} onClick={() => { setError(""); setEditor({ kind: "department", companyId: normalized.companies.find((company) => company.active)?.id ?? "" }); }}><Plus size={16} />新建部门</Button> : null}
      </div>
    </div>
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">大白话：这里显示的都是真实数据库数据。先建公司，再建部门，最后开小组；小组时区自动跟部门走，不能单独乱改。</div>
    {notice ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p> : null}
    {error && !editor ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><p>{error}</p><button type="button" className="mt-2 font-semibold underline" onClick={() => void load()}>重新加载</button></div> : null}
    {loading ? <div className="panel flex min-h-48 items-center justify-center gap-2 text-sm text-slate-500"><SpinnerGap className="animate-spin" size={20} />正在读取真实组织结构…</div> : null}
    {!loading && !error && departmentCount === 0 && normalized.companies.length === 0 ? <div className="panel p-10 text-center text-sm text-slate-500">当前范围还没有组织数据。{canCreateCompany ? "请先新建第一个公司。" : "请联系上级管理员完成组织绑定。"}</div> : null}

    {!loading ? normalized.companies.map((company) => <section key={company.id} className="panel overflow-hidden">
      <div className="panel-header gap-3">
        <div className="flex min-w-0 items-start gap-3"><span className="rounded-lg bg-blue-50 p-2 text-blue-700"><Buildings size={22} weight="fill" /></span><div><h2 className="panel-title">{company.name}</h2><p className="panel-subtitle">{company.departments.length} 个部门 · {company.departments.reduce((sum, department) => sum + department.groups.length, 0)} 个小组</p></div></div>
        {canCreateCompanyManager && company.id !== "department-scope" ? <Button type="button" variant="secondary" onClick={() => { setError(""); setEditor({ kind: "company-manager", companyId: company.id }); }}><Key size={15} />开公司管理员账号</Button> : null}
      </div>
      <div className="divide-y divide-slate-200">{company.departments.map((department) => <DepartmentCard key={department.id} department={department} canCreateDepartmentManager={canCreateDepartmentManager} onOpen={setEditor} />)}{!company.departments.length ? <p className="p-8 text-center text-sm text-slate-500">这家公司还没有部门</p> : null}</div>
    </section>) : null}

    {!loading && normalized.unassignedDepartments.length ? <section className="panel overflow-hidden border-amber-200">
      <div className="panel-header bg-amber-50"><div><h2 className="panel-title">待归入公司的旧部门</h2><p className="panel-subtitle">这些是历史遗留部门，目前还没有 companyId；不会偷偷合并进任何公司。</p></div></div>
      <div className="divide-y divide-slate-200">{normalized.unassignedDepartments.map((department) => <DepartmentCard key={department.id} department={department} canCreateDepartmentManager={canCreateDepartmentManager} onOpen={setEditor} />)}</div>
    </section> : null}

    {editor ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && setEditor(null)}>
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-label={editorTitle(editor)} className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-5"><div><h2 className="text-xl font-bold text-slate-950">{editorTitle(editor)}</h2><p className="mt-1 text-sm text-slate-500">保存后立即写入真实数据库。</p></div><button type="button" aria-label="关闭" disabled={busy} onClick={() => setEditor(null)} className="rounded-md p-2 text-slate-500 hover:bg-slate-100"><X size={20} /></button></header>
        <div className="space-y-4 p-6">
          {editor.kind === "department" ? <><label className="block text-sm font-semibold text-slate-700">所属公司<select name="companyId" required defaultValue={editor.companyId} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal">{normalized.companies.filter((company) => company.active).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label className="block text-sm font-semibold text-slate-700">国家/时区<select name="timezone" required defaultValue="Asia/Shanghai" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 font-normal">{BUSINESS_TIMEZONE_OPTIONS.map((option) => <option key={option.timezone} value={option.timezone}>{option.label}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">国家属性挂在部门这一层，小组会自动继承。</span></label></> : null}
          {editor.kind === "company" || editor.kind === "department" || editor.kind === "group" ? <label className="block text-sm font-semibold text-slate-700">{editor.kind === "company" ? "公司名称" : editor.kind === "department" ? "部门名称" : "小组名称"}<input name="name" required maxLength={100} autoFocus className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label> : <>
            <label className="block text-sm font-semibold text-slate-700">管理员姓名<input name="name" required maxLength={100} autoFocus className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label className="block text-sm font-semibold text-slate-700">登录账号<input name="username" required autoComplete="off" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /></label>
            <label className="block text-sm font-semibold text-slate-700">临时密码<input name="password" type="password" required minLength={12} autoComplete="new-password" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-normal" /><span className="mt-1 block text-xs font-normal text-slate-500">至少 12 位；本人首次登录必须修改。</span></label>
          </>}
          {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t px-6 py-4"><Button type="button" variant="secondary" disabled={busy} onClick={() => setEditor(null)}>取消</Button><Button disabled={busy}>{busy ? <><SpinnerGap className="animate-spin" size={16} />保存中…</> : "确认保存"}</Button></footer>
      </form>
    </div> : null}
  </main>;
}

function DepartmentCard({ department, canCreateDepartmentManager, onOpen }: { department: OrgDepartment; canCreateDepartmentManager: boolean; onOpen: (editor: Editor) => void }) {
  return <article className="p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{department.name}</h3><StatusBadge active={department.active} /><Badge>{department.countryCode}</Badge></div><p className="mt-1 text-sm text-slate-500">{businessTimezoneOption(department.timezone).label} · {department.groups.length} 个小组</p></div>
      <div className="flex flex-wrap gap-2">{canCreateDepartmentManager ? <Button type="button" variant="secondary" disabled={!department.active} onClick={() => onOpen({ kind: "department-manager", departmentId: department.id })}><Key size={15} />开部门管理员账号</Button> : null}<Button type="button" disabled={!department.active} onClick={() => onOpen({ kind: "group", departmentId: department.id })}><Plus size={15} />开设小组</Button></div>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{department.groups.map((group) => <div key={group.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 font-semibold text-slate-800"><UsersThree size={18} />{group.name}</span><StatusBadge active={group.active} /></div><p className="mt-2 text-sm text-slate-500">组长：{group.leadName ?? "空缺"}</p></div>)}{!department.groups.length ? <p className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">该部门还没有小组</p> : null}</div>
  </article>;
}
