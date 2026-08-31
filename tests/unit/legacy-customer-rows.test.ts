import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { hashPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET, POST } from "../../src/app/api/legacy-customer-rows/route";
import { PATCH } from "../../src/app/api/legacy-customer-rows/[rowId]/route";

const prefix = "legacy-row-test-";

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { actorId: { startsWith: prefix } } });
  await db.legacyCustomerRow.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("legacy customer free-entry rows", () => {
  it("lets a frontline member add a blank row, autosave free text, and derives leave date and net performance", async () => {
    const suffix = randomUUID();
    const departmentId = `${prefix}department-${suffix}`;
    const groupId = `${prefix}group-${suffix}`;
    await db.department.create({ data: { id: departmentId, name: `美国部门-${suffix}`, timezone: "America/Los_Angeles" } });
    await db.teamGroup.create({ data: { id: groupId, name: `拿破仑组-${suffix}`, departmentId } });
    const actor = await db.user.create({ data: { id: `${prefix}member-${suffix}`, username: `${prefix}member-${suffix}`, name: "测试组员", role: "RECEPTION", groupId, passwordHash: hashPassword("LegacyRows@123") } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    const createdResponse = await POST();
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).row;
    expect(created).toMatchObject({ phone: "", initialDeposit: "0.00", netPerformanceCents: 0 });

    const patchResponse = await PATCH(new Request(`http://localhost/api/legacy-customer-rows/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        joinedOn: "2026-07-01", phone: "123456", attributionMemberName: "测试组员",
        sourceChannelName: "FB-M", groupOperatorName: "炒群甲", deviceCode: "B22",
        groupSituation: "持续维护", leaveType: "正常退群", expertName: "专家乙",
        expertSituation: "已开单", registeredOn: "2026-08-30",
        initialDeposit: "1,000.25", recharge: "500", withdrawal: "100.10",
      }),
    }), { params: Promise.resolve({ rowId: created.id }) });
    expect(patchResponse.status).toBe(200);
    const saved = (await patchResponse.json()).row;
    expect(saved).toMatchObject({
      phone: "123456", groupOperatorName: "炒群甲", initialDeposit: "1000.25",
      recharge: "500.00", withdrawal: "100.10", netPerformanceCents: 140015,
    });
    expect(saved.leftOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const listResponse = await GET();
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({ rows: [{ id: created.id, phone: "123456" }] });
  });
});
