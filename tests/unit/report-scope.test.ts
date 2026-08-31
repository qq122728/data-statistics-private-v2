import { describe, expect, it } from "vitest";
import { resolveReadableReportGroups, resolveSelectedReportGroupIds } from "../../src/lib/report-scope";

const groups = [
  { id: "group-a", name: "一组", active: true, departmentId: "department-a", department: { companyId: "company-a" } },
  { id: "group-b", name: "二组", active: false, departmentId: "department-b", department: { companyId: "company-b" } },
];

describe("report group scope", () => {
  it("lets administrators read active and inactive group history", () => {
    expect(resolveReadableReportGroups({ id: "admin", role: "ADMIN", groupId: null, active: true }, groups)).toEqual(groups);
    expect(resolveReadableReportGroups({ id: "resource", role: "RESOURCE_MANAGER", groupId: null, active: true }, groups)).toEqual(groups);
  });

  it("keeps an assigned inactive group readable for leads and members", () => {
    for (const role of ["LEAD", "RECEPTION"] as const) {
      expect(resolveReadableReportGroups({ id: role, role, groupId: "group-b", active: true }, groups)).toEqual([groups[1]]);
    }
  });

  it("limits a company manager to groups inside the assigned subsidiary", () => {
    expect(resolveReadableReportGroups({
      id: "company-manager",
      role: "COMPANY_MANAGER",
      groupId: null,
      departmentId: "department-a",
      active: true,
    }, groups)).toEqual([groups[0]]);
    expect(resolveReadableReportGroups({
      id: "unassigned-company-manager",
      role: "COMPANY_MANAGER",
      groupId: null,
      departmentId: null,
      active: true,
    }, groups)).toEqual([]);
  });

  it("applies the HQ/company/department duty hierarchy to shared reports", () => {
    expect(resolveReadableReportGroups({
      id: "hq", role: "COMPANY_MANAGER", duty: "HQ_MANAGER", groupId: null, active: true,
    }, groups)).toEqual(groups);
    expect(resolveReadableReportGroups({
      id: "company", role: "COMPANY_MANAGER", duty: "COMPANY_MANAGER", companyId: "company-a", groupId: null, active: true,
    }, groups)).toEqual([groups[0]]);
    expect(resolveReadableReportGroups({
      id: "department", role: "COMPANY_MANAGER", duty: "DEPARTMENT_MANAGER", departmentId: null,
      managedDepartments: [{ departmentId: "department-b" }], groupId: null, active: true,
    }, groups)).toEqual([groups[1]]);
  });

  it("returns an empty selected scope for an unreadable group id", () => {
    const readable = [groups[0]];
    expect(resolveSelectedReportGroupIds(readable, "group-b")).toEqual([]);
    expect(resolveSelectedReportGroupIds(readable)).toEqual(["group-a"]);
  });
});
