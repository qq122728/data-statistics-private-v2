import type { Prisma, PrismaClient, Role } from "@prisma/client";
import { verifyPassword } from "../../../lib/auth";
import { parseHighRiskReason } from "../../../lib/high-risk-reason";
import { API_LIMITS } from "../../../lib/request-limits";

type HighRiskClient = Prisma.TransactionClient | Pick<PrismaClient, "user">;

export type HighRiskRequest = {
  highRiskReason?: unknown;
  currentPassword?: unknown;
};

export type HighRiskAuthorization = {
  highRiskReason: string;
  reauthenticated: true;
};

export class HighRiskAuthorizationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403,
  ) {
    super(message);
    this.name = "HighRiskAuthorizationError";
  }
}

/**
 * Re-check a high-risk admin operation against the password hash currently in
 * the database. Keeping this check inside the mutation transaction means a
 * forged or stale frontend request cannot bypass it.
 */
export async function authorizeHighRiskOperation(
  client: HighRiskClient,
  actorId: string,
  input: HighRiskRequest,
  allowedRoles: Role[] = ["ADMIN"],
  credentialLabel = "管理员",
): Promise<HighRiskAuthorization> {
  const reason = parseHighRiskReason(input.highRiskReason);
  if (!reason.success) throw new HighRiskAuthorizationError(reason.error, 400);

  const currentPassword = typeof input.currentPassword === "string"
    ? input.currentPassword
    : "";
  if (!currentPassword) {
    throw new HighRiskAuthorizationError(`请输入当前${credentialLabel}密码`, 400);
  }
  if (currentPassword.length > API_LIMITS.loginPasswordCharacters) {
    throw new HighRiskAuthorizationError(`当前${credentialLabel}密码长度超过限制`, 400);
  }

  const actor = await client.user.findUnique({
    where: { id: actorId },
    select: { role: true, active: true, passwordHash: true },
  });
  if (
    !actor ||
    !actor.active ||
    !allowedRoles.includes(actor.role) ||
    !verifyPassword(currentPassword, actor.passwordHash)
  ) {
    throw new HighRiskAuthorizationError(`当前${credentialLabel}密码不正确`, 403);
  }

  return { highRiskReason: reason.value, reauthenticated: true };
}
