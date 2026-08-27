import { NextResponse } from "next/server";

export type SecurityEventName =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "LOGIN_LOCKED"
  | "AUTHORIZATION_DENIED";

export type SecurityEvent = {
  event: SecurityEventName;
  userId: string | null;
  teamId: string | null;
  result: "success" | "failure" | "locked" | "denied";
};

/**
 * Security events deliberately use a closed schema. Do not add usernames, names,
 * phone numbers, request bodies, credentials, tokens, cookies, or IP addresses.
 */
export function recordSecurityEvent(event: SecurityEvent): void {
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    category: "security",
    event: event.event,
    userId: event.userId,
    teamId: event.teamId,
    result: event.result,
  }));
}

export type SecurityEventActor = {
  id: string;
  groupId?: string | null;
};

/**
 * Use this for application-owned HTTP 403 responses. The marker lets Nginx avoid
 * duplicating the event while its status-based fallback catches only Nginx-owned
 * or otherwise actorless 403 paths.
 */
export function authorizationDenied(
  actor: SecurityEventActor,
  message: string,
  details: Record<string, unknown> = {},
) {
  recordSecurityEvent({
    event: "AUTHORIZATION_DENIED",
    userId: actor.id,
    teamId: actor.groupId ?? null,
    result: "denied",
  });
  return NextResponse.json(
    { ...details, error: message },
    { status: 403, headers: { "X-Security-Audit": "app" } },
  );
}

export function authorizationErrorResponse(
  error: { actor: SecurityEventActor },
  message = "没有权限执行此操作",
) {
  return authorizationDenied(error.actor, message);
}
