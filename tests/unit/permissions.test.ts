import { describe, expect, it } from "vitest";
import {
  canReadEvent,
  canReadGroup,
  canReadReportGroup,
  canWriteCustomerRevenue,
  canWriteBatch,
  customerWorkflowRoles,
  hasAnyRole,
  hasManagementAccess,
} from "../../src/lib/permissions";
import { db } from "../../src/lib/db";

describe("data permissions", () => {
  it("keeps management and customer workflow role gates in one place", () => {
    expect(hasManagementAccess({ role: "COMPANY_MANAGER", active: true })).toBe(true);
    expect(hasManagementAccess({ role: "RECEPTION", active: true })).toBe(false);
    expect(hasAnyRole({ role: "EXPERT", active: true }, customerWorkflowRoles)).toBe(true);
    expect(hasAnyRole({ role: "EXPERT", active: false }, customerWorkflowRoles)).toBe(false);
  });

  it("allows an active administrator to read every group", () => {
    const admin = { id: "admin-1", role: "ADMIN" as const, groupId: null, active: true };

    expect(canReadGroup(admin, "group-a")).toBe(true);
    expect(canReadGroup(admin, "group-b")).toBe(true);
  });

  it("allows a lead to read only its own group", () => {
    const lead = { id: "lead-1", role: "LEAD" as const, groupId: "group-a", active: true };

    expect(canReadGroup(lead, "group-a")).toBe(true);
    expect(canReadGroup(lead, "group-b")).toBe(false);
  });

  it("uses one company boundary for reports, including company managers", () => {
    const companyManager = { id: "company-manager", role: "COMPANY_MANAGER" as const, groupId: null, departmentId: "company-a", active: true };
    expect(canReadReportGroup(companyManager, { id: "group-a", departmentId: "company-a" })).toBe(true);
    expect(canReadReportGroup(companyManager, { id: "group-b", departmentId: "company-b" })).toBe(false);
    expect(canReadReportGroup({ ...companyManager, active: false }, { id: "group-a", departmentId: "company-a" })).toBe(false);
  });

  it("limits a department manager to groups in the assigned market", () => {
    const departmentManager = { id: "us-manager", role: "COMPANY_MANAGER" as const, groupId: null, departmentId: "company-a", managementCountryCode: "US", active: true };
    expect(canReadReportGroup(departmentManager, { id: "us-direct", departmentId: "company-a", countryCode: "US" })).toBe(true);
    expect(canReadReportGroup(departmentManager, { id: "us-inherited", departmentId: "company-a", countryCode: null, department: { countryCode: "US" } })).toBe(true);
    expect(canReadReportGroup(departmentManager, { id: "de-group", departmentId: "company-a", countryCode: "DE" })).toBe(false);
    expect(canReadReportGroup(departmentManager, { id: "foreign-us", departmentId: "company-b", countryCode: "US" })).toBe(false);
  });

  it("does not grant group-wide reads to active members", () => {
    const member = { id: "member-1", role: "RECEPTION" as const, groupId: "group-a", active: true };

    expect(canReadGroup(member, "group-a")).toBe(false);
  });

  it("rejects inactive members", () => {
    const member = { id: "member-1", role: "RECEPTION" as const, groupId: "group-a", active: false };

    expect(canReadGroup(member, "group-a")).toBe(false);
  });

  it("allows a member to read only events they entered", () => {
    const member = { id: "member-1", role: "RECEPTION" as const, groupId: "group-a", active: true };

    expect(canReadEvent(member, "member-1")).toBe(true);
    expect(canReadEvent(member, "member-2")).toBe(false);
  });

  it("allows a lead to read events only from its own group", () => {
    const lead = { id: "lead-1", role: "LEAD" as const, groupId: "group-a", active: true };

    expect(canReadEvent(lead, "member-1", "group-a")).toBe(true);
    expect(canReadEvent(lead, "member-2", "group-b")).toBe(false);
  });

  it("lets an active member write only source batches in their own group", async () => {
    const member = { id: "member-1", role: "RECEPTION" as const, groupId: "group-a", active: true };
    const ownBatch = await db.sourceBatch.findFirstOrThrow({ where: { groupId: "group-a" } });
    const otherBatch = await db.sourceBatch.findFirstOrThrow({ where: { groupId: "group-b" } });

    await expect(canWriteBatch(member, ownBatch.id)).resolves.toBe(true);
    await expect(canWriteBatch(member, otherBatch.id)).resolves.toBe(false);
  });

  it("lets an active lead write only source batches in their own group", async () => {
    const lead = { id: "lead-1", role: "LEAD" as const, groupId: "group-a", active: true };
    const ownBatch = await db.sourceBatch.findFirstOrThrow({ where: { groupId: "group-a" } });
    const otherBatch = await db.sourceBatch.findFirstOrThrow({ where: { groupId: "group-b" } });

    await expect(canWriteBatch(lead, ownBatch.id)).resolves.toBe(true);
    await expect(canWriteBatch(lead, otherBatch.id)).resolves.toBe(false);
  });

  it("does not let inactive members write batches", async () => {
    const member = { id: "member-1", role: "RECEPTION" as const, groupId: "group-a", active: false };
    const ownBatch = await db.sourceBatch.findFirstOrThrow({ where: { groupId: "group-a" } });

    await expect(canWriteBatch(member, ownBatch.id)).resolves.toBe(false);
  });

  it("只让同组且有专家权限的账号登记客户资金", () => {
    const target = {
      batch: { groupId: "group-a" },
      lead: {
        ownerId: "reception-a",
        attributionOwnerId: "reception-a",
        groupOperatorOwnerId: "operator-a",
        expertOwnerId: "expert-a",
        currentGroupId: "group-b",
      },
    };
    const lead = { id: "lead-a", role: "LEAD" as const, groupId: "group-a", active: true };
    const expert = { id: "expert-a", role: "EXPERT" as const, groupId: "group-b", active: true };

    expect(canWriteCustomerRevenue(lead, target)).toBe(false);
    expect(canWriteCustomerRevenue({ ...lead, groupId: "group-b" }, target)).toBe(true);
    expect(canWriteCustomerRevenue(expert, target)).toBe(true);
    expect(canWriteCustomerRevenue({ id: "reception-a", role: "RECEPTION", groupId: "group-b", active: true }, target)).toBe(false);
    expect(canWriteCustomerRevenue({ id: "operator-a", role: "GROUP_OPERATOR", groupId: "group-b", active: true }, target)).toBe(false);
    expect(canWriteCustomerRevenue({ id: "reception-b", role: "RECEPTION", groupId: "group-b", active: true }, target)).toBe(false);
    expect(canWriteCustomerRevenue({ id: "reception-b", role: "RECEPTION", roleAssignments: [{ role: "EXPERT" as const }], groupId: "group-b", active: true }, target)).toBe(false);
    expect(canWriteCustomerRevenue({ ...expert, groupId: "group-a" }, target)).toBe(false);
    expect(canWriteCustomerRevenue({ ...expert, id: "expert-b" }, target)).toBe(false);
    expect(canWriteCustomerRevenue({ ...expert, active: false }, target)).toBe(false);
  });
});
