import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { PUT } from "../../src/app/api/lead/collaborations/route";
import { POST as HANDOFF } from "../../src/app/api/lead/collaborations/handoff/route";
import { db } from "../../src/lib/db";

const prefix = "lead-collaboration-test-";

async function fixture() {
  const groupId = `${prefix}group-${randomUUID()}`;
  await db.teamGroup.create({ data: { id: groupId, name: `配合测试组-${randomUUID()}` } });
  const [lead, operatorA, operatorB, receptionist] = await Promise.all([
    db.user.create({ data: { id: `${prefix}lead-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "测试组长", role: "LEAD", groupId } }),
    db.user.create({ data: { id: `${prefix}operator-a-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "炒群甲", role: "GROUP_OPERATOR", groupId } }),
    db.user.create({ data: { id: `${prefix}operator-b-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "炒群乙", role: "GROUP_OPERATOR", groupId } }),
    db.user.create({ data: { id: `${prefix}reception-${randomUUID()}`, username: `${prefix}${randomUUID()}`, name: "接粉甲", role: "RECEPTION", groupId } }),
  ]);
  vi.spyOn(auth, "requireRole").mockResolvedValue(lead);
  return { operatorA, operatorB, receptionist };
}

const assign = (groupOperatorId: string, receptionistIds: string[]) => PUT(new Request("http://localhost/api/lead/collaborations", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ groupOperatorId, receptionistIds }),
}));

afterEach(async () => {
  vi.restoreAllMocks();
  const users = await db.user.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  const groups = await db.teamGroup.findMany({ where: { id: { startsWith: prefix } }, select: { id: true } });
  const groupIds = groups.map((group) => group.id);
  await db.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { entityId: { in: groupIds } }] } });
  await db.leadCustomer.deleteMany({ where: { batch: { groupId: { in: groupIds } } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.channel.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.groupOperatorReception.deleteMany({ where: { OR: [{ groupOperatorId: { in: ids } }, { receptionistId: { in: ids } }] } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("lead collaboration assignment", () => {
  it("lets a lead explicitly save a receptionist as pending without changing assigned customers", async () => {
    const { operatorA, receptionist } = await fixture();
    expect((await assign(operatorA.id, [receptionist.id])).status).toBe(200);
    const response = await PUT(new Request("http://localhost/api/lead/collaborations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receptionistId: receptionist.id, groupOperatorId: null }),
    }));
    expect(response.status).toBe(200);
    await expect(db.groupOperatorReception.findMany({ where: { receptionistId: receptionist.id } })).resolves.toEqual([]);
    await expect(db.groupOperatorReceptionHistory.findFirstOrThrow({
      where: { receptionistId: receptionist.id },
      orderBy: { effectiveFrom: "desc" },
    })).resolves.toMatchObject({ groupOperatorId: operatorA.id, effectiveTo: expect.any(Date) });
  });

  it("moves a receptionist to the newly selected operator instead of counting them twice", async () => {
    const { operatorA, operatorB, receptionist } = await fixture();
    expect((await assign(operatorA.id, [receptionist.id])).status).toBe(200);
    expect((await assign(operatorB.id, [receptionist.id])).status).toBe(200);

    await expect(db.groupOperatorReception.findMany({ where: { receptionistId: receptionist.id } }))
      .resolves.toEqual([expect.objectContaining({ groupOperatorId: operatorB.id, receptionistId: receptionist.id })]);
    const history = await db.groupOperatorReceptionHistory.findMany({
      where: { receptionistId: receptionist.id },
      orderBy: { effectiveFrom: "asc" },
    });
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ groupOperatorId: operatorA.id });
    expect(history[0].effectiveTo).not.toBeNull();
    expect(history[1]).toMatchObject({ groupOperatorId: operatorB.id, effectiveTo: null });
  });

  it("does not create duplicate history when saving an unchanged pairing", async () => {
    const { operatorA, receptionist } = await fixture();
    expect((await assign(operatorA.id, [receptionist.id])).status).toBe(200);
    expect((await assign(operatorA.id, [receptionist.id])).status).toBe(200);
    await expect(db.groupOperatorReceptionHistory.count({ where: { receptionistId: receptionist.id } })).resolves.toBe(1);
  });

  it("enforces the one-receptionist rule at database level", async () => {
    const { operatorA, operatorB, receptionist } = await fixture();
    await db.groupOperatorReception.create({ data: { groupOperatorId: operatorA.id, receptionistId: receptionist.id } });
    await expect(db.groupOperatorReception.create({ data: { groupOperatorId: operatorB.id, receptionistId: receptionist.id } }))
      .rejects.toMatchObject({ code: "P2002" });
  });

  it("allows a reception-primary account that also has the group role to be paired with itself", async () => {
    const { receptionist } = await fixture();
    await db.userRoleAssignment.create({
      data: { userId: receptionist.id, role: "GROUP_OPERATOR" },
    });

    const response = await assign(receptionist.id, [receptionist.id]);

    expect(response.status).toBe(200);
    await expect(db.groupOperatorReception.findUnique({
      where: { groupOperatorId_receptionistId: { groupOperatorId: receptionist.id, receptionistId: receptionist.id } },
    })).resolves.toMatchObject({ groupOperatorId: receptionist.id, receptionistId: receptionist.id });
  });

  it("previews and explicitly hands off only active group-stage customers", async () => {
    const { operatorA, operatorB, receptionist } = await fixture();
    const groupId = receptionist.groupId!;
    const channel = await db.channel.create({
      data: { id: `${prefix}channel-${randomUUID()}`, groupId, name: "交接渠道", normalizedName: `${prefix}${randomUUID()}` },
    });
    const batch = await db.sourceBatch.create({ data: { groupId, channelId: channel.id, sourceDate: "2026-08-28" } });
    const active = await db.leadCustomer.create({
      data: { phone: `491${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, batchId: batch.id, ownerId: receptionist.id, groupOperatorOwnerId: operatorA.id, joinedOn: "2026-08-28" },
    });
    const alreadyIntroduced = await db.leadCustomer.create({
      data: { phone: `492${Math.floor(1_000_000_000 + Math.random() * 8_000_000_000)}`, batchId: batch.id, ownerId: receptionist.id, groupOperatorOwnerId: operatorA.id, joinedOn: "2026-08-28", expertIntroducedOn: "2026-08-28" },
    });
    const request = (body: object) => HANDOFF(new Request("http://localhost/api/lead/collaborations/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    const base = { receptionistId: receptionist.id, fromGroupOperatorId: operatorA.id, toGroupOperatorId: operatorB.id };
    const preview = await request({ ...base, mode: "preview" });
    const previewBody = await preview.json();
    expect(preview.status, JSON.stringify(previewBody)).toBe(200);
    expect(previewBody).toEqual({ count: 1 });
    const confirmed = await request({ ...base, mode: "confirm", expectedCount: 1, reason: "换配对后交接在办客户" });
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toEqual({ transferredCount: 1 });
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: active.id }, select: { groupOperatorOwnerId: true } })).resolves.toEqual({ groupOperatorOwnerId: operatorB.id });
    await expect(db.leadCustomer.findUniqueOrThrow({ where: { id: alreadyIntroduced.id }, select: { groupOperatorOwnerId: true } })).resolves.toEqual({ groupOperatorOwnerId: operatorA.id });
  });
});
