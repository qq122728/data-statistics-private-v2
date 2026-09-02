import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { hashPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET } from "../../src/app/api/leads/check/route";

const prefix = "legacy-lookup-test-";

afterEach(async () => {
  vi.restoreAllMocks();
  await db.leadCustomer.deleteMany({
    where: { batch: { groupId: { startsWith: prefix } } },
  });
  await db.sourceBatch.deleteMany({
    where: { groupId: { startsWith: prefix } },
  });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

async function fixture() {
  const suffix = randomUUID();
  const departmentId = `${prefix}department-${suffix}`;
  const groupId = `${prefix}group-${suffix}`;
  const channelId = `${prefix}channel-${suffix}`;
  await db.department.create({
    data: { id: departmentId, name: `${prefix}department-${suffix}` },
  });
  await db.teamGroup.create({
    data: { id: groupId, name: `${prefix}group-${suffix}`, departmentId },
  });
  const owner = await db.user.create({
    data: {
      id: `${prefix}owner-${suffix}`,
      username: `${prefix}owner-${suffix}`,
      name: "接粉归属",
      role: "RECEPTION",
      groupId,
      passwordHash: hashPassword("Lookup@56790"),
    },
  });
  const unrelated = await db.user.create({
    data: {
      id: `${prefix}unrelated-${suffix}`,
      username: `${prefix}unrelated-${suffix}`,
      name: "无关组员",
      role: "RECEPTION",
      groupId,
      passwordHash: hashPassword("Lookup@56790"),
    },
  });
  await db.channel.create({
    data: {
      id: channelId,
      groupId,
      name: "测试渠道",
      normalizedName: `lookup-${suffix}`,
    },
  });
  const batch = await db.sourceBatch.create({
    data: { groupId, channelId, sourceDate: "2026-08-20" },
  });
  return { groupId, owner, unrelated, batch };
}

describe.sequential("customer number lookup", () => {
  it("treats an archived August number as available for a fresh September record", async () => {
    const { owner, batch } = await fixture();
    await db.leadCustomer.create({
      data: {
        phone: "945505",
        batchId: batch.id,
        ownerId: owner.id,
        attributionOwnerId: owner.id,
        trackingArchivedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });
    vi.spyOn(auth, "requireUser").mockResolvedValue(owner);

    const response = await GET(
      new Request("http://localhost/api/leads/check?phone=945505"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ exists: false, phone: "945505" });
  });

  it("does not reveal an unrelated same-group customer", async () => {
    const { owner, unrelated, batch } = await fixture();
    await db.leadCustomer.create({
      data: {
        phone: "945506",
        batchId: batch.id,
        ownerId: owner.id,
        attributionOwnerId: owner.id,
      },
    });
    vi.spyOn(auth, "requireUser").mockResolvedValue(unrelated);

    const response = await GET(
      new Request("http://localhost/api/leads/check?phone=945506"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      exists: true,
      sameGroup: true,
      canAccess: false,
      message: "该号码已存在",
    });
  });
});
