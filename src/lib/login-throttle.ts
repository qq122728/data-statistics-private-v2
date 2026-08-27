const IP_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const ACCOUNT_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const IP_FAILURE_LIMIT = 20;
const ACCOUNT_FAILURE_LIMIT = 8;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const MAX_TRACKED_KEYS = 5_000;

type Attempt = {
  failures: number;
  windowStartedAt: number;
  lockedUntil: number | null;
  touchedAt: number;
  auditIdentity?: LoginAuditIdentity | null;
};

type LoginAttemptIdentity = {
  ip: string;
  username: string;
};

export type LoginAuditIdentity = { userId: string; teamId: string | null };

const attempts = new Map<string, Attempt>();

function key(prefix: "ip" | "account", value: string) {
  return `${prefix}:${value}`;
}

function prune(now: number) {
  for (const [attemptKey, attempt] of attempts) {
    const retention = Math.max(IP_FAILURE_WINDOW_MS, ACCOUNT_FAILURE_WINDOW_MS, LOCK_DURATION_MS);
    if (attempt.touchedAt + retention <= now) attempts.delete(attemptKey);
  }
  while (attempts.size > MAX_TRACKED_KEYS) {
    const oldestKey = attempts.keys().next().value;
    if (!oldestKey) break;
    attempts.delete(oldestKey);
  }
}

function remainingLockMs(attemptKey: string, now: number): number {
  const attempt = attempts.get(attemptKey);
  if (!attempt?.lockedUntil || attempt.lockedUntil <= now) return 0;
  return attempt.lockedUntil - now;
}

/**
 * 使用 IP 和账号两个维度限速。IP 防止单一来源轰炸，账号防止分布式撞库；
 * 仅保存在当前应用进程，边缘 Nginx 还会提供独立的 IP 限流。
 */
export function loginRetryAfterMs(identity: LoginAttemptIdentity, now = Date.now()): number {
  prune(now);
  return Math.max(
    remainingLockMs(key("ip", identity.ip), now),
    remainingLockMs(key("account", identity.username), now),
  );
}

function recordFailure(
  attemptKey: string,
  windowMs: number,
  limit: number,
  now: number,
  auditIdentity?: LoginAuditIdentity | null,
) {
  const existing = attempts.get(attemptKey);
  const attempt = !existing || existing.windowStartedAt + windowMs <= now
    ? { failures: 0, windowStartedAt: now, lockedUntil: null, touchedAt: now }
    : existing;
  attempt.failures += 1;
  attempt.touchedAt = now;
  if (auditIdentity !== undefined) attempt.auditIdentity = auditIdentity;
  if (attempt.failures >= limit) attempt.lockedUntil = now + LOCK_DURATION_MS;
  attempts.set(attemptKey, attempt);
}

export function recordFailedLogin(
  identity: LoginAttemptIdentity,
  now = Date.now(),
  auditIdentity: LoginAuditIdentity | null = null,
) {
  prune(now);
  recordFailure(key("ip", identity.ip), IP_FAILURE_WINDOW_MS, IP_FAILURE_LIMIT, now);
  recordFailure(
    key("account", identity.username),
    ACCOUNT_FAILURE_WINDOW_MS,
    ACCOUNT_FAILURE_LIMIT,
    now,
    auditIdentity,
  );
}

export function loginAuditIdentity(identity: LoginAttemptIdentity): LoginAuditIdentity | null {
  return attempts.get(key("account", identity.username))?.auditIdentity ?? null;
}

export function recordSuccessfulLogin(identity: LoginAttemptIdentity) {
  attempts.delete(key("account", identity.username));
}

/** 仅供单元测试隔离进程内的节流状态。 */
export function resetLoginThrottleForTests() {
  attempts.clear();
}
