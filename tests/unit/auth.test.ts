import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../../src/lib/db";
import {
  authenticateUser,
  createSession,
  getSessionUser,
  hashPassword,
} from "../../src/lib/auth";

const testUserIds = ["auth-duplicate-a", "auth-duplicate-b"];
const testSessionIds = ["expired-session"];

beforeEach(async () => {
  await db.session.deleteMany({ where: { id: { in: testSessionIds } } });
});

afterEach(async () => {
  await db.session.deleteMany({ where: { id: { in: testSessionIds } } });
  await db.session.deleteMany({ where: { userId: { in: testUserIds } } });
  await db.user.deleteMany({ where: { id: { in: testUserIds } } });
});

describe("database-backed authentication", () => {
  it("rejects a forged session cookie value", async () => {
    await expect(getSessionUser("forged-session-id")).resolves.toBeNull();
  });

  it("rejects an expired session and removes it", async () => {
    const session = await db.session.create({
      data: { id: "expired-session", userId: "admin-1", expiresAt: new Date(0) },
    });

    await expect(getSessionUser(session.id)).resolves.toBeNull();
    await expect(db.session.findUnique({ where: { id: session.id } })).resolves.toBeNull();
  });

  it("rejects a revoked session", async () => {
    const session = await createSession("admin-1");
    await db.session.delete({ where: { id: session.id } });

    await expect(getSessionUser(session.id)).resolves.toBeNull();
  });

  it("uses a unique username rather than an ambiguous display name", async () => {
    await db.user.createMany({
      data: [
        {
          id: "auth-duplicate-a",
          username: "duplicate-a",
          name: "同名员工",
          passwordHash: hashPassword("password-a"),
          role: "RECEPTION",
          groupId: "group-a",
        },
        {
          id: "auth-duplicate-b",
          username: "duplicate-b",
          name: "同名员工",
          passwordHash: hashPassword("password-b"),
          role: "RECEPTION",
          groupId: "group-a",
        },
      ],
    });

    await expect(authenticateUser("duplicate-b", "password-b")).resolves.toMatchObject({
      id: "auth-duplicate-b",
      username: "duplicate-b",
    });
    await expect(authenticateUser("同名员工", "password-a")).resolves.toBeNull();
  });

  it("loads the account's additional frontline role with its session", async () => {
    await db.user.create({
      data: {
        id: "auth-duplicate-a",
        username: "dual-role-user",
        name: "兼任员工",
        passwordHash: hashPassword("password-a"),
        role: "RECEPTION",
        groupId: "group-a",
        roleAssignments: { create: { role: "GROUP_OPERATOR" } },
      },
    });
    const session = await createSession("auth-duplicate-a");

    await expect(getSessionUser(session.id)).resolves.toMatchObject({
      role: "RECEPTION",
      roleAssignments: [{ role: "GROUP_OPERATOR" }],
    });
  });
});
