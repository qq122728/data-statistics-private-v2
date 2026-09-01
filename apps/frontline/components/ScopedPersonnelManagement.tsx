"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { requestJson } from "@/lib/backend";
import styles from "./ScopedPersonnelManagement.module.css";

type Account = {
  id: string;
  name: string;
  username: string;
  role: string;
  duty: string | null;
  active: boolean;
  groupName: string | null;
  departmentName: string | null;
  secondaryRoles?: string[];
  updatedAt?: string;
};

const roleNames: Record<string, string> = {
  RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家", LEAD: "组长",
  RESOURCE_MANAGER: "资源部", COMPANY_MANAGER: "管理人员",
};

function roleLabel(account: Account) {
  if (account.duty === "COMPANY_MANAGER") return "公司管理员";
  if (account.duty === "DEPARTMENT_MANAGER") return "部门管理员";
  if (account.duty === "HQ_MANAGER") return "总公司管理员";
  return roleNames[account.role] ?? account.role;
}

export default function ScopedPersonnelManagement({ scopeLabel, onTransfer }: { scopeLabel: string; onTransfer?: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("active");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setError("");
    try { setAccounts(await requestJson<Account[]>("/api/org/accounts")); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "人员读取失败"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => accounts.filter((account) => {
    const keyword = `${account.name} ${account.username} ${account.groupName ?? ""} ${account.departmentName ?? ""} ${roleLabel(account)}`.toLowerCase();
    return (!search.trim() || keyword.includes(search.trim().toLowerCase()))
      && (!role || account.role === role || account.secondaryRoles?.includes(role))
      && (status === "all" || (status === "active" ? account.active : !account.active));
  }), [accounts, role, search, status]);

  async function toggle(account: Account) {
    if (account.active && !window.confirm(`确认停用 ${account.name}？\n停用后不能登录或修改数据，但历史数据会保留。`)) return;
    setBusyId(account.id); setError(""); setNotice("");
    try {
      const result = await requestJson<{ id: string; active: boolean }>("/api/org/accounts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: account.id, active: !account.active }) });
      setAccounts((current) => current.map((item) => item.id === result.id ? { ...item, active: result.active, updatedAt: new Date().toISOString() } : item));
      setNotice(`${account.name}已${result.active ? "恢复" : "停用"}，历史客户和业绩没有删除`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "账号状态修改失败"); }
    finally { setBusyId(""); }
  }

  return <section className={styles.card}>
    <header><div><h2>{scopeLabel}人员与岗位</h2><p>这里只显示当前账号有权管理的人员；停用不删除历史数据。</p></div><strong>{visible.length} 人</strong></header>
    <div className={styles.filters}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索姓名、账号、小组或部门" /><select value={role} onChange={(event) => setRole(event.target.value)}><option value="">全部岗位</option><option value="RECEPTION">接粉</option><option value="GROUP_OPERATOR">炒群</option><option value="EXPERT">专家</option><option value="LEAD">组长</option><option value="RESOURCE_MANAGER">资源部</option><option value="COMPANY_MANAGER">管理人员</option></select><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">在职账号</option><option value="inactive">已停用</option><option value="all">全部状态</option></select></div>
    {notice ? <p className={styles.notice}>{notice}</p> : null}{error ? <p className={styles.error}>{error}</p> : null}
    <div className={styles.tableWrap}><table><thead><tr><th>姓名 / 账号</th><th>组织范围</th><th>主岗位</th><th>兼职岗位</th><th>状态</th><th>最后变更</th><th>操作</th></tr></thead><tbody>{visible.map((account) => <tr key={account.id}><td><strong>{account.name}</strong><small>{account.username}</small></td><td>{account.groupName ?? account.departmentName ?? "公司范围"}</td><td>{roleLabel(account)}</td><td>{account.secondaryRoles?.length ? account.secondaryRoles.map((item) => roleNames[item] ?? item).join("、") : "—"}</td><td><span data-active={account.active}>{account.active ? "在职" : "已停用"}</span></td><td>{account.updatedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short" }).format(new Date(account.updatedAt)) : "—"}</td><td><div className={styles.actions}>{account.groupName && onTransfer ? <button onClick={onTransfer}>调整岗位</button> : <em>组织岗位</em>}<button data-danger={account.active} disabled={busyId === account.id} onClick={() => void toggle(account)}>{busyId === account.id ? "处理中…" : account.active ? "停用账号" : "恢复账号"}</button></div></td></tr>)}{!visible.length ? <tr><td colSpan={7} className={styles.empty}>当前筛选范围没有人员</td></tr> : null}</tbody></table></div>
  </section>;
}
