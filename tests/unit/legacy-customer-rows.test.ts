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
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("legacy customer free-entry rows", () => {
  it("旧自由表的读取、新增和修改入口全部停止使用", async () => {
    const suffix = randomUUID();
    const departmentId = `${prefix}department-${suffix}`;
    const groupId = `${prefix}group-${suffix}`;
    await db.department.create({ data: { id: departmentId, name: `美国部门-${suffix}`, timezone: "America/Los_Angeles" } });
    await db.teamGroup.create({ data: { id: groupId, name: `拿破仑组-${suffix}`, departmentId } });
    await db.channel.create({ data: { id: `${prefix}channel-${suffix}`, groupId, name: "FB-M", normalizedName: `${prefix}fb-m-${suffix}` } });
    const actor = await db.user.create({ data: { id: `${prefix}member-${suffix}`, username: `${prefix}member-${suffix}`, name: "测试组员", role: "RECEPTION", groupId, passwordHash: hashPassword("LegacyRows@123") } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    const createdResponse = await POST();
    expect(createdResponse.status).toBe(410);
    await expect(createdResponse.json()).resolves.toMatchObject({ error: expect.stringContaining("已停用") });

    const patchResponse = await PATCH(new Request("http://localhost/api/legacy-customer-rows/retired-row", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        joinedOn: "2026-07-01", phone: "123456", attributionMemberName: "测试组员",
        sourceChannelName: "FB-M", groupOperatorName: "炒群甲", deviceCode: "B22",
        groupSituation: "持续维护", leaveType: "正常退群", expertName: "专家乙",
        expertSituation: "已开单", registeredOn: "2026-08-30",
        initialDeposit: "1,000.25", recharge: "500", withdrawal: "100.10",
      }),
    }), { params: Promise.resolve({ rowId: "retired-row" }) });
    expect(patchResponse.status).toBe(410);

    const listResponse = await GET();
    expect(listResponse.status).toBe(410);
    await expect(db.legacyCustomerRow.count({ where: { groupId } })).resolves.toBe(0);
  });
});
