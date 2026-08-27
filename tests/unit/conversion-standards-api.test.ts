import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { GET, PATCH } from "../../src/app/api/lead/conversion-standards/route";
import { hashPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";

const prefix = "conversion-standards-test-";

async function fixture() {
  const groupId = `${prefix}${randomUUID()}`;
  await db.teamGroup.create({ data: { id: groupId, name: `评级测试组-${randomUUID()}` } });
  const lead = await db.user.create({ data: { id: `${prefix}lead-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "评级测试组长", passwordHash: hashPassword("demo-password"), role: "LEAD", groupId } });
  vi.spyOn(auth, "requireRole").mockResolvedValue(lead);
  return { groupId, lead };
}

afterEach(async () => {
  vi.restoreAllMocks();
  const users = await db.user.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { startsWith: prefix } }] } });
  await db.session.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("lead conversion standards API", () => {
  it("returns the agreed defaults for the lead's own group", async () => {
    await fixture();
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ standards: {
      receptionJoin: { pass: 10, good: 15, excellent: 20 },
      operatorExpert: { pass: 60, good: 70, excellent: 80 },
      expertOrder: { pass: 10, good: 15, excellent: 20 },
    } });
  });

  it("rejects reversed bands without changing the group or writing a success audit", async () => {
    const { groupId } = await fixture();
    const response = await PATCH(new Request("http://localhost/api/lead/conversion-standards", { method: "PATCH", body: JSON.stringify({ standards: {
      receptionJoin: { pass: 10, good: 15, excellent: 20 },
      operatorExpert: { pass: 70, good: 60, excellent: 80 },
      expertOrder: { pass: 10, good: 15, excellent: 20 },
    } }) }));
    expect(response.status).toBe(400);
    await expect(db.teamGroup.findUnique({ where: { id: groupId }, select: { operatorExpertPassRate: true } })).resolves.toEqual({ operatorExpertPassRate: 60 });
    await expect(db.auditLog.count({ where: { entityId: groupId } })).resolves.toBe(0);
  });

  it("updates only the lead's group and records before and after standards", async () => {
    const { groupId } = await fixture();
    const standards = {
      receptionJoin: { pass: 12, good: 18, excellent: 25 },
      operatorExpert: { pass: 60, good: 75, excellent: 85 },
      expertOrder: { pass: 15, good: 25, excellent: 35 },
    };
    const response = await PATCH(new Request("http://localhost/api/lead/conversion-standards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ standards }) }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ standards, unchanged: false });
    await expect(db.teamGroup.findUnique({ where: { id: groupId }, select: { operatorExpertPassRate: true, operatorExpertGoodRate: true, operatorExpertExcellentRate: true } })).resolves.toEqual({ operatorExpertPassRate: 60, operatorExpertGoodRate: 75, operatorExpertExcellentRate: 85 });
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: groupId, action: "GROUP_CONVERSION_STANDARDS_UPDATED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({ before: { operatorExpert: { pass: 60, good: 70, excellent: 80 } }, after: { operatorExpert: { pass: 60, good: 75, excellent: 85 } } });
  });
});
