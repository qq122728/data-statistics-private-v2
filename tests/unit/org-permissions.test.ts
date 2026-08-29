import { describe, expect, it } from "vitest";
import {
  canAppointOrTransferLead,
  canCreateCompany,
  canCreateCompanyManagerAccount,
  canCreateDepartment,
  canCreateDepartmentManagerAccount,
  canCreateGroup,
  canCreateGroupLeadAccount,
  canCreateHqManagerAccount,
  canOperateCustomer,
  canViewOrgScope,
  type OrgPermissionUser,
} from "../../src/lib/org-permissions";

function user(overrides: Partial<OrgPermissionUser>): OrgPermissionUser {
  return {
    id: "user-1",
    role: "RECEPTION",
    duty: null,
    active: true,
    groupId: null,
    departmentId: null,
    companyId: null,
    ...overrides,
  };
}

describe("org-permissions: 5.6 组织结构操作权限", () => {
  describe("canCreateCompany", () => {
    it("allows an active HQ manager", () => {
      expect(canCreateCompany(user({ duty: "HQ_MANAGER" }))).toBe(true);
    });

    it("rejects an inactive HQ manager", () => {
      expect(canCreateCompany(user({ duty: "HQ_MANAGER", active: false }))).toBe(false);
    });

    it("rejects a company manager (cannot escalate to HQ-only action)", () => {
      expect(canCreateCompany(user({ duty: "COMPANY_MANAGER", companyId: "company-a" }))).toBe(false);
    });

    it("rejects a department manager", () => {
      expect(canCreateCompany(user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" }))).toBe(false);
    });

    it("rejects a user with no duty at all", () => {
      expect(canCreateCompany(user({ duty: null }))).toBe(false);
    });
  });

  describe("canCreateDepartment", () => {
    it("allows an active HQ manager", () => {
      expect(canCreateDepartment(user({ duty: "HQ_MANAGER" }))).toBe(true);
    });

    it("rejects a company manager (per 5.6, only HQ builds departments)", () => {
      expect(canCreateDepartment(user({ duty: "COMPANY_MANAGER", companyId: "company-a" }))).toBe(false);
    });

    it("rejects a department manager", () => {
      expect(canCreateDepartment(user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" }))).toBe(false);
    });
  });

  describe("canCreateGroup", () => {
    const departmentInCompanyA = { id: "department-a", companyId: "company-a" };
    const departmentInCompanyB = { id: "department-b", companyId: "company-b" };
    const departmentWithNoCompany = { id: "department-legacy", companyId: null };

    it("lets HQ manager create a group under any department", () => {
      expect(canCreateGroup(user({ duty: "HQ_MANAGER" }), departmentInCompanyA)).toBe(true);
      expect(canCreateGroup(user({ duty: "HQ_MANAGER" }), departmentWithNoCompany)).toBe(true);
    });

    it("lets a company manager create a group under their own company's department", () => {
      const manager = user({ duty: "COMPANY_MANAGER", companyId: "company-a" });
      expect(canCreateGroup(manager, departmentInCompanyA)).toBe(true);
    });

    it("blocks a company manager from creating a group under a different company's department", () => {
      const manager = user({ duty: "COMPANY_MANAGER", companyId: "company-a" });
      expect(canCreateGroup(manager, departmentInCompanyB)).toBe(false);
    });

    it("blocks a company manager with no companyId set (unset must not mean unlimited)", () => {
      const manager = user({ duty: "COMPANY_MANAGER", companyId: null });
      expect(canCreateGroup(manager, departmentInCompanyA)).toBe(false);
    });

    it("lets a department manager create a group in their own department", () => {
      const manager = user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" });
      expect(canCreateGroup(manager, departmentInCompanyA)).toBe(true);
    });

    it("blocks a department manager from creating a group in a different department", () => {
      const manager = user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" });
      expect(canCreateGroup(manager, departmentInCompanyB)).toBe(false);
    });

    it("blocks a plain lead or frontline member from creating groups", () => {
      expect(canCreateGroup(user({ duty: "LEAD", groupId: "group-a" }), departmentInCompanyA)).toBe(false);
      expect(canCreateGroup(user({ duty: null }), departmentInCompanyA)).toBe(false);
    });
  });

  describe("canAppointOrTransferLead", () => {
    const groupInDepartmentA = { id: "group-a", departmentId: "department-a", companyId: "company-a" };
    const groupInDepartmentB = { id: "group-b", departmentId: "department-b", companyId: "company-b" };

    it("lets HQ manager appoint a lead anywhere", () => {
      expect(canAppointOrTransferLead(user({ duty: "HQ_MANAGER" }), groupInDepartmentA)).toBe(true);
      expect(canAppointOrTransferLead(user({ duty: "HQ_MANAGER" }), groupInDepartmentB)).toBe(true);
    });

    it("lets a company manager appoint a lead in their own company's group", () => {
      const manager = user({ duty: "COMPANY_MANAGER", companyId: "company-a" });
      expect(canAppointOrTransferLead(manager, groupInDepartmentA)).toBe(true);
    });

    it("blocks a company manager from appointing a lead in a different company's group", () => {
      const manager = user({ duty: "COMPANY_MANAGER", companyId: "company-a" });
      expect(canAppointOrTransferLead(manager, groupInDepartmentB)).toBe(false);
    });

    it("lets a department manager appoint a lead within their own department", () => {
      const manager = user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" });
      expect(canAppointOrTransferLead(manager, groupInDepartmentA)).toBe(true);
    });

    it("blocks a department manager from appointing a lead outside their department", () => {
      const manager = user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" });
      expect(canAppointOrTransferLead(manager, groupInDepartmentB)).toBe(false);
    });

    it("blocks an inactive manager regardless of duty", () => {
      const manager = user({ duty: "HQ_MANAGER", active: false });
      expect(canAppointOrTransferLead(manager, groupInDepartmentA)).toBe(false);
    });

    it("blocks a frontline user with no management duty", () => {
      expect(canAppointOrTransferLead(user({ role: "LEAD", groupId: "group-a" }), groupInDepartmentA)).toBe(false);
    });
  });

  describe("canCreateGroupLeadAccount", () => {
    const groupInDepartmentA = { id: "group-a", departmentId: "department-a", companyId: "company-a" };
    const groupInDepartmentB = { id: "group-b", departmentId: "department-b", companyId: "company-b" };

    it("allows ADMIN for system bootstrap", () => {
      expect(canCreateGroupLeadAccount(user({ role: "ADMIN" }), groupInDepartmentA)).toBe(true);
    });

    it("uses the same organization scope as lead appointment for managers", () => {
      expect(canCreateGroupLeadAccount(user({ duty: "HQ_MANAGER" }), groupInDepartmentB)).toBe(true);
      expect(canCreateGroupLeadAccount(user({ duty: "COMPANY_MANAGER", companyId: "company-a" }), groupInDepartmentA)).toBe(true);
      expect(canCreateGroupLeadAccount(user({ duty: "COMPANY_MANAGER", companyId: "company-a" }), groupInDepartmentB)).toBe(false);
      expect(canCreateGroupLeadAccount(user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" }), groupInDepartmentA)).toBe(true);
      expect(canCreateGroupLeadAccount(user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" }), groupInDepartmentB)).toBe(false);
    });

    it("blocks inactive managers and frontline users", () => {
      expect(canCreateGroupLeadAccount(user({ role: "ADMIN", active: false }), groupInDepartmentA)).toBe(false);
      expect(canCreateGroupLeadAccount(user({ duty: "HQ_MANAGER", active: false }), groupInDepartmentA)).toBe(false);
      expect(canCreateGroupLeadAccount(user({ role: "LEAD", groupId: "group-a" }), groupInDepartmentA)).toBe(false);
    });
  });
});

describe("org-permissions: 5.6 补充 创建下一档管理员账号", () => {
  describe("canCreateDepartmentManagerAccount", () => {
    const departmentInCompanyA = { id: "department-a", companyId: "company-a" };
    const departmentInCompanyB = { id: "department-b", companyId: "company-b" };
    const departmentWithNoCompany = { id: "department-legacy", companyId: null };

    it("allows ADMIN regardless of duty (system bootstrap)", () => {
      expect(canCreateDepartmentManagerAccount(user({ role: "ADMIN", duty: null }), departmentInCompanyA)).toBe(true);
    });

    it("allows HQ manager for any department, skip-level", () => {
      expect(canCreateDepartmentManagerAccount(user({ duty: "HQ_MANAGER" }), departmentInCompanyA)).toBe(true);
      expect(canCreateDepartmentManagerAccount(user({ duty: "HQ_MANAGER" }), departmentWithNoCompany)).toBe(true);
    });

    it("allows a company manager to create a department-manager account for their own company's department", () => {
      const manager = user({ duty: "COMPANY_MANAGER", companyId: "company-a" });
      expect(canCreateDepartmentManagerAccount(manager, departmentInCompanyA)).toBe(true);
    });

    it("blocks a company manager from creating one for a different company's department", () => {
      const manager = user({ duty: "COMPANY_MANAGER", companyId: "company-a" });
      expect(canCreateDepartmentManagerAccount(manager, departmentInCompanyB)).toBe(false);
    });

    it("blocks a company manager with no companyId set (unset must not mean unlimited)", () => {
      const manager = user({ duty: "COMPANY_MANAGER", companyId: null });
      expect(canCreateDepartmentManagerAccount(manager, departmentInCompanyA)).toBe(false);
    });

    it("blocks a department manager from creating any manager account at all (5a: only appoints/transfers leads, creates groups)", () => {
      const manager = user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" });
      expect(canCreateDepartmentManagerAccount(manager, departmentInCompanyA)).toBe(false);
    });

    it("blocks a plain frontline user with no duty and no ADMIN role", () => {
      expect(canCreateDepartmentManagerAccount(user({ duty: null }), departmentInCompanyA)).toBe(false);
    });

    it("blocks an inactive ADMIN or HQ manager", () => {
      expect(canCreateDepartmentManagerAccount(user({ role: "ADMIN", active: false }), departmentInCompanyA)).toBe(false);
      expect(canCreateDepartmentManagerAccount(user({ duty: "HQ_MANAGER", active: false }), departmentInCompanyA)).toBe(false);
    });
  });

  describe("canCreateCompanyManagerAccount", () => {
    it("allows ADMIN (system bootstrap)", () => {
      expect(canCreateCompanyManagerAccount(user({ role: "ADMIN", duty: null }))).toBe(true);
    });

    it("allows HQ manager", () => {
      expect(canCreateCompanyManagerAccount(user({ duty: "HQ_MANAGER" }))).toBe(true);
    });

    it("blocks a company manager (cannot create another company manager, not itself a skip-level case)", () => {
      expect(canCreateCompanyManagerAccount(user({ duty: "COMPANY_MANAGER", companyId: "company-a" }))).toBe(false);
    });

    it("blocks a department manager", () => {
      expect(canCreateCompanyManagerAccount(user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" }))).toBe(false);
    });

    it("blocks an inactive ADMIN", () => {
      expect(canCreateCompanyManagerAccount(user({ role: "ADMIN", active: false }))).toBe(false);
    });
  });

  describe("canCreateHqManagerAccount", () => {
    it("allows ADMIN only", () => {
      expect(canCreateHqManagerAccount(user({ role: "ADMIN", duty: null }))).toBe(true);
    });

    it("blocks an existing HQ manager (no business tier can authorize creating another HQ manager)", () => {
      expect(canCreateHqManagerAccount(user({ duty: "HQ_MANAGER" }))).toBe(false);
    });

    it("blocks a company manager and a department manager", () => {
      expect(canCreateHqManagerAccount(user({ duty: "COMPANY_MANAGER", companyId: "company-a" }))).toBe(false);
      expect(canCreateHqManagerAccount(user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" }))).toBe(false);
    });

    it("blocks an inactive ADMIN", () => {
      expect(canCreateHqManagerAccount(user({ role: "ADMIN", active: false }))).toBe(false);
    });
  });
});

describe("org-permissions: 5.2 组织结构可见范围 (canViewOrgScope)", () => {
  const groupScope = { level: "group" as const, groupId: "group-a", departmentId: "department-a", companyId: "company-a" };
  const otherGroupScope = { level: "group" as const, groupId: "group-b", departmentId: "department-b", companyId: "company-b" };
  const departmentScope = { level: "department" as const, departmentId: "department-a", companyId: "company-a" };
  const companyScope = { level: "company" as const, companyId: "company-a" };
  const otherCompanyScope = { level: "company" as const, companyId: "company-b" };

  it("lets HQ manager view every level, including other companies", () => {
    const hq = user({ duty: "HQ_MANAGER" });
    expect(canViewOrgScope(hq, groupScope)).toBe(true);
    expect(canViewOrgScope(hq, departmentScope)).toBe(true);
    expect(canViewOrgScope(hq, companyScope)).toBe(true);
    expect(canViewOrgScope(hq, otherCompanyScope)).toBe(true);
  });

  it("lets a company manager view their own company at every level, but not another company", () => {
    const manager = user({ duty: "COMPANY_MANAGER", companyId: "company-a" });
    expect(canViewOrgScope(manager, companyScope)).toBe(true);
    expect(canViewOrgScope(manager, departmentScope)).toBe(true);
    expect(canViewOrgScope(manager, groupScope)).toBe(true);
    expect(canViewOrgScope(manager, otherCompanyScope)).toBe(false);
    expect(canViewOrgScope(manager, otherGroupScope)).toBe(false);
  });

  it("lets a department manager view their own department and its groups, but never the company level", () => {
    const manager = user({ duty: "DEPARTMENT_MANAGER", departmentId: "department-a" });
    expect(canViewOrgScope(manager, departmentScope)).toBe(true);
    expect(canViewOrgScope(manager, groupScope)).toBe(true);
    expect(canViewOrgScope(manager, otherGroupScope)).toBe(false);
    // 5.2: 部门管理员看不到公司整体视图，即便这个公司就是自己所在的公司。
    expect(canViewOrgScope(manager, companyScope)).toBe(false);
  });

  it("lets a lead view only their own group, nothing above it", () => {
    const lead = user({ role: "LEAD", groupId: "group-a" });
    expect(canViewOrgScope(lead, groupScope)).toBe(true);
    expect(canViewOrgScope(lead, otherGroupScope)).toBe(false);
    expect(canViewOrgScope(lead, departmentScope)).toBe(false);
    expect(canViewOrgScope(lead, companyScope)).toBe(false);
  });

  it("gives a plain frontline member (no duty, not a lead) no organizational view", () => {
    const reception = user({ role: "RECEPTION", groupId: "group-a" });
    expect(canViewOrgScope(reception, groupScope)).toBe(false);
  });

  it("blocks an inactive manager regardless of duty", () => {
    expect(canViewOrgScope(user({ duty: "HQ_MANAGER", active: false }), companyScope)).toBe(false);
  });
});

describe("org-permissions: 5.1 能操作哪些客户 (canOperateCustomer)", () => {
  const target = { batch: { groupId: "group-a" }, ownerId: "reception-1", groupOperatorOwnerId: "operator-1", expertOwnerId: "expert-1" };

  it("lets reception operate only their own customer", () => {
    expect(canOperateCustomer(user({ role: "RECEPTION", id: "reception-1" }), target)).toBe(true);
    expect(canOperateCustomer(user({ role: "RECEPTION", id: "reception-2" }), target)).toBe(false);
  });

  it("lets group operator (炒群) operate only the customer assigned to them", () => {
    expect(canOperateCustomer(user({ role: "GROUP_OPERATOR", id: "operator-1" }), target)).toBe(true);
    expect(canOperateCustomer(user({ role: "GROUP_OPERATOR", id: "operator-2" }), target)).toBe(false);
  });

  it("lets an expert operate only the customer explicitly assigned to them", () => {
    expect(canOperateCustomer(user({ role: "EXPERT", id: "expert-1" }), target)).toBe(true);
    expect(canOperateCustomer(user({ role: "EXPERT", id: "expert-2" }), target)).toBe(false);
  });

  it("lets a lead operate every customer in their own group, regardless of individual ownership", () => {
    expect(canOperateCustomer(user({ role: "LEAD", id: "someone-else", groupId: "group-a" }), target)).toBe(true);
  });

  it("blocks a lead from operating a customer outside their own group", () => {
    expect(canOperateCustomer(user({ role: "LEAD", id: "someone-else", groupId: "group-b" }), target)).toBe(false);
  });

  it("honors dual reception+group-operator assignment (1.4 兼任): can operate either side's own customer", () => {
    const dualRole = user({ role: "RECEPTION", id: "operator-1", roleAssignments: [{ role: "GROUP_OPERATOR" }] });
    expect(canOperateCustomer(dualRole, target)).toBe(true);
  });

  it("blocks resource manager / finance / company manager from operating any customer (read-only per 5.1)", () => {
    expect(canOperateCustomer(user({ role: "RESOURCE_MANAGER", id: "resource-1", groupId: null }), target)).toBe(false);
    expect(canOperateCustomer(user({ role: "FINANCE", id: "finance-1", groupId: null }), target)).toBe(false);
    expect(canOperateCustomer(user({ role: "COMPANY_MANAGER", id: "company-manager-1", departmentId: "department-a" }), target)).toBe(false);
    expect(canOperateCustomer(user({ role: "ADMIN", id: "admin-1" }), target)).toBe(false);
  });

  it("blocks an inactive frontline member even if the ids match", () => {
    expect(canOperateCustomer(user({ role: "RECEPTION", id: "reception-1", active: false }), target)).toBe(false);
  });
});
