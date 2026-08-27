import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { PUT } from "../../src/app/api/lead/collaborations/route";
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
  await db.groupOperatorReception.deleteMany({ where: { OR: [{ groupOperatorId: { in: ids } }, { receptionistId: { in: ids } }] } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("lead collaboration assignment", () => {
  it("moves a receptionist to the newly selected operator instead of counting them twice", async () => {
    const { operatorA, operatorB, receptionist } = await fixture();
    expect((await assign(operatorA.id, [receptionist.id])).status).toBe(200);
    expect((await assign(operatorB.id, [receptionist.id])).status).toBe(200);

    await expect(db.groupOperatorReception.findMany({ where: { receptionistId: receptionist.id } }))
      .resolves.toEqual([expect.objectContaining({ groupOperatorId: operatorB.id, receptionistId: receptionist.id })]);
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
});
