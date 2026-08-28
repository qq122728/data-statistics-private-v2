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
            "channelType",
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

  it("updates only the composite-key channel copy targeted by groupId", async () => {
    await seededAdmin();
    const channelId = `${fixturePrefix}shared-${randomUUID()}`;
    const firstGroupId = `${fixturePrefix}group-a-${randomUUID()}`;
    const secondGroupId = `${fixturePrefix}group-b-${randomUUID()}`;
    await db.teamGroup.createMany({
      data: [
        { id: firstGroupId, name: "同名测试一组" },
        { id: secondGroupId, name: "同名测试二组" },
      ],
    });
    await db.channel.createMany({
      data: [
        { id: channelId, groupId: firstGroupId, name: "同名渠道", normalizedName: "同名渠道" },
        { id: channelId, groupId: secondGroupId, name: "同名渠道", normalizedName: "同名渠道" },
      ],
    });

    const response = await PATCH(
      new Request("http://localhost/api/admin/channels", {
        method: "PATCH",
        body: JSON.stringify(confirmed({
          id: channelId,
          groupId: firstGroupId,
          name: "改名后的渠道",
        })),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: channelId,
      groupId: firstGroupId,
      name: "改名后的渠道",
    });
    await expect(
      db.channel.findUnique({
        where: { id_groupId: { id: channelId, groupId: secondGroupId } },
        select: { name: true },
      }),
    ).resolves.toEqual({ name: "同名渠道" });
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
      },
    });

    const response = await PATCH(
      new Request("http://localhost/api/admin/channels", {
        method: "PATCH",
        body: JSON.stringify({
          id: channelId,
          groupId,
          name: "未变渠道",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await db.auditLog.count({ where: { entityId: channelId } })).toBe(0);
  });

  it.each(["LEAD", "RECEPTION"])(
    "returns 403 when a %s forges a channel update",
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
            name: "forged",
          }),
        }),
      );
      expect(response.status).toBe(403);
    },
  );
});
