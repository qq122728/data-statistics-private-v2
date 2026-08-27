import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { hashPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { PATCH } from "../../src/app/api/finance/employment-profiles/route";

const prefix = "finance-employment-";

afterEach(async () => {
  vi.restoreAllMocks();
  const members = await db.user.findMany({ where: { username: { startsWith: prefix } }, select: { id: true } });
  const ids = members.map((member) => member.id);
  await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("finance employment source completion", () => {
  it("lets finance complete a pending employee as an agent referral and records an audit", async () => {
    const groupId = `${prefix}group-${randomUUID()}`;
    const memberId = `${prefix}member-${randomUUID()}`;
    const finance = await db.user.create({ data: { id: `${prefix}finance-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "测试财务", passwordHash: hashPassword("finance-password"), role: "FINANCE" } });
    await db.teamGroup.create({ data: { id: groupId, name: "财务补录测试组" } });
    await db.user.create({ data: { id: memberId, username: `${prefix}${randomUUID()}`, name: "待补员工", passwordHash: hashPassword("member-password"), role: "RECEPTION", groupId } });
    vi.spyOn(auth, "requireRole").mockResolvedValue(finance);

    const response = await PATCH(new Request("http://localhost/api/finance/employment-profiles", { method: "PATCH", body: JSON.stringify({ id: memberId, recruitmentSource: "AGENT", referrerName: "阿德" }) }));

    expect(response.status).toBe(200);
    await expect(db.user.findUnique({ where: { id: memberId }, select: { recruitmentSource: true, referrerName: true } })).resolves.toEqual({ recruitmentSource: "AGENT", referrerName: "阿德" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: memberId, action: "USER_RECRUITMENT_UPDATED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({ changedFields: ["recruitmentSource", "referrerName"], after: { recruitmentSource: "AGENT", referrerName: "阿德" } });
  });

  it("does not let a non-finance account fill employee recruitment data", async () => {
    vi.spyOn(auth, "requireRole").mockRejectedValue(new auth.AuthorizationError(undefined, { id: "denied-user", groupId: "denied-team" } as never));
    const response = await PATCH(new Request("http://localhost/api/finance/employment-profiles", { method: "PATCH", body: JSON.stringify({ id: "member-1", recruitmentSource: "DIRECT" }) }));
    expect(response.status).toBe(403);
  });

  it("lets HR complete hire date and personnel attribution but keeps the endpoint limited to those fields", async () => {
    const memberId = `${prefix}hr-member-${randomUUID()}`;
    const hr = await db.user.create({ data: { id: `${prefix}hr-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "测试行政", passwordHash: hashPassword("hr-password"), role: "HR" } });
    await db.user.create({ data: { id: memberId, username: `${prefix}${randomUUID()}`, name: "行政待补员工", passwordHash: hashPassword("member-password"), role: "RECEPTION" } });
    vi.spyOn(auth, "requireRole").mockResolvedValue(hr);

    const response = await PATCH(new Request("http://localhost/api/finance/employment-profiles", { method: "PATCH", body: JSON.stringify({ id: memberId, hireDate: "2026-08-01", recruitmentSource: "DIRECT", referrerName: null }) }));

    expect(response.status).toBe(200);
    await expect(db.user.findUnique({ where: { id: memberId }, select: { role: true, hireDate: true, recruitmentSource: true, referrerName: true } })).resolves.toEqual({ role: "RECEPTION", hireDate: "2026-08-01", recruitmentSource: "DIRECT", referrerName: null });
    await expect(db.auditLog.findFirst({ where: { entityId: memberId, action: "USER_EMPLOYMENT_UPDATED" } })).resolves.not.toBeNull();
  });
});
