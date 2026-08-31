export type OrgGroup = { id: string; name: string; groupType: "HACKER" | "LAWYER"; active: boolean; leadId: string | null; leadName: string | null };
export type OrgDepartment = { id: string; name: string; active: boolean; countryCode: string; timezone: string; companyId: string | null; groups: OrgGroup[] };
export type OrgCompany = { id: string; name: string; active: boolean; departments: OrgDepartment[] };

export type OrgStructureResponse =
  | { companies: OrgCompany[]; unassignedDepartments: OrgDepartment[] }
  | { company: OrgCompany | null }
  | { department: OrgDepartment | null };

/** 把三级管理员各自不同的 API 返回形状，统一成前端可以遍历的公司列表。 */
export function normalizeOrgStructure(payload: OrgStructureResponse): { companies: OrgCompany[]; unassignedDepartments: OrgDepartment[] } {
  if ("companies" in payload) return payload;
  if ("company" in payload) return { companies: payload.company ? [payload.company] : [], unassignedDepartments: [] };
  if (payload.department) return {
    companies: [{ id: payload.department.companyId ?? "department-scope", name: "当前部门", active: true, departments: [payload.department] }],
    unassignedDepartments: [],
  };
  return { companies: [], unassignedDepartments: [] };
}
