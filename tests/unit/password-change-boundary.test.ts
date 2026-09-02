import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ sessionId: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === "data-statistics-session" && authState.sessionId
      ? { value: authState.sessionId }
      : undefined,
  }),
}));

import { POST as createChannel } from "../../src/app/api/channels/route";
import { POST as changePassword } from "../../src/app/api/auth/change-password/route";
import { POST as logout } from "../../src/app/api/auth/logout/route";
import { hashPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";

const prefix = "password-boundary-";

async function createTemporaryPasswordSession(currentPassword = "temporary-password") {
  const user = await db.user.create({
    data: {
      id: `${prefix}${randomUUID()}`,
      username: `${prefix}${randomUUID()}`,
      name: "强制改密测试成员",
      passwordHash: hashPassword(currentPassword),
      mustChangePassword: true,
      role: "RECEPTION",
      groupId: "group-a",
    },
  });
  const session = await db.session.create({
    data: {
      id: `${prefix}${randomUUID()}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  authState.sessionId = session.id;
  return { user, session, currentPassword };
}

afterEach(async () => {
  authState.sessionId = undefined;
  const users = await db.user.findMany({
    where: { id: { startsWith: prefix } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  await db.auditLog.deleteMany({
    where: { OR: [{ actorId: { in: userIds } }, { entityId: { in: userIds } }] },
  });
  await db.session.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
});

describe.sequential("temporary-password request boundary", () => {
  it("rejects a real business API until the temporary password is changed", async () => {
    await createTemporaryPasswordSession();

    const apiResponse = await createChannel(new Request("http://localhost/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "不应创建的渠道" }),
    }));
    expect(apiResponse.status).toBe(401);
    await expect(apiResponse.json()).resolves.toEqual({ error: "首次登录必须先修改临时密码" });
  });

  it("allows the real change-password route and rejects the revoked session afterwards", async () => {
    const { user, currentPassword } = await createTemporaryPasswordSession();
    const response = await changePassword(new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword: "replacement-password" }),
    }));

    expect(response.status).toBe(200);
    await expect(db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { mustChangePassword: true },
    })).resolves.toEqual({ mustChangePassword: false });
    await expect(db.session.count({ where: { userId: user.id } })).resolves.toBe(0);

    const oldSessionResponse = await createChannel(new Request("http://localhost/api/channels", {
      method: "POST",
      body: JSON.stringify({ name: "旧会话不应创建" }),
    }));
    expect(oldSessionResponse.status).toBe(401);
    await expect(oldSessionResponse.json()).resolves.toEqual({ error: "请先登录" });
  });

  it("allows the real logout route for a temporary-password session", async () => {
    const { user } = await createTemporaryPasswordSession();
    const response = await logout();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    await expect(db.session.count({ where: { userId: user.id } })).resolves.toBe(0);
  });
});
