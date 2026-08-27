import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as changePassword } from "../../src/app/api/auth/change-password/route";
import * as auth from "../../src/lib/auth";
import {
  assertPasswordChangeCompleted,
  hashPassword,
  PasswordChangeRequiredError,
  verifyPassword,
} from "../../src/lib/auth";
import { db } from "../../src/lib/db";

const prefix = "password-hardening-";

afterEach(async () => {
  vi.restoreAllMocks();
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

describe.sequential("password hardening", () => {
  it("blocks business access while allowing the password-change flow", () => {
    expect(() => assertPasswordChangeCompleted({ mustChangePassword: true }))
      .toThrow(PasswordChangeRequiredError);
    expect(() => assertPasswordChangeCompleted({ mustChangePassword: true }, true))
      .not.toThrow();
    expect(() => assertPasswordChangeCompleted({ mustChangePassword: false }))
      .not.toThrow();
  });

  it("rejects 6- and 8-character self-service passwords", async () => {
    const user = await db.user.create({
      data: {
        id: `${prefix}${randomUUID()}`,
        username: `${prefix}${randomUUID()}`,
        name: "弱密码测试成员",
        passwordHash: hashPassword("temporary-password"),
        mustChangePassword: true,
        role: "RECEPTION",
        groupId: "group-a",
      },
    });
    vi.spyOn(auth, "requireUser").mockResolvedValue(user);

    for (const newPassword of ["123456", "12345678"]) {
      const response = await changePassword(new Request("http://localhost/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: "temporary-password", newPassword }),
      }));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: "新密码至少需要 12 位" });
    }

    await expect(db.user.findUniqueOrThrow({ where: { id: user.id }, select: { mustChangePassword: true } }))
      .resolves.toEqual({ mustChangePassword: true });
  });

  it("clears the temporary-password state and revokes every old session", async () => {
    const currentPassword = "temporary-password";
    const newPassword = "replacement-password";
    const user = await db.user.create({
      data: {
        id: `${prefix}${randomUUID()}`,
        username: `${prefix}${randomUUID()}`,
        name: "首次改密成员",
        passwordHash: hashPassword(currentPassword),
        mustChangePassword: true,
        role: "RECEPTION",
        groupId: "group-a",
      },
    });
    await db.session.createMany({
      data: [
        { id: `${prefix}${randomUUID()}`, userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
        { id: `${prefix}${randomUUID()}`, userId: user.id, expiresAt: new Date(Date.now() + 120_000) },
      ],
    });
    vi.spyOn(auth, "requireUser").mockResolvedValue(user);

    const response = await changePassword(new Request("http://localhost/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }));

    expect(response.status).toBe(200);
    const updated = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true, mustChangePassword: true },
    });
    expect(updated.mustChangePassword).toBe(false);
    expect(verifyPassword(currentPassword, updated.passwordHash)).toBe(false);
    expect(verifyPassword(newPassword, updated.passwordHash)).toBe(true);
    await expect(db.session.count({ where: { userId: user.id } })).resolves.toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { actorId: user.id, entityId: user.id, action: "SELF_PASSWORD_CHANGED" },
    });
    expect(audit.summary).not.toContain(currentPassword);
    expect(audit.summary).not.toContain(newPassword);
  });
});
