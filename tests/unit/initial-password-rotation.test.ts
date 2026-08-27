import { describe, expect, it, vi } from "vitest";

import {
  INITIAL_PASSWORD_MAX_LENGTH,
  INITIAL_USERNAME_MAX_LENGTH,
  parseInitialPasswordEntries,
  rotateInitialAccountPasswords,
} from "../../scripts/rotate-initial-account-passwords-lib.mjs";

describe("initial account password rotation", () => {
  it("rejects the entire file when one otherwise valid account has an 8-character password", () => {
    const update = vi.fn();
    const contents = JSON.stringify({
      admin: "valid-admin-password",
      resource: "12345678",
    });

    expect(() => {
      const entries = parseInitialPasswordEntries(contents);
      update(entries);
    }).toThrow('账号 "resource" 的密码少于 12 位，已拒绝整批轮换。');
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects the entire file when any password is not a string", () => {
    expect(() => parseInitialPasswordEntries(JSON.stringify({
      admin: "valid-admin-password",
      resource: 123456789012,
    }))).toThrow('账号 "resource" 的密码必须是字符串，已拒绝整批轮换。');
  });

  it("rejects an entry-array shape that can contain a non-string username", () => {
    expect(() => parseInitialPasswordEntries(JSON.stringify([
      ["admin", "valid-admin-password"],
      [123, "valid-resource-password"],
    ]))).toThrow("密码文件必须是 JSON 对象");
  });

  it("returns every entry when the whole password file is valid", () => {
    expect(parseInitialPasswordEntries(JSON.stringify({
      admin: "valid-admin-password",
      resource: "valid-resource-password",
    }))).toEqual([
      ["admin", "valid-admin-password"],
      ["resource", "valid-resource-password"],
    ]);
  });

  it("accepts exact username/password maxima and rejects maximum plus one", () => {
    const boundaryUsername = "u".repeat(INITIAL_USERNAME_MAX_LENGTH);
    const boundaryPassword = "p".repeat(INITIAL_PASSWORD_MAX_LENGTH);
    expect(parseInitialPasswordEntries(JSON.stringify({
      admin: boundaryPassword,
      [boundaryUsername]: boundaryPassword,
    }))).toEqual([
      ["admin", boundaryPassword],
      [boundaryUsername, boundaryPassword],
    ]);

    expect(() => parseInitialPasswordEntries(JSON.stringify({
      admin: "valid-admin-password",
      ["u".repeat(INITIAL_USERNAME_MAX_LENGTH + 1)]: "valid-resource-password",
    }))).toThrow(`超过 ${INITIAL_USERNAME_MAX_LENGTH} 位`);
    expect(() => parseInitialPasswordEntries(JSON.stringify({
      admin: "valid-admin-password",
      resource: "p".repeat(INITIAL_PASSWORD_MAX_LENGTH + 1),
    }))).toThrow(`超过 ${INITIAL_PASSWORD_MAX_LENGTH} 位`);
  });

  it("prevalidates the whole direct-call batch before transaction or scrypt", async () => {
    const transaction = vi.fn();
    const hashPassword = vi.fn();
    await expect(rotateInitialAccountPasswords(
      { $transaction: transaction },
      [{ id: "admin-id", username: "admin" }, { id: "resource-id", username: "resource" }],
      [["admin", "valid-admin-password"], ["resource", "p".repeat(INITIAL_PASSWORD_MAX_LENGTH + 1)]],
      hashPassword,
    )).rejects.toThrow(`超过 ${INITIAL_PASSWORD_MAX_LENGTH} 位`);
    expect(transaction).not.toHaveBeenCalled();
    expect(hashPassword).not.toHaveBeenCalled();
  });

  it("marks every rotated password as temporary and revokes every old session", async () => {
    const update = vi.fn(async () => ({}));
    const deleteMany = vi.fn(async () => ({ count: 2 }));
    const client = { user: { update }, session: { deleteMany } };
    const database: Parameters<typeof rotateInitialAccountPasswords>[0] = {
      $transaction: async (callback) => callback(client),
    };

    await rotateInitialAccountPasswords(
      database,
      [
        { id: "admin-id", username: "admin" },
        { id: "resource-id", username: "resource" },
      ],
      [
        ["admin", "temporary-admin-password"],
        ["resource", "temporary-resource-password"],
      ],
      (password) => `hashed:${password}`,
    );

    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: "admin-id" },
      data: {
        passwordHash: "hashed:temporary-admin-password",
        mustChangePassword: true,
      },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: "resource-id" },
      data: {
        passwordHash: "hashed:temporary-resource-password",
        mustChangePassword: true,
      },
    });
    expect(deleteMany).toHaveBeenNthCalledWith(1, { where: { userId: "admin-id" } });
    expect(deleteMany).toHaveBeenNthCalledWith(2, { where: { userId: "resource-id" } });
  });
});
