import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/app/api/auth/login/route";
import { POST as createChannel } from "../../src/app/api/channels/route";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { resetLoginThrottleForTests } from "../../src/lib/login-throttle";
import { authorizationDenied, recordSecurityEvent } from "../../src/lib/security-events";

const loginUserId = "log-02-login-chain-user";

function securityEvents(info: ReturnType<typeof vi.spyOn>) {
  return info.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}

function expectFixedEvent(event: Record<string, unknown>, expectedEvent: string) {
  expect(Object.keys(event).sort()).toEqual([
    "category",
    "event",
    "result",
    "teamId",
    "timestamp",
    "userId",
  ]);
  expect(event.event).toBe(expectedEvent);
}

describe("privacy-safe security events", () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

  beforeEach(async () => {
    info.mockClear();
    await resetLoginThrottleForTests();
  });

  afterEach(async () => {
    await resetLoginThrottleForTests();
    await db.session.deleteMany({ where: { userId: loginUserId } });
    await db.user.deleteMany({ where: { id: loginUserId } });
  });

  it("serializes only the fixed security-event fields", () => {
    recordSecurityEvent({
      event: "AUTHORIZATION_DENIED",
      userId: "internal-user-1",
      teamId: "internal-team-1",
      result: "denied",
    });

    const output = String(info.mock.calls[0]?.[0]);
    const parsed = JSON.parse(output);
    expect(Object.keys(parsed).sort()).toEqual([
      "category",
      "event",
      "result",
      "teamId",
      "timestamp",
      "userId",
    ]);
    expect(parsed).toMatchObject({
      category: "security",
      event: "AUTHORIZATION_DENIED",
      userId: "internal-user-1",
      teamId: "internal-team-1",
      result: "denied",
    });
  });

  it("does not copy login credentials or usernames into a failed-login event", async () => {
    const secret = "LOG02-controlled-password-marker";
    const username = "missing-LOG02-controlled-user-marker";
    const response = await POST(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.8" },
      body: JSON.stringify({ username, password: secret }),
    }));

    expect(response.status).toBe(401);
    const output = info.mock.calls.flat().join("\n");
    expect(output).toContain('"event":"LOGIN_FAILURE"');
    expect(output).not.toContain(secret);
    expect(output).not.toContain(username);
    expect(output).not.toContain("203.0.113.8");
    expect(output).not.toMatch(/password|token|phone|customerName/i);
  });

  it("records login success through the real database-backed route", async () => {
    await db.user.create({ data: {
      id: loginUserId,
      username: "log-02-login-chain",
      name: "LOG-02 测试账号",
      passwordHash: auth.hashPassword("LOG-02-safe-test-password"),
      role: "RECEPTION",
      groupId: "group-a",
    } });

    const response = await POST(new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.10" },
      body: JSON.stringify({
        username: "log-02-login-chain",
        password: "LOG-02-safe-test-password",
      }),
    }));

    expect(response.status).toBe(200);
    const [event] = securityEvents(info);
    expectFixedEvent(event, "LOGIN_SUCCESS");
    expect(event).toMatchObject({ userId: loginUserId, teamId: "group-a", result: "success" });
  });

  it("records one fixed-schema lock event through the real throttled route", async () => {
    const lockedRequest = () => new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.11" },
      body: JSON.stringify({ username: "admin", password: "wrong-password" }),
    });
    for (let count = 0; count < 8; count += 1) expect((await POST(lockedRequest())).status).toBe(401);
    expect((await POST(lockedRequest())).status).toBe(429);

    const event = securityEvents(info).at(-1)!;
    expectFixedEvent(event, "LOGIN_LOCKED");
    expect(event).toMatchObject({ userId: "admin-1", teamId: null, result: "locked" });
  });

  it("records a direct role denial through a real API route", async () => {
    const member = await db.user.findUniqueOrThrow({ where: { id: "member-1" } });
    const requireUser = vi.spyOn(auth, "requireUser").mockResolvedValue(member);
    try {
      const response = await createChannel(new Request("http://localhost/api/channels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "must-not-be-created" }),
      }));
      expect(response.status).toBe(403);
      expect(response.headers.get("X-Security-Audit")).toBe("app");
      const [event] = securityEvents(info);
      expectFixedEvent(event, "AUTHORIZATION_DENIED");
      expect(event).toMatchObject({ userId: "member-1", teamId: "group-a", result: "denied" });
    } finally {
      requireUser.mockRestore();
    }
  });

  it("does not attribute a later anonymous 403 to an earlier successful request", async () => {
    const response = NextResponse.json({ error: "anonymous" }, { status: 403 });
    expect(response.headers.get("X-Security-Audit")).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it("keeps parallel authorization denials assigned to their explicit actors", async () => {
    await Promise.all([
      Promise.resolve().then(() => authorizationDenied({ id: "actor-a", groupId: "team-a" }, "denied")),
      Promise.resolve().then(() => authorizationDenied({ id: "actor-b", groupId: "team-b" }, "denied")),
    ]);
    expect(securityEvents(info).map(({ userId, teamId }) => ({ userId, teamId }))).toEqual([
      { userId: "actor-a", teamId: "team-a" },
      { userId: "actor-b", teamId: "team-b" },
    ]);
  });

  it("ships privacy-preserving Nginx and PostgreSQL templates", () => {
    const nginx = readFileSync("ops/nginx/data-statistics-logging.conf", "utf8");
    const postgres = readFileSync("ops/postgresql/LOG-02-logging.conf", "utf8");
    const rotation = readFileSync("ops/logrotate/data-statistics-jobs", "utf8");
    const serviceLogging = readFileSync(
      "ops/systemd/data-statistics.service.d/LOG-02-logging.conf",
      "utf8",
    );
    const journalRetention = readFileSync("ops/systemd/journald-LOG-02.conf", "utf8");
    const capacityService = readFileSync(
      "ops/systemd/data-statistics-log-capacity-check.service",
      "utf8",
    );
    const suppressionService = readFileSync(
      "ops/systemd/data-statistics-journal-suppression-check.service",
      "utf8",
    );
    const suppressionTimer = readFileSync(
      "ops/systemd/data-statistics-journal-suppression-check.timer",
      "utf8",
    );
    const alertService = readFileSync("ops/systemd/data-statistics-log-alert@.service", "utf8");
    const alertScript = readFileSync("ops/scripts/send-data-statistics-log-alert.sh", "utf8");
    const suppressionScript = readFileSync("ops/scripts/check-journal-suppression.sh", "utf8");
    const nginxVerification = readFileSync("ops/scripts/verify-nginx-security-logging.sh", "utf8");

    expect(nginx).toContain('"method":"$request_method"');
    expect(nginx).toContain('"path":"$uri"');
    expect(nginx).not.toContain("$request_uri");
    expect(nginx).not.toContain("$args");
    expect(nginx).not.toContain("$http_referer");
    expect(nginx).not.toContain("$remote_addr");
    expect(nginx).not.toContain("$remote_user");
    expect(nginx).not.toContain("$http_user_agent");
    expect(nginx).toContain('"event":"AUTHORIZATION_DENIED"');
    expect(nginx).toContain('"userId":null');
    expect(nginx).toContain('"teamId":null');
    expect(nginx).toContain('"403:" 1');
    expect(nginx).toContain("proxy_hide_header X-Security-Audit");
    expect(postgres).toContain("log_connections = on");
    expect(postgres).toContain("log_min_duration_statement = 1000");
    expect(postgres).toContain("log_parameter_max_length = 0");
    expect(postgres).toContain("log_statement = 'none'");
    expect(postgres).toContain("log_hostname = off");
    expect(postgres).not.toContain("%h");
    expect(rotation).toContain("rotate 14");
    expect(rotation).toContain("maxsize 100M");
    expect(serviceLogging).toContain("LogRateLimitIntervalSec=30s");
    expect(serviceLogging).toContain("LogRateLimitBurst=1000");
    expect(journalRetention).toContain("SystemMaxUse=1G");
    expect(journalRetention).toContain("MaxRetentionSec=14day");
    expect(capacityService).toContain("OnFailure=data-statistics-log-alert@%n.service");
    expect(capacityService).toContain("EnvironmentFile=/etc/data-statistics/log-monitor.env");
    expect(suppressionService).toContain("OnFailure=data-statistics-log-alert@%n.service");
    expect(suppressionTimer).toContain("OnUnitActiveSec=5min");
    expect(alertService).toContain("send-data-statistics-log-alert");
    expect(alertScript).toContain("LOG02_ALERT_WEBHOOK_URL");
    expect(alertScript).toContain("--proto '=https'");
    expect(suppressionScript).toContain("Suppressed ([1-9][0-9]*) messages?");
    expect(suppressionScript).not.toContain("print(message)");
    expect(nginxVerification).toContain("urlsplit(self.path).path");
    expect(nginxVerification).not.toContain('self.path == "/ok"');
    expect(nginxVerification).toContain("mktemp -d /tmp/data-statistics-nginx.XXXXXX");
    expect(nginxVerification).toContain('chmod 0755 "$TEST_PREFIX"');
    expect(nginxVerification).toContain('install -m 0644 "$REPO_ROOT/ops/nginx/$source"');
    expect(nginxVerification).toContain('nginx -p "$TEST_PREFIX/"');
    expect(nginxVerification).not.toMatch(/chmod[^\n]*(?:REPO_ROOT|GITHUB|\/home\/runner)/);
  });
});
