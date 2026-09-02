import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "./db";

const IP_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const ACCOUNT_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const IP_FAILURE_LIMIT = 20;
const ACCOUNT_FAILURE_LIMIT = 8;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const RETENTION_MS = Math.max(IP_FAILURE_WINDOW_MS, ACCOUNT_FAILURE_WINDOW_MS, LOCK_DURATION_MS);

type LoginAttemptIdentity = {
  ip: string;
  username: string;
};

export type LoginAuditIdentity = { userId: string; teamId: string | null };

function key(prefix: "ip" | "account", value: string) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex")}`;
}

async function recordFailure(
  tx: Prisma.TransactionClient,
  attemptKey: string,
  windowMs: number,
  limit: number,
  now: Date,
  auditIdentity?: LoginAuditIdentity | null,
) {
  const existing = await tx.loginThrottleBucket.findUnique({ where: { key: attemptKey } });
  const expired = !existing || existing.windowStartedAt.getTime() + windowMs <= now.getTime();
  const failures = expired ? 1 : existing.failures + 1;
  await tx.loginThrottleBucket.upsert({
    where: { key: attemptKey },
    create: {
      key: attemptKey,
      failures,
      windowStartedAt: now,
      lockedUntil: failures >= limit ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
      touchedAt: now,
      auditUserId: auditIdentity?.userId ?? null,
      auditTeamId: auditIdentity?.teamId ?? null,
    },
    update: {
      failures,
      windowStartedAt: expired ? now : (existing?.windowStartedAt ?? now),
      lockedUntil: failures >= limit
        ? new Date(now.getTime() + LOCK_DURATION_MS)
        : expired
          ? null
          : (existing?.lockedUntil ?? null),
      touchedAt: now,
      ...(auditIdentity === undefined ? {} : {
        auditUserId: auditIdentity?.userId ?? null,
        auditTeamId: auditIdentity?.teamId ?? null,
      }),
    },
  });
}

/** IP 与账号失败次数存入数据库，因此多进程和服务重启后仍共享同一把锁。 */
export async function loginRetryAfterMs(identity: LoginAttemptIdentity, nowMs = Date.now()): Promise<number> {
  const now = new Date(nowMs);
  const rows = await db.loginThrottleBucket.findMany({
    where: { key: { in: [key("ip", identity.ip), key("account", identity.username)] } },
    select: { lockedUntil: true },
  });
  return rows.reduce((remaining, row) => Math.max(remaining, (row.lockedUntil?.getTime() ?? 0) - now.getTime()), 0);
}

export async function recordFailedLogin(
  identity: LoginAttemptIdentity,
  nowMs = Date.now(),
  auditIdentity: LoginAuditIdentity | null = null,
) {
  const now = new Date(nowMs);
  await db.$transaction(async (tx) => {
    await tx.loginThrottleBucket.deleteMany({ where: { touchedAt: { lte: new Date(nowMs - RETENTION_MS) } } });
    await recordFailure(tx, key("ip", identity.ip), IP_FAILURE_WINDOW_MS, IP_FAILURE_LIMIT, now);
    await recordFailure(tx, key("account", identity.username), ACCOUNT_FAILURE_WINDOW_MS, ACCOUNT_FAILURE_LIMIT, now, auditIdentity);
  }, { isolationLevel: "Serializable" });
}

export async function loginAuditIdentity(identity: LoginAttemptIdentity): Promise<LoginAuditIdentity | null> {
  const attempt = await db.loginThrottleBucket.findUnique({
    where: { key: key("account", identity.username) },
    select: { auditUserId: true, auditTeamId: true },
  });
  return attempt?.auditUserId ? { userId: attempt.auditUserId, teamId: attempt.auditTeamId } : null;
}

export async function recordSuccessfulLogin(identity: LoginAttemptIdentity) {
  await db.loginThrottleBucket.delete({ where: { key: key("account", identity.username) } }).catch(() => undefined);
}

/** 仅供单元测试清理数据库节流状态。 */
export async function resetLoginThrottleForTests() {
  await db.loginThrottleBucket.deleteMany();
}
