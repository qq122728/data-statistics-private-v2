import { describe, expect, it } from "vitest";
import { normalizeOrgStructure, type OrgDepartment } from "../../src/lib/org-structure-view";

const department: OrgDepartment = {
  id: "department-1",
  name: "德国部",
  active: true,
  countryCode: "DE",
  timezone: "Europe/Berlin",
  companyId: "company-1",
  groups: [],
};

describe("组织管理 UI 的真实结构响应归一化", () => {
  it("保留总公司视角的公司分桶和未归属旧部门", () => {
    const legacy = { ...department, id: "legacy", companyId: null };
    const result = normalizeOrgStructure({
      companies: [{ id: "company-1", name: "公司A", active: true, departments: [department] }],
      unassignedDepartments: [legacy],
    });
    expect(result.companies[0]?.departments).toEqual([department]);
    expect(result.unassignedDepartments).toEqual([legacy]);
  });

  it("把公司管理员视角包装成单一公司列表", () => {
    const company = { id: "company-1", name: "公司A", active: true, departments: [department] };
    expect(normalizeOrgStructure({ company })).toEqual({ companies: [company], unassignedDepartments: [] });
  });

  it("把部门管理员视角包装成只含当前部门的列表", () => {
    const result = normalizeOrgStructure({ department });
    expect(result.companies).toHaveLength(1);
    expect(result.companies[0]?.departments).toEqual([department]);
  });

  it("正确处理未绑定范围的空响应", () => {
    expect(normalizeOrgStructure({ company: null })).toEqual({ companies: [], unassignedDepartments: [] });
    expect(normalizeOrgStructure({ department: null })).toEqual({ companies: [], unassignedDepartments: [] });
  });
});
