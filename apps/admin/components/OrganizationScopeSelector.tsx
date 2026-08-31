"use client";

import type { Company, Department, TeamGroup } from "@/lib/mock-data";

export type ScopeSelection = { companyId: string; departmentId: string | null; groupId: string | null };

/** 组织范围选择器——公司/部门/小组三级横向筛选栏，取代原来 TabCompanyDrilldown/
 *  TabDepartmentDrilldown/TabGroupDrilldown 三层嵌套、每一层各自一条选择栏、各自
 *  渲染一个"只读·XX口径"badge 的旧结构（三层嵌套时会叠出三个重复提示，正是要清理
 *  的问题）。这里全页只有一条筛选栏、一个权限提示。
 *
 *  四类账号各自能选的范围完全由调用方（app/page.tsx）预过滤好的 companies/departments/
 *  teamGroups 数组和 companyLocked/departmentLocked/groupLocked 三个显式开关决定，
 *  本组件不做任何按角色分支的判断——即使调用方不小心把组长自己的组塞进一个未锁定的
 *  选择器，本组件也只是老实地把它当成一个可选项渲染，权限决策完全在调用方那一层，
 *  不在这里猜。permissionLabel 同样是调用方按角色算好直接传进来的文案，本组件只负责
 *  显示，不参与判断。
 *
 *  级联重置规则：换公司 → 部门回退到"全部部门"（或该公司第一个部门，由 allowAllDepartments
 *  决定用哪种）、清空小组；换部门 → 小组回退到"全部小组"。三级都锁定时（组长）这些
 *  下拉框根本不会渲染，用户碰不到，也就不会触发任何级联重置。 */
export function OrganizationScopeSelector({
  companies, departments, teamGroups, value, onChange,
  companyLocked = false, departmentLocked = false, groupLocked = false,
  allowAllDepartments = true, allowAllGroups = true,
  permissionLabel, permissionTone = "mute",
}: {
  companies: Company[];
  departments: Department[];
  teamGroups: TeamGroup[];
  value: ScopeSelection;
  onChange: (next: ScopeSelection) => void;
  companyLocked?: boolean;
  departmentLocked?: boolean;
  groupLocked?: boolean;
  allowAllDepartments?: boolean;
  allowAllGroups?: boolean;
  permissionLabel: string;
  permissionTone?: "mute" | "ok" | "warn";
}) {
  const company = companies.find((c) => c.id === value.companyId) ?? companies[0];
  const departmentsInCompany = departments.filter((d) => d.companyId === company?.id);
  const department = value.departmentId ? departmentsInCompany.find((d) => d.id === value.departmentId) ?? null : null;
  const groupsInDepartment = department ? teamGroups.filter((g) => g.departmentId === department.id) : [];
  const group = value.groupId ? groupsInDepartment.find((g) => g.id === value.groupId) ?? null : null;

  function handleCompanyChange(nextCompanyId: string) {
    const nextDepartments = departments.filter((d) => d.companyId === nextCompanyId);
    const nextDepartmentId = allowAllDepartments ? null : nextDepartments[0]?.id ?? null;
    onChange({ companyId: nextCompanyId, departmentId: nextDepartmentId, groupId: null });
  }

  function handleDepartmentChange(nextDepartmentId: string) {
    // 空字符串代表"全部部门"这一档（<option value="">）
    onChange({ ...value, departmentId: nextDepartmentId || null, groupId: null });
  }

  function handleGroupChange(nextGroupId: string) {
    onChange({ ...value, groupId: nextGroupId || null });
  }

  return (
    <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <ScopeControl label="公司" locked={companyLocked} lockedText={company?.name ?? "—"}>
          <select className="field" style={{ width: 168 }} value={company?.id ?? ""} onChange={(e) => handleCompanyChange(e.target.value)}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </ScopeControl>

        <Arrow />

        <ScopeControl label="部门" locked={departmentLocked} lockedText={department?.name ?? "全部部门"}>
          <select className="field" style={{ width: 168 }} value={department?.id ?? ""} onChange={(e) => handleDepartmentChange(e.target.value)}>
            {allowAllDepartments ? <option value="">全部部门</option> : null}
            {departmentsInCompany.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </ScopeControl>

        <Arrow />

        <ScopeControl label="小组" locked={groupLocked} lockedText={group?.name ?? "全部小组"}>
          <select
            className="field" style={{ width: 168 }}
            value={group?.id ?? ""}
            disabled={!department}
            onChange={(e) => handleGroupChange(e.target.value)}
          >
            {!department ? (
              <option value="">先选择部门</option>
            ) : (
              <>
                {allowAllGroups ? <option value="">全部小组</option> : null}
                {groupsInDepartment.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </>
            )}
          </select>
        </ScopeControl>

        <span className="badge" data-tone={permissionTone} style={{ marginLeft: "auto" }}>{permissionLabel}</span>
      </div>

      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-3)" }}>
        当前范围：{company?.name ?? "—"} / {department?.name ?? "全部部门"} / {group?.name ?? "全部小组"}
      </p>
    </div>
  );
}

function Arrow() {
  return <span aria-hidden style={{ color: "var(--ink-3)", fontSize: 14 }}>→</span>;
}

function ScopeControl({
  label, locked, lockedText, children,
}: {
  label: string;
  locked: boolean;
  lockedText: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12.5, color: "var(--ink-3)", flexShrink: 0 }}>{label}</span>
      {locked ? (
        <span
          className="field"
          style={{ width: 168, display: "inline-flex", alignItems: "center", background: "var(--surface-sunken)", color: "var(--ink-2)", cursor: "default" }}
        >
          {lockedText}
        </span>
      ) : children}
    </div>
  );
}
