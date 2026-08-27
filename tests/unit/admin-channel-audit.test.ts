import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { hashPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { PATCH, POST } from "../../src/app/api/admin/channels/route";

const fixturePrefix = "admin-channel-audit-";
let activeAdminPassword = "";

function confirmed<T extends Record<string, unknown>>(body: T) {
  return { ...body, highRiskReason: "总公司测试介入渠道管理", currentPassword: activeAdminPassword };
}

async function seededAdmin() {
  return protectedAdmin();
}

async function protectedAdmin() {
  const currentPassword = "channel-audit-admin-password";
  const id = `${fixturePrefix}admin-${randomUUID()}`;
  const admin = await db.user.create({
    data: { id, username: id, name: "渠道审计管理员", passwordHash: hashPassword(currentPassword), role: "ADMIN" },
  });
  vi.spyOn(auth, "requireRole").mockResolvedValue(admin);
  activeAdminPassword = currentPassword;
  return { currentPassword };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { entityId: { startsWith: fixturePrefix } },
        { summary: { contains: fixturePrefix } },
      ],
    },
  });
  await db.channel.deleteMany({
    where: { groupId: { startsWith: fixturePrefix } },
  });
  await db.teamGroup.deleteMany({
    where: { id: { startsWith: fixturePrefix } },
  });
  await db.user.deleteMany({ where: { id: { startsWith: fixturePrefix } } });
});

describe.sequential("administrator channel audit context", () => {
  it("records channel and group identity for create, update, and status changes", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}${randomUUID()}`;
    const groupName = "审计测试一组";
    await db.teamGroup.create({ data: { id: groupId, name: groupName } });

    const createdResponse = await POST(
      new Request("http://localhost/api/admin/channels", {
        method: "POST",
        body: JSON.stringify(confirmed({ name: "渠道初始名", groupId })),
      }),
    );
    expect(createdResponse.status).toBe(201);
    const channel = (await createdResponse.json()) as { id: string };

    const updatedResponse = await PATCH(
      new Request("http://localhost/api/admin/channels", {
        method: "PATCH",
        body: JSON.stringify(confirmed({ id: channel.id, groupId, name: "渠道新名字" })),
      }),
    );
    expect(updatedResponse.status).toBe(200);
    const statusResponse = await PATCH(
      new Request("http://localhost/api/admin/channels", {
        method: "PATCH",
        body: JSON.stringify(confirmed({ id: channel.id, groupId, active: false })),
      }),
    );
    expect(statusResponse.status).toBe(200);

    const logs = await db.auditLog.findMany({
      where: { entityId: channel.id },
      orderBy: { createdAt: "asc" },
    });
    expect(
      logs.map((log) => ({
        action: log.action,
        summary: JSON.parse(log.summary),
      })),
    ).toMatchObject([
      {
        action: "CHANNEL_CREATED",
        summary: {
          changedFields: [
            "name",
            "groupId",
            "fanCostMode",
            "effectiveFanPriceCents",
            "channelType",
            "rebateRateBps",
          ],
          groupId,
          groupName,
          name: "渠道初始名",
        },
      },
      {
        action: "CHANNEL_UPDATED",
        summary: {
          changedFields: ["name"],
          groupId,
          groupName,
          name: "渠道新名字",
          before: { name: "渠道初始名" },
          after: { name: "渠道新名字" },
        },
      },
      {
        action: "CHANNEL_STATUS_CHANGED",
        summary: {
          changedFields: ["active"],
          groupId,
          groupName,
          name: "渠道新名字",
        },
      },
    ]);
  });

  it("updates only the composite-key channel price and audits its before and after values", async () => {
    await seededAdmin();
    const channelId = `${fixturePrefix}shared-${randomUUID()}`;
    const firstGroupId = `${fixturePrefix}group-a-${randomUUID()}`;
    const secondGroupId = `${fixturePrefix}group-b-${randomUUID()}`;
    await db.teamGroup.createMany({
      data: [
        { id: firstGroupId, name: "价格测试一组" },
        { id: secondGroupId, name: "价格测试二组" },
      ],
    });
    await db.channel.createMany({
      data: [
        {
          id: channelId,
          groupId: firstGroupId,
          name: "同名渠道",
          normalizedName: "同名渠道",
          effectiveFanPriceCents: null,
        },
        {
          id: channelId,
          groupId: secondGroupId,
          name: "同名渠道",
          normalizedName: "同名渠道",
          fanCostMode: "PAID",
          effectiveFanPriceCents: 9_000,
        },
      ],
    });

    const response = await PATCH(
      new Request("http://localhost/api/admin/channels", {
        method: "PATCH",
        body: JSON.stringify(confirmed({
          id: channelId,
          groupId: firstGroupId,
          effectiveFanPriceCents: 5_000,
        })),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: channelId,
      groupId: firstGroupId,
      effectiveFanPriceCents: 5_000,
    });
    await expect(
      db.channel.findUnique({
        where: { id_groupId: { id: channelId, groupId: secondGroupId } },
        select: { effectiveFanPriceCents: true },
      }),
    ).resolves.toEqual({ effectiveFanPriceCents: 9_000 });
    const audit = await db.auditLog.findFirstOrThrow({
      where: {
        entityId: channelId,
        action: "CHANNEL_PRICE_UPDATED",
        summary: { contains: firstGroupId },
      },
    });
    expect(JSON.parse(audit.summary)).toMatchObject({
      changedFields: ["fanCostMode", "effectiveFanPriceCents"],
      name: "同名渠道",
      groupId: firstGroupId,
      groupName: "价格测试一组",
      before: { fanCostMode: "FREE", effectiveFanPriceCents: null },
      after: { fanCostMode: "PAID", effectiveFanPriceCents: 5_000 },
    });
  });

  it("accepts zero as a free-channel price", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}free-${randomUUID()}`;
    const channelId = `${fixturePrefix}free-${randomUUID()}`;
    await db.teamGroup.create({
      data: { id: groupId, name: "免费渠道测试组" },
    });
    await db.channel.create({
      data: {
        id: channelId,
        groupId,
        name: "免费渠道",
        normalizedName: "免费渠道",
      },
    });
    const response = await PATCH(
      new Request("http://localhost/api/admin/channels", {
        method: "PATCH",
        body: JSON.stringify(confirmed({
          id: channelId,
          groupId,
          effectiveFanPriceCents: 0,
        })),
      }),
    );
    expect(response.status).toBe(200);
    await expect(
      db.channel.findUnique({
        where: { id_groupId: { id: channelId, groupId } },
        select: { effectiveFanPriceCents: true },
      }),
    ).resolves.toEqual({ effectiveFanPriceCents: 0 });
  });

  it("changes a paid channel back to free and ignores the unchanged UI name", async () => {
    const { currentPassword } = await protectedAdmin();
    const groupId = `${fixturePrefix}pending-${randomUUID()}`;
    const channelId = `${fixturePrefix}pending-${randomUUID()}`;
    await db.teamGroup.create({
      data: { id: groupId, name: "恢复待定价小组" },
    });
    await db.channel.create({
      data: {
        id: channelId,
        groupId,
        name: "真实界面渠道",
        normalizedName: "真实界面渠道",
        fanCostMode: "PAID",
        effectiveFanPriceCents: 5_000,
      },
    });

    const response = await PATCH(
      new Request("http://localhost/api/admin/channels", {
        method: "PATCH",
        body: JSON.stringify({
          id: channelId,
          groupId,
          name: "真实界面渠道",
          effectiveFanPriceCents: null,
          highRiskReason: "投放结束，清空渠道单价",
          currentPassword,
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      fanCostMode: "FREE",
      effectiveFanPriceCents: 0,
    });
    await expect(
      db.channel.findUnique({
        where: { id_groupId: { id: channelId, groupId } },
        select: { fanCostMode: true, effectiveFanPriceCents: true },
      }),
    ).resolves.toEqual({ fanCostMode: "FREE", effectiveFanPriceCents: 0 });
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: channelId, action: "CHANNEL_PRICE_UPDATED" },
    });
    expect(JSON.parse(audit.summary)).toMatchObject({
      changedFields: ["fanCostMode", "effectiveFanPriceCents"],
      name: "真实界面渠道",
      groupId,
      groupName: "恢复待定价小组",
      before: { name: "真实界面渠道", active: true, fanCostMode: "PAID", effectiveFanPriceCents: 5_000 },
      after: { name: "真实界面渠道", active: true, fanCostMode: "FREE", effectiveFanPriceCents: 0 },
      highRiskReason: "投放结束,清空渠道单价",
      reauthenticated: true,
      impact: {
        customerOrders: 0,
        historicalProfitMayChange: true,
        leadCustomers: 0,
        metricEvents: 0,
        sourceBatches: 0,
      },
    });
  });

  it("records accurate before and after values when the UI changes both name and price", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}rename-${randomUUID()}`;
    const channelId = `${fixturePrefix}rename-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "改名改价小组" } });
    await db.channel.create({
      data: {
        id: channelId,
        groupId,
        name: "原渠道名",
        normalizedName: "原渠道名",
        fanCostMode: "PAID",
        effectiveFanPriceCents: 4_000,
      },
    });

    const response = await PATCH(
      new Request("http://localhost/api/admin/channels", {
        method: "PATCH",
        body: JSON.stringify(confirmed({
          id: channelId,
          groupId,
          name: "新渠道名",
          effectiveFanPriceCents: 6_000,
        })),
      }),
    );

    expect(response.status).toBe(200);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: channelId, action: "CHANNEL_PRICE_UPDATED" },
    });
    expect(JSON.parse(audit.summary)).toMatchObject({
      changedFields: ["name", "effectiveFanPriceCents"],
      name: "新渠道名",
      groupId,
      groupName: "改名改价小组",
      before: { name: "原渠道名", effectiveFanPriceCents: 4_000 },
      after: { name: "新渠道名", effectiveFanPriceCents: 6_000 },
    });
  });

  it("does not write an audit when the real UI payload changes nothing", async () => {
    await seededAdmin();
    const groupId = `${fixturePrefix}unchanged-${randomUUID()}`;
    const channelId = `${fixturePrefix}unchanged-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "无变化小组" } });
    await db.channel.create({
      data: {
        id: channelId,
        groupId,
        name: "未变渠道",
        normalizedName: "未变渠道",
        fanCostMode: "PAID",
        effectiveFanPriceCents: 5_000,
      },
    });

    const response = await PATCH(
      new Request("http://localhost/api/admin/channels", {
        method: "PATCH",
        body: JSON.stringify({
          id: channelId,
          groupId,
          name: "未变渠道",
          effectiveFanPriceCents: 5_000,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await db.auditLog.count({ where: { entityId: channelId } })).toBe(0);
  });

  it.each([
    ["negative", -1],
    ["fractional", 12.5],
    ["above Prisma Int", 2_147_483_648],
    ["numeric string", "5000"],
  ])("rejects a %s channel price", async (_label, effectiveFanPriceCents) => {
    await seededAdmin();
    const response = await PATCH(
      new Request("http://localhost/api/admin/channels", {
        method: "PATCH",
        body: JSON.stringify({
          id: "channel-1",
          groupId: "group-a",
          effectiveFanPriceCents,
        }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it.each(["LEAD", "RECEPTION"])(
    "returns 403 when a %s forges a channel price update",
    async () => {
      vi.spyOn(auth, "requireRole").mockRejectedValue(
        new auth.AuthorizationError(undefined, { id: "denied-user", groupId: "denied-team" } as never),
      );
      const response = await PATCH(
        new Request("http://localhost/api/admin/channels", {
          method: "PATCH",
          body: JSON.stringify({
            id: "channel-1",
            groupId: "group-a",
            effectiveFanPriceCents: 5_000,
          }),
        }),
      );
      expect(response.status).toBe(403);
    },
  );
});
