import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Role, User } from "@prisma/client";
import { cookies } from "next/headers";
import { db } from "./db";
import { hasAssignedRole } from "./role-access";

export const SESSION_COOKIE = "data-statistics-session";
export const PASSWORD_MIN_LENGTH = 12;
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionUser = User & {
  roleAssignments?: Array<{ role: Role }>;
  resourceChannelAccess?: Array<{ channelId: string }>;
  managedDepartments?: Array<{ departmentId: string }>;
};

export class AuthenticationError extends Error {
  constructor(message = "请先登录") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message: string | undefined, readonly actor: SessionUser) {
    super(message ?? "没有权限执行此操作");
    this.name = "AuthorizationError";
  }
}

export class PasswordChangeRequiredError extends AuthenticationError {
  constructor() {
    super("首次登录必须先修改临时密码");
    this.name = "PasswordChangeRequiredError";
  }
}

export function assertPasswordChangeCompleted(
  user: Pick<User, "mustChangePassword">,
  allowPasswordChangeRequired = false,
): void {
  if (user.mustChangePassword && !allowPasswordChangeRequired) {
    throw new PasswordChangeRequiredError();
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [salt, storedHash] = passwordHash.split(":");
  if (!salt || !storedHash) {
    return false;
  }

  const calculatedHash = scryptSync(password, salt, 64).toString("hex");
  const stored = Buffer.from(storedHash, "hex");
  const calculated = Buffer.from(calculatedHash, "hex");
  return stored.length === calculated.length && timingSafeEqual(stored, calculated);
}

export async function createSession(userId: string) {
  return db.session.create({
    data: {
      id: randomBytes(32).toString("hex"),
      userId,
      expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
    },
  });
}

export async function getSessionUser(sessionId?: string): Promise<SessionUser | null> {
  if (!sessionId) {
    return null;
  }

  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: { user: { include: { roleAssignments: { select: { role: true } }, resourceChannelAccess: { select: { channelId: true } }, managedDepartments: { select: { departmentId: true } } } }, },
  });

  if (!session || session.expiresAt <= new Date() || !session.user.active) {
    if (session) {
      await db.session.delete({ where: { id: session.id } });
    }
    return null;
  }

  return session.user;
}

export async function authenticateUser(
  username: string,
  password: string,
): Promise<User | null> {
  return (await authenticateUserWithIdentity(username, password)).user;
}

export type AuthenticationResult = {
  user: User | null;
  auditIdentity: { userId: string; teamId: string | null } | null;
};

export async function authenticateUserWithIdentity(
  username: string,
  password: string,
): Promise<AuthenticationResult> {
  const user = await db.user.findUnique({ where: { username } });
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
    return {
      user: null,
      auditIdentity: user ? { userId: user.id, teamId: user.groupId } : null,
    };
  }
  return { user, auditIdentity: { userId: user.id, teamId: user.groupId } };
}

export async function requireUser(options?: { allowPasswordChangeRequired?: boolean }): Promise<SessionUser> {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  const user = await getSessionUser(sessionId);
  if (!user) {
    throw new AuthenticationError();
  }
  assertPasswordChangeCompleted(user, options?.allowPasswordChangeRequired);
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.some((role) => hasAssignedRole(user, role))) {
    throw new AuthorizationError(undefined, user);
  }
  return user;
}

export async function deleteSession(sessionId?: string) {
  if (sessionId) {
    await db.session.deleteMany({ where: { id: sessionId } });
  }
}

export function configuredSessionCookieDomain(value?: string): string | undefined {
  const domain = value?.trim().toLowerCase();
  if (!domain) return undefined;
  const hostname = domain.startsWith(".") ? domain.slice(1) : domain;
  const hostnamePattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const isIpv4Address = hostname.split(".").length === 4 && hostname.split(".").every((part) => /^\d{1,3}$/.test(part));
  if (!hostnamePattern.test(hostname) || isIpv4Address) {
    throw new Error("SESSION_COOKIE_DOMAIN 必须是允许共享登录的纯域名，不能包含协议、端口或路径");
  }
  return domain;
}

const sharedSessionCookieDomain = configuredSessionCookieDomain(process.env.SESSION_COOKIE_DOMAIN);

export const sessionCookie = {
  httpOnly: true,
  maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  ...(sharedSessionCookieDomain ? { domain: sharedSessionCookieDomain } : {}),
};
