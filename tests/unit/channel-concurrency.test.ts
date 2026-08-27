import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { POST as postBatches } from "../../src/app/api/batches/route";
import { isConcurrentChannelCreateError, isRetryableSqliteTransactionError, resolveOrCreateChannel } from "../../src/lib/channels";
import { db } from "../../src/lib/db";
import { newFansPayload } from "./helpers/new-fans-payload";

const createdNames: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const name of createdNames) {
    const channels = await db.channel.findMany({ where: { groupId: "group-a", normalizedName: name }, select: { id: true } });
    const batches = await db.sourceBatch.findMany({ where: { groupId: "group-a", channelId: { in: channels.map((channel) => channel.id) } }, select: { id: true } });
    await db.metricEvent.deleteMany({ where: { batchId: { in: batches.map((batch) => batch.id) } } });
    await db.sourceBatch.deleteMany({ where: { id: { in: batches.map((batch) => batch.id) } } });
    await db.auditLog.deleteMany({ where: { summary: { contains: name } } });
    await db.channel.deleteMany({ where: { groupId: "group-a", normalizedName: name } });
  }
  createdNames.length = 0;
});

describe.sequential("concurrent channel creation", () => {
  it("reuses the single winning channel and audits only its creator", async () => {
    const normalizedName = `concurrent-${randomUUID()}`;
    createdNames.push(normalizedName);
    const actor = await db.user.findUniqueOrThrow({ where: { id: "admin-1" } });

    const channels = await Promise.all([
      resolveOrCreateChannel(db, { actor, groupId: "group-a", channelName: normalizedName }),
      resolveOrCreateChannel(db, { actor, groupId: "group-a", channelName: normalizedName }),
    ]);

    expect(channels[0].id).toBe(channels[1].id);
    expect(await db.channel.count({ where: { groupId: "group-a", normalizedName } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "CHANNEL_CREATED", summary: { contains: normalizedName } } })).toBe(1);
  });

  it("does not disguise unrelated Prisma failures as a channel-name race", () => {
    const unrelatedUnique = Object.assign(new Error("Unique constraint failed on username"), {
      code: "P2002",
      meta: { modelName: "User", target: ["username"] },
    });
    const unrelatedTransaction = Object.assign(new Error("Transaction already closed"), { code: "P2028" });

    expect(isConcurrentChannelCreateError(unrelatedUnique)).toBe(false);
    expect(isConcurrentChannelCreateError(unrelatedTransaction)).toBe(false);
    expect(isRetryableSqliteTransactionError(unrelatedTransaction)).toBe(false);
  });

  it("lets an SQLite busy error escape channel resolution for outer transaction retry", async () => {
    const busy = Object.assign(new Error("database is locked"), { code: "P1008" });
    const client = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: "admin-1", role: "ADMIN", active: true, groupId: null, roleAssignments: [] }) },
      teamGroup: { findUnique: vi.fn().mockResolvedValue({ id: "group-a", active: true }) },
      channel: {
        findUnique: vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(busy),
        findFirst: vi.fn().mockRejectedValue(busy),
        create: vi.fn().mockRejectedValue(busy),
      },
      auditLog: { create: vi.fn() },
    };

    await expect(resolveOrCreateChannel(client as never, {
      actor: { id: "admin-1", role: "ADMIN", active: true, groupId: null },
      groupId: "group-a",
      channelName: "并发渠道",
    })).rejects.toBe(busy);
  });

  it("does not let reception create a channel through batch import", async () => {
    const normalizedName = `busy-winner-${randomUUID()}`;
    createdNames.push(normalizedName);
    const actor = await db.user.findUniqueOrThrow({ where: { id: "member-1" } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);

    const response = await postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify(newFansPayload({ channelName: normalizedName })),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "只能选择已有渠道；新增渠道请联系公司管理员、资源部管理员或超级管理员" });
    expect(await db.channel.count({ where: { groupId: "group-a", normalizedName } })).toBe(0);
  });

  it("returns a stable busy response only after transaction retries are exhausted", async () => {
    const actor = await db.user.findUniqueOrThrow({ where: { id: "member-1" } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);
    const transaction = vi.spyOn(db, "$transaction").mockRejectedValue(Object.assign(new Error("database is locked"), { code: "P1008" }));

    const response = await postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify(newFansPayload({ channelName: "并发渠道" })),
    }));

    expect(transaction).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("系统正忙，请稍后重试");
  });

  it("does not swallow unrelated database errors in the batch route", async () => {
    const unrelatedUnique = Object.assign(new Error("Unique constraint failed on username"), {
      code: "P2002",
      meta: { modelName: "User", target: ["username"] },
    });
    const unrelatedTransaction = Object.assign(new Error("Transaction already closed"), { code: "P2028" });
    const actor = await db.user.findUniqueOrThrow({ where: { id: "member-1" } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);
    const transaction = vi.spyOn(db, "$transaction")
      .mockRejectedValueOnce(unrelatedUnique)
      .mockRejectedValueOnce(unrelatedTransaction);

    await expect(postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify(newFansPayload({ channelName: "无关错误测试" })),
    }))).rejects.toBe(unrelatedUnique);
    await expect(postBatches(new Request("http://localhost/api/batches", {
      method: "POST",
      body: JSON.stringify(newFansPayload({ channelName: "无关错误测试" })),
    }))).rejects.toBe(unrelatedTransaction);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
