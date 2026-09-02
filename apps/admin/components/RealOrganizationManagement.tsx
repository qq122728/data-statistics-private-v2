"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { generateSecureTemporaryPassword, requestJson } from "@/lib/backend";
import { Modal } from "./Modal";
import { IconCheck, IconEdit, IconKey, IconPlus, IconTrash, IconUsers } from "./Icons";
import { PersonnelTransferPanel } from "./PersonnelTransferPanel";

type GroupNode = {
  id: string;
  name: string;
  active: boolean;
  leadId: string | null;
  leadName: string | null;
};
type DepartmentNode = {
  id: string;
  name: string;
  active: boolean;
  countryCode: string;
  timezone: string;
  companyId: string | null;
  groups: GroupNode[];
};
type CompanyNode = {
  id: string;
  name: string;
  active: boolean;
  departments: DepartmentNode[];
};
type StructureResponse = {
  companies?: CompanyNode[];
  company?: CompanyNode | null;
  department?: DepartmentNode | null;
  unassignedDepartments?: DepartmentNode[];
};
type Candidate = {
  id: string;
  name: string;
  role: string;
  groupId: string;
  groupName: string;
  alreadyLead: boolean;
  roles: string[];
};
type LeadChangePlan = { id: string; effectiveOn: string; newLeadId: string; formerLeadId: string; formerDisposition: string; reason: string; status: string };
type CreatedAccount = {
  scopeName: string;
  roleLabel: string;
  name: string;
  username: string;
  password: string;
};
type ManagerAccountTarget = {
  kind: "company" | "department";
  id: string;
  name: string;
};
type ManagedAccount = {
  id: string;
  name: string;
  username: string;
  role: string;
  duty: string | null;
  active: boolean;
  groupName: string | null;
  departmentName: string | null;
  secondaryRoles: string[];
  updatedAt: string;
};

function managedAccountRoleLabel(account: ManagedAccount): string {
  if (account.duty === "COMPANY_MANAGER") return "公司管理员";
  if (account.duty === "DEPARTMENT_MANAGER") return "部门管理员";
  if (account.duty === "HQ_MANAGER") return "总公司管理员";
  if (account.role === "LEAD") return "组长";
  if (account.role === "RECEPTION") return "接粉";
  if (account.role === "GROUP_OPERATOR") return "炒群";
  if (account.role === "EXPERT") return "专家";
  if (account.role === "RESOURCE_MANAGER") return "资源部";
  if (account.role === "FINANCE") return "财务";
  if (account.role === "ADMIN") return "系统管理员";
  return frontlineRoleLabels[account.role] ?? account.role;
}
const frontlineRoleLabels: Record<string, string> = { RECEPTION: "接粉", GROUP_OPERATOR: "炒群", EXPERT: "专家", LEAD: "组长", RESOURCE_MANAGER: "资源部" };

function normalize(payload: StructureResponse): {
  companies: CompanyNode[];
  unassigned: DepartmentNode[];
} {
  if (payload.companies)
    return {
      companies: payload.companies,
      unassigned: payload.unassignedDepartments ?? [],
    };
  if (payload.company) return { companies: [payload.company], unassigned: [] };
  if (payload.department)
    return {
      companies: [
        {
          id: payload.department.companyId ?? "department-scope",
          name: "本部门",
          active: true,
          departments: [payload.department],
        },
      ],
      unassigned: [],
    };
  return { companies: [], unassigned: [] };
}

export function RealOrganizationManagement({
  duty,
  onToast,
}: {
  duty: "DEPARTMENT_MANAGER" | "COMPANY_MANAGER" | "HQ_MANAGER";
  onToast: (message: string, tone?: "ok" | "warn") => void;
}) {
  const [payload, setPayload] = useState<StructureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createKind, setCreateKind] = useState<
    "company" | "department" | "group" | null
  >(null);
  const [createParentId, setCreateParentId] = useState("");
  const [createLeadWithGroup, setCreateLeadWithGroup] = useState(true);
  const [leadGroup, setLeadGroup] = useState<GroupNode | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [reason, setReason] = useState("");
  const [leadPlan, setLeadPlan] = useState<LeadChangePlan | null>(null);
  const [formerDisposition, setFormerDisposition] = useState("DISABLE");
  const [formerTargetGroupId, setFormerTargetGroupId] = useState("");
  const [accountGroup, setAccountGroup] = useState<GroupNode | null>(null);
  const [accountEffectiveOn, setAccountEffectiveOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [createdAccount, setCreatedAccount] = useState<CreatedAccount | null>(
    null,
  );
  const [managerAccountTarget, setManagerAccountTarget] =
    useState<ManagerAccountTarget | null>(null);
  const [editingGroup, setEditingGroup] = useState<GroupNode | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [managedAccounts, setManagedAccounts] = useState<ManagedAccount[]>([]);
  const [deletingAccount, setDeletingAccount] = useState<ManagedAccount | null>(null);
  const [accountSearch, setAccountSearch] = useState("");
  const [accountRole, setAccountRole] = useState("");
  const [accountStatus, setAccountStatus] = useState("active");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [structurePayload, accounts] = await Promise.all([
        requestJson<StructureResponse>("/api/org/structure"),
        requestJson<ManagedAccount[]>("/api/org/accounts"),
      ]);
      setPayload(structurePayload);
      setManagedAccounts(accounts);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "组织结构读取失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const structure = useMemo(() => normalize(payload ?? {}), [payload]);
  const departments = [
    ...structure.companies.flatMap((company) => company.departments),
    ...structure.unassigned,
  ];
  const allGroups = departments.flatMap((department) => department.groups);
  const visibleManagedAccounts = managedAccounts.filter((account) => {
    const haystack = `${account.name} ${account.username} ${account.groupName ?? ""} ${account.departmentName ?? ""} ${managedAccountRoleLabel(account)}`.toLowerCase();
    return (!accountSearch.trim() || haystack.includes(accountSearch.trim().toLowerCase()))
      && (!accountRole || account.role === accountRole || account.secondaryRoles.includes(accountRole))
      && (accountStatus === "all" || (accountStatus === "active" ? account.active : !account.active));
  });

  async function toggleAccountStatus(account: ManagedAccount) {
    setBusy(true); setError("");
    try {
      const result = await requestJson<{ id: string; active: boolean }>("/api/org/accounts", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: account.id, active: !account.active }) });
      setManagedAccounts((current) => current.map((item) => item.id === result.id ? { ...item, active: result.active, updatedAt: new Date().toISOString() } : item));
      onToast(`${account.name}的账号已${result.active ? "恢复" : "停用"}；历史数据保持不变`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "账号状态修改失败"); }
    finally { setBusy(false); }
  }

  async function openLead(group: GroupNode) {
    setLeadGroup(group);
    setCandidateId(group.leadId ?? "");
    setReason("");
    setEffectiveOn(new Date().toISOString().slice(0, 10));
    setFormerDisposition("DISABLE");
    setFormerTargetGroupId(group.id);
    setError("");
    setBusy(true);
    try {
      const [result, planResult] = await Promise.all([
        requestJson<{ candidates: Candidate[] }>(`/api/org/lead-candidates?groupId=${encodeURIComponent(group.id)}`),
        requestJson<{ plan: LeadChangePlan | null }>(`/api/org/groups/${encodeURIComponent(group.id)}/lead`),
      ]);
      setCandidates(result.candidates);
      setLeadPlan(planResult.plan);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "候选人员读取失败");
    } finally {
      setBusy(false);
    }
  }

  function openLeadAccount(group: GroupNode) {
    setAccountGroup(group);
    setAccountEffectiveOn(new Date().toISOString().slice(0, 10));
    setTemporaryPassword(generateSecureTemporaryPassword());
    setError("");
  }

  function openManagerAccount(target: ManagerAccountTarget) {
    setManagerAccountTarget(target);
    setTemporaryPassword(generateSecureTemporaryPassword());
    setError("");
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createKind) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const timezone = String(data.get("timezone") ?? "Europe/Berlin");
    const groupLeadAccount = createKind === "group" && createLeadWithGroup ? {
      name: String(data.get("leadName") ?? "").trim(),
      username: String(data.get("leadUsername") ?? "").trim(),
      password: temporaryPassword,
      effectiveOn: String(data.get("leadEffectiveOn") ?? ""),
    } : null;
    const config =
      createKind === "company"
        ? { url: "/api/org/companies", body: { name } }
        : createKind === "department"
          ? {
              url: "/api/org/departments",
              body: { companyId: createParentId, name, timezone },
            }
          : {
              url: "/api/org/groups",
              body: { departmentId: createParentId, name, leadAccount: groupLeadAccount },
            };
    setBusy(true);
    setError("");
    try {
      await requestJson(config.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config.body),
      });
      onToast(
        createKind === "group" && groupLeadAccount
          ? `已创建小组“${name}”并开设首任组长账号`
          : `已创建${createKind === "company" ? "公司" : createKind === "department" ? "部门" : "小组"}“${name}”`,
      );
      if (createKind === "group" && groupLeadAccount) setCreatedAccount({
        scopeName: name,
        roleLabel: "组长",
        name: groupLeadAccount.name,
        username: groupLeadAccount.username,
        password: groupLeadAccount.password,
      });
      setCreateKind(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  function openGroupEdit(group: GroupNode) {
    setEditingGroup(group);
    setEditingGroupName(group.name);
    setError("");
  }

  async function submitGroupEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingGroup) return;
    const name = editingGroupName.trim();
    if (!name) {
      onToast("小组名称不能为空", "warn");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/org/groups", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editingGroup.id, name }),
      });
      onToast(`已将“${editingGroup.name}”改名为“${name}”`);
      setEditingGroup(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "小组名称保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteAccount() {
    if (!deletingAccount) return;
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/org/accounts", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: deletingAccount.id }),
      });
      onToast(`已永久删除误开账号“${deletingAccount.name}”`);
      setDeletingAccount(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function appointLead() {
    if (!leadGroup || !candidateId || reason.trim().length < 4) {
      onToast("请选择候选人，并填写至少4个字的任命或调组原因", "warn");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestJson(
        `/api/org/groups/${encodeURIComponent(leadGroup.id)}/lead`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: candidateId,
            effectiveOn,
            reason: reason.trim(),
            formerDisposition,
            formerTargetGroupId,
          }),
        },
      );
      const candidate = candidates.find((item) => item.id === candidateId);
      onToast(
        effectiveOn > new Date().toISOString().slice(0, 10)
          ? `已安排${candidate?.name ?? "候选人员"}于 ${effectiveOn} 接任${leadGroup.name}组长`
          : `已将${candidate?.name ?? "候选人员"}任命为${leadGroup.name}组长`,
      );
      setLeadGroup(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "组长任命失败");
    } finally {
      setBusy(false);
    }
  }

  async function cancelLeadPlan() {
    if (!leadGroup) return;
    setBusy(true);
    try {
      await requestJson(`/api/org/groups/${encodeURIComponent(leadGroup.id)}/lead`, { method: "DELETE" });
      setLeadPlan(null);
      onToast("已取消待生效的组长更换计划");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取消计划失败");
    } finally { setBusy(false); }
  }

  async function createLeadAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountGroup) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const username = String(data.get("username") ?? "").trim();
    if (!name || !username || !temporaryPassword) return;

    setBusy(true);
    setError("");
    try {
      await requestJson("/api/org/group-leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: accountGroup.id,
          name,
          username,
          password: temporaryPassword,
          effectiveOn: accountEffectiveOn,
        }),
      });
      setCreatedAccount({
        scopeName: accountGroup.name,
        roleLabel: "组长",
        name,
        username,
        password: temporaryPassword,
      });
      onToast(`已给${accountGroup.name}开设组长账号`);
      setAccountGroup(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "组长账号创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function createManagerAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!managerAccountTarget) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const username = String(data.get("username") ?? "").trim();
    if (!name || !username || !temporaryPassword) return;
    const isCompany = managerAccountTarget.kind === "company";
    const roleLabel = isCompany ? "公司管理员" : "部门管理员";
    setBusy(true);
    setError("");
    try {
      await requestJson(
        isCompany
          ? "/api/org/company-managers"
          : "/api/org/department-managers",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            [isCompany ? "companyId" : "departmentId"]: managerAccountTarget.id,
            name,
            username,
            password: temporaryPassword,
          }),
        },
      );
      setCreatedAccount({
        scopeName: managerAccountTarget.name,
        roleLabel,
        name,
        username,
        password: temporaryPassword,
      });
      onToast(`已给${managerAccountTarget.name}开设${roleLabel}账号`);
      setManagerAccountTarget(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : `${roleLabel}账号创建失败`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {createdAccount ? (
        <div
          className="card"
          style={{
            padding: 16,
            borderColor: "var(--ok-line)",
            background: "var(--ok-soft)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div>
              <strong style={{ color: "var(--ok)" }}>
                {createdAccount.scopeName}的{createdAccount.roleLabel}
                账号已经开通
              </strong>
              <p style={{ margin: "7px 0 0" }}>
                姓名：{createdAccount.name}　用户名：
                <strong className="tnum">{createdAccount.username}</strong>
                　临时密码：
                <strong className="tnum">{createdAccount.password}</strong>
              </p>
              <p
                style={{
                  margin: "4px 0 0",
                  color: "var(--ink-3)",
                  fontSize: 12.5,
                }}
              >
                请现在把账号和临时密码交给本人；首次登录必须修改密码，关闭后系统不会再次显示明文密码。
              </p>
            </div>
            <button
              className="btn"
              data-size="sm"
              onClick={() => setCreatedAccount(null)}
            >
              我已保存
            </button>
          </div>
        </div>
      ) : null}
      {error && !leadGroup && !createKind ? (
        <div
          className="card"
          role="alert"
          style={{
            padding: 14,
            color: "var(--bad)",
            borderColor: "var(--bad-line)",
          }}
        >
          {error}
          <button
            className="btn"
            data-size="sm"
            style={{ marginLeft: 12 }}
            onClick={() => void load()}
          >
            重试
          </button>
        </div>
      ) : null}
      <div className="card">
        <div className="card-head">
          <div>
            <h2 className="card-title">{duty === "HQ_MANAGER" ? "全局人事" : duty === "COMPANY_MANAGER" ? "部门与组长人事" : "组长与人事"}</h2>
            <p className="card-note">
              按当前账号权限显示组织范围；任免和调组使用弹窗操作，历史成绩保留在原组织。
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {duty === "HQ_MANAGER" ? (
              <>
                <button
                  className="btn"
                  data-size="sm"
                  onClick={() => setCreateKind("company")}
                >
                  <IconPlus size={13} />
                  新建公司
                </button>
                <button
                  className="btn"
                  data-size="sm"
                  onClick={() => {
                    setCreateParentId(structure.companies[0]?.id ?? "");
                    setCreateKind("department");
                  }}
                >
                  <IconPlus size={13} />
                  新建部门
                </button>
              </>
            ) : null}
          </div>
        </div>
        {loading ? (
          <div
            style={{ padding: 35, textAlign: "center", color: "var(--ink-3)" }}
          >
            正在读取真实组织结构…
          </div>
        ) : (
          <div
            style={{
              padding: 16,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {structure.companies.map((company) => (
              <section
                key={company.id}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                <header
                  style={{
                    padding: "12px 14px",
                    background: "var(--surface-sunken)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <strong>{company.name}</strong>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    <span style={{ color: "var(--ink-3)" }}>
                      {company.departments.length} 个部门
                    </span>
                    {duty === "HQ_MANAGER" ? (
                      <button
                        className="btn"
                        data-size="sm"
                        onClick={() =>
                          openManagerAccount({
                            kind: "company",
                            id: company.id,
                            name: company.name,
                          })
                        }
                      >
                        <IconKey size={13} />
                        开设公司管理员
                      </button>
                    ) : null}
                  </div>
                </header>
                {company.departments.map((department) => (
                  <div
                    key={department.id}
                    style={{ padding: 14, borderTop: "1px solid var(--line)" }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: 10,
                        gap: 10,
                      }}
                    >
                      <div>
                        <strong>{department.name}</strong>
                        <span
                          style={{
                            marginLeft: 8,
                            color: "var(--ink-3)",
                            fontSize: 12,
                          }}
                        >
                          {department.timezone}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {duty !== "DEPARTMENT_MANAGER" ? (
                          <button
                            className="btn"
                            data-size="sm"
                            onClick={() =>
                              openManagerAccount({
                                kind: "department",
                                id: department.id,
                                name: department.name,
                              })
                            }
                          >
                            <IconKey size={13} />
                            开设部门管理员
                          </button>
                        ) : null}
                        <button
                          className="btn"
                          data-size="sm"
                          onClick={() => {
                            setCreateParentId(department.id);
                            setCreateLeadWithGroup(true);
                            setTemporaryPassword(generateSecureTemporaryPassword());
                            setEffectiveOn(new Date().toISOString().slice(0, 10));
                            setCreateKind("group");
                          }}
                        >
                          <IconPlus size={12} />
                          开设小组
                        </button>
                      </div>
                    </div>
                    <div
                      className="table-scroll"
                      style={{ minHeight: 0, maxHeight: "none" }}
                    >
                      <table className="grid-table">
                        <thead>
                          <tr>
                            <th>小组</th>
                            <th>当前组长</th>
                            <th>状态</th>
                            <th style={{ width: 300 }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {department.groups.map((group) => (
                            <tr key={group.id}>
                              <td>
                                <strong>{group.name}</strong>
                              </td>
                              <td>
                                {group.leadName ?? (
                                  <span className="badge" data-tone="warn">
                                    待任命
                                  </span>
                                )}
                              </td>
                              <td>{group.active ? "启用" : "停用"}</td>
                              <td>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    className="btn"
                                    data-size="sm"
                                    disabled={busy}
                                    onClick={() => openGroupEdit(group)}
                                  >
                                    <IconEdit size={13} />
                                    编辑小组
                                  </button>
                                  {!group.leadId ? (
                                    <button
                                      className="btn"
                                      data-size="sm"
                                      disabled={!group.active}
                                      onClick={() => openLeadAccount(group)}
                                    >
                                      <IconKey size={13} />
                                      开设组长账号
                                    </button>
                                  ) : (
                                    <button
                                      className="btn"
                                      data-size="sm"
                                      disabled={!group.active}
                                      onClick={() => void openLead(group)}
                                    >
                                      <IconUsers size={13} />
                                      一键更换组长
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </section>
            ))}
            {!structure.companies.length ? (
              <p style={{ textAlign: "center", color: "var(--ink-3)" }}>
                当前权限范围暂无组织数据
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14, marginBottom: 14, overflow: "hidden" }}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)" }}>
          <h2 className="card-title">人员与岗位</h2>
          <p className="card-note">岗位调整和账号状态分开管理。停用后不能登录或修改数据，但历史客户、业绩和操作记录全部保留。</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <input className="field" style={{ minWidth: 220 }} value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="搜索姓名、账号、小组或部门" />
            <select className="field" value={accountRole} onChange={(event) => setAccountRole(event.target.value)}><option value="">全部岗位</option><option value="RECEPTION">接粉</option><option value="GROUP_OPERATOR">炒群</option><option value="EXPERT">专家</option><option value="LEAD">组长</option><option value="RESOURCE_MANAGER">资源部</option></select>
            <select className="field" value={accountStatus} onChange={(event) => setAccountStatus(event.target.value)}><option value="active">在职账号</option><option value="inactive">已停用</option><option value="all">全部状态</option></select>
            <span className="badge" data-tone="mute" style={{ alignSelf: "center" }}>{visibleManagedAccounts.length} 人</span>
          </div>
        </div>
        <div className="table-scroll" style={{ minHeight: 0, maxHeight: 420 }}>
          <table className="grid-table">
            <thead><tr><th>姓名 / 账号</th><th>组织范围</th><th>主岗位</th><th>兼职岗位</th><th>状态</th><th>最后变更</th><th style={{ width: 220 }}>操作</th></tr></thead>
            <tbody>
              {visibleManagedAccounts.map((account) => (
                <tr key={account.id}>
                  <td><strong>{account.name}</strong><small className="muted" style={{ display: "block", marginTop: 3 }}>{account.username}</small></td>
                  <td>{account.departmentName ? <small className="muted" style={{ display: "block" }}>{account.departmentName}</small> : null}<strong>{account.groupName ?? account.departmentName ?? "公司范围"}</strong></td>
                  <td>{managedAccountRoleLabel(account)}</td>
                  <td>{account.secondaryRoles.length ? account.secondaryRoles.map((role) => frontlineRoleLabels[role] ?? role).join("、") : "—"}</td>
                  <td><span className="badge" data-tone={account.active ? "ok" : "mute"}>{account.active ? "在职" : "已停用"}</span></td>
                  <td>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short" }).format(new Date(account.updatedAt))}</td>
                  <td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><a className="btn" data-size="sm" href="#personnel-transfer">调整岗位</a><button className="btn" data-size="sm" disabled={busy} style={{ color: account.active ? "var(--bad)" : "#137333" }} data-confirm-action={account.active ? "停用该账号？历史数据会保留，当前登录会立即失效。" : undefined} onClick={() => void toggleAccountStatus(account)}>{account.active ? "停用账号" : "恢复账号"}</button><button className="btn" data-size="sm" style={{ color: "var(--bad)" }} onClick={() => { setError(""); setDeletingAccount(account); }}><IconTrash size={13} />永久删除</button></div></td>
                </tr>
              ))}
              {!visibleManagedAccounts.length ? <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-3)" }}>当前筛选范围没有人员</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <PersonnelTransferPanel onToast={onToast} />

      <Modal
        open={Boolean(createKind)}
        onClose={() => !busy && setCreateKind(null)}
        title={
          createKind === "company"
            ? "新建公司"
            : createKind === "department"
              ? "新建部门"
              : "开设小组"
        }
        note={createKind === "group" ? "可以一次建好小组和首任组长账号；任一步失败都会整体取消。" : "保存后直接写入本地真实数据库。"}
      >
        <form
          onSubmit={submitCreate}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          {createKind === "department" ? (
            <>
              <label>
                <span className="label">所属公司</span>
                <select
                  className="field"
                  style={{ width: "100%" }}
                  value={createParentId}
                  onChange={(e) => setCreateParentId(e.target.value)}
                >
                  {structure.companies
                    .filter((item) => item.active)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span className="label">国家/时区</span>
                <select
                  className="field"
                  name="timezone"
                  style={{ width: "100%" }}
                >
                  <option value="Europe/Berlin">德国/欧洲中部</option>
                  <option value="America/New_York">美国东部</option>
                  <option value="America/Los_Angeles">美国西部</option>
                  <option value="Asia/Singapore">新加坡</option>
                </select>
              </label>
            </>
          ) : null}
          <label>
            <span className="label">{createKind === "group" ? "小组名称" : "名称"}</span>
            <input
              className="field"
              name="name"
              required
              maxLength={100}
              autoFocus
              style={{ width: "100%" }}
            />
          </label>
          {createKind === "group" ? <>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={createLeadWithGroup} onChange={(event) => {
                setCreateLeadWithGroup(event.target.checked);
                if (event.target.checked && !temporaryPassword) setTemporaryPassword(generateSecureTemporaryPassword());
              }} />
              <span>同时开设首任组长账号（推荐）</span>
            </label>
            {createLeadWithGroup ? <div style={{ display: "grid", gap: 12, padding: 14, border: "1px solid var(--line)", borderRadius: 10, background: "var(--surface-soft)" }}>
              <strong>首任组长账号</strong>
              <label><span className="label">组长姓名</span><input className="field" name="leadName" required maxLength={100} style={{ width: "100%" }} /></label>
              <label><span className="label">登录用户名</span><input className="field" name="leadUsername" required autoComplete="off" maxLength={100} style={{ width: "100%" }} /></label>
              <label><span className="label">生效日期</span><input className="field" name="leadEffectiveOn" type="date" required value={effectiveOn} onChange={(event) => setEffectiveOn(event.target.value)} style={{ width: "100%" }} /></label>
              <label><span className="label">临时密码</span><div style={{ display: "flex", gap: 8 }}><input className="field" readOnly value={temporaryPassword} style={{ flex: 1 }} /><button type="button" className="btn" onClick={() => setTemporaryPassword(generateSecureTemporaryPassword())}>重新生成</button></div></label>
              <p className="card-note" style={{ margin: 0 }}>账号首次登录必须修改密码。新组自动继承本部门时区和系统全部启用渠道。</p>
            </div> : null}
          </> : null}
          {error ? (
            <p role="alert" style={{ color: "var(--bad)" }}>
              {error}
            </p>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => setCreateKind(null)}
            >
              取消
            </button>
            <button className="btn" data-variant="primary" data-confirm-action="保存组织设置" disabled={busy}>
              <IconCheck size={14} />
              {busy ? "保存中…" : "确认保存"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(deletingAccount)}
        onClose={() => !busy && setDeletingAccount(null)}
        title={`删除账号 · ${deletingAccount?.name ?? ""}`}
        note="这是永久删除，只用于清理误开的空账号。"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0 }}>登录用户名：<strong>{deletingAccount?.username}</strong></p>
          <p style={{ margin: 0, color: "var(--bad)" }}>删除后无法恢复。只要该账号已有任何业务或操作记录，系统就会拒绝删除并提示改为停用。</p>
          {error ? <p role="alert" style={{ color: "var(--bad)" }}>{error}</p> : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setDeletingAccount(null)} disabled={busy}>取消</button>
            <button className="btn" data-variant="primary" data-confirm-action="永久删除这个账号" onClick={() => void confirmDeleteAccount()} disabled={busy} style={{ background: "var(--bad)" }}><IconTrash size={14} />{busy ? "删除中…" : "确认删除"}</button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(editingGroup)}
        onClose={() => !busy && setEditingGroup(null)}
        title={`编辑小组 · ${editingGroup?.name ?? ""}`}
        note="这里只修改小组显示名称，不会更换组长、成员或历史数据归属。"
      >
        <form onSubmit={submitGroupEdit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label>
            <span className="label">小组名称</span>
            <input
              className="field"
              value={editingGroupName}
              onChange={(event) => setEditingGroupName(event.target.value)}
              required
              maxLength={100}
              autoFocus
              style={{ width: "100%" }}
            />
          </label>
          {error ? <p role="alert" style={{ color: "var(--bad)" }}>{error}</p> : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" className="btn" onClick={() => setEditingGroup(null)} disabled={busy}>取消</button>
            <button className="btn" data-variant="primary" data-confirm-action="保存小组名称修改" disabled={busy}>
              <IconCheck size={14} />
              {busy ? "保存中…" : "保存修改"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(leadGroup)}
        onClose={() => !busy && setLeadGroup(null)}
        title={`一键更换组长 · ${leadGroup?.name ?? ""}`}
        note="选择新组长、生效日和原组长去向。新组长默认接管本组管理权限，员工客户归属与历史数据保持不动。"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {leadPlan ? <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, background: "var(--surface-soft)" }}>
            <strong>已有待生效计划：{leadPlan.effectiveOn}</strong>
            <div className="muted" style={{ marginTop: 4 }}>{leadPlan.reason}</div>
            <button className="btn" style={{ marginTop: 10 }} data-confirm-action="取消待生效的组长更换计划" onClick={() => void cancelLeadPlan()} disabled={busy}>取消这条计划</button>
          </div> : null}
          <label>
            <span className="label">当前组长</span>
            <div>{leadGroup?.leadName ?? "空缺"}</div>
          </label>
          {leadGroup?.leadId ? <>
            <label>
              <span className="label">原组长后续处理</span>
              <select className="field" style={{ width: "100%" }} value={formerDisposition} onChange={(event) => setFormerDisposition(event.target.value)} disabled={busy || Boolean(leadPlan)}>
                <option value="DISABLE">停用原组长工作账号（推荐）</option>
                <option value="RECEPTION">转为接粉</option>
                <option value="GROUP_OPERATOR">转为炒群</option>
                <option value="EXPERT">转为专家</option>
              </select>
            </label>
            {formerDisposition !== "DISABLE" ? <label><span className="label">原组长调往小组</span><select className="field" style={{ width: "100%" }} value={formerTargetGroupId} onChange={(event) => setFormerTargetGroupId(event.target.value)}>{allGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label> : null}
          </> : null}
          <label>
            <span className="label">候选人员</span>
            <select
              className="field"
              style={{ width: "100%" }}
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
              disabled={busy}
            >
              <option value="">请选择</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} · {candidate.groupName}
                  {candidate.alreadyLead
                    ? " · 现任组长"
                    : ` · ${candidate.role}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">生效日期</span>
            <input
              className="field"
              style={{ width: "100%" }}
              type="date"
              value={effectiveOn}
              onChange={(e) => setEffectiveOn(e.target.value)}
            />
          </label>
          <label>
            <span className="label">任命/调组原因</span>
            <textarea
              className="field"
              style={{ width: "100%", minHeight: 76, padding: 10 }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="至少4个字，方便以后追查"
            />
          </label>
          {error ? (
            <p role="alert" style={{ color: "var(--bad)" }}>
              {error}
            </p>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn" onClick={() => setLeadGroup(null)}>
              取消
            </button>
            <button
              className="btn"
              data-variant="primary"
              data-confirm-action="任命或调入组长"
              disabled={busy || Boolean(leadPlan) || !candidateId || reason.trim().length < 4}
              onClick={() => void appointLead()}
            >
              <IconCheck size={14} />
              {busy ? "处理中…" : effectiveOn > new Date().toISOString().slice(0, 10) ? "保存待生效计划" : "确认更换组长"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(accountGroup)}
        onClose={() => !busy && setAccountGroup(null)}
        title={`开设组长账号 · ${accountGroup?.name ?? ""}`}
        note="这里只给没有现任组长的空缺小组开全新账号；已有组长时请使用任免/调入流程。"
      >
        <form
          onSubmit={createLeadAccount}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <label>
            <span className="label">组长姓名</span>
            <input
              className="field"
              name="name"
              required
              maxLength={100}
              autoFocus
              style={{ width: "100%" }}
              placeholder="填写本人姓名"
            />
          </label>
          <label>
            <span className="label">登录用户名</span>
            <input
              className="field"
              name="username"
              required
              maxLength={100}
              autoComplete="off"
              style={{ width: "100%" }}
              placeholder="例如 wanglin_lead"
            />
          </label>
          <label>
            <span className="label">生效日期</span>
            <input
              className="field"
              type="date"
              required
              style={{ width: "100%" }}
              value={accountEffectiveOn}
              onChange={(e) => setAccountEffectiveOn(e.target.value)}
            />
          </label>
          <div>
            <span className="label">系统生成的临时密码</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="field tnum"
                readOnly
                value={temporaryPassword}
                style={{ width: "100%" }}
              />
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setTemporaryPassword(generateSecureTemporaryPassword())
                }
              >
                重新生成
              </button>
            </div>
            <p
              style={{
                margin: "5px 0 0",
                color: "var(--ink-3)",
                fontSize: 12.5,
              }}
            >
              保存成功后还会显示一次；本人首次登录时必须修改。
            </p>
          </div>
          {error ? (
            <p role="alert" style={{ color: "var(--bad)" }}>
              {error}
            </p>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => setAccountGroup(null)}
            >
              取消
            </button>
            <button className="btn" data-variant="primary" data-confirm-action="开设组长账号" disabled={busy}>
              <IconCheck size={14} />
              {busy ? "开设中…" : "确认开设"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(managerAccountTarget)}
        onClose={() => !busy && setManagerAccountTarget(null)}
        title={`开设${managerAccountTarget?.kind === "company" ? "公司管理员" : "部门管理员"}账号 · ${managerAccountTarget?.name ?? ""}`}
        note="账号保存后绑定到当前公司或部门；首次登录必须修改临时密码。"
      >
        <form
          onSubmit={createManagerAccount}
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <label>
            <span className="label">管理员姓名</span>
            <input
              className="field"
              name="name"
              required
              maxLength={100}
              autoFocus
              style={{ width: "100%" }}
              placeholder="填写本人姓名"
            />
          </label>
          <label>
            <span className="label">登录用户名</span>
            <input
              className="field"
              name="username"
              required
              maxLength={100}
              autoComplete="off"
              style={{ width: "100%" }}
              placeholder="例如 germany_manager"
            />
          </label>
          <div>
            <span className="label">系统生成的临时密码</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="field tnum"
                readOnly
                value={temporaryPassword}
                style={{ width: "100%" }}
              />
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setTemporaryPassword(generateSecureTemporaryPassword())
                }
              >
                重新生成
              </button>
            </div>
          </div>
          {error ? (
            <p role="alert" style={{ color: "var(--bad)" }}>
              {error}
            </p>
          ) : null}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => setManagerAccountTarget(null)}
            >
              取消
            </button>
            <button className="btn" data-variant="primary" data-confirm-action="开设管理员账号" disabled={busy}>
              <IconCheck size={14} />
              {busy ? "开设中…" : "确认开设"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
