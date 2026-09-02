import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as auth from "../../src/lib/auth";
import * as settings from "../../src/lib/settings";
import { db } from "../../src/lib/db";
import { POST as postBatches } from "../../src/app/api/batches/route";
import { POST as postEvents } from "../../src/app/api/events/route";
import { POST as postCustomerFinance } from "../../src/app/api/customer-finance/route";
import { POST as postCustomerOrders } from "../../src/app/api/customer-orders/route";
import { POST as postLogin } from "../../src/app/api/auth/login/route";
import { POST as postChangePassword } from "../../src/app/api/auth/change-password/route";
import { PATCH as patchHistory } from "../../src/app/api/history/route";
import { PUT as putCollaborations } from "../../src/app/api/lead/collaborations/route";
import { POST as postNotifications } from "../../src/app/api/notifications/route";
import { POST as postLeads } from "../../src/app/api/leads/route";
import { POST as postLeadMember } from "../../src/app/api/lead/members/route";
import * as leadMembers from "../../src/lib/lead-members";
import { parseEmploymentUpdate } from "../../src/app/api/admin/users/validation";
import { POST as postCompanyLead } from "../../src/app/api/company/leads/route";
import { POST as postCompanyGroup } from "../../src/app/api/company/groups/route";
import { POST as postRiskDecision } from "../../src/app/api/admin/risk-decisions/route";
import { POST as postHistoricalExpertCustomer } from "../../src/app/api/expert-customers/historical/route";
import * as companyOrganization from "../../src/lib/company-organization";
import * as adminAuth from "../../src/app/api/admin/_auth";
import { resetLoginThrottleForTests } from "../../src/lib/login-throttle";
import {
  API_LIMITS,
  RequestBodyTooLargeError,
  hasOversizedQueryValue,
  readLimitedJson,
  rowsLimitError,
} from "../../src/lib/request-limits";

// Prisma 客户端的方法由 Proxy 提供。Vitest 恢复 spy 时会把 `$transaction`
// 留成 undefined，因此每条用例后显式放回原方法，避免后续登录限流测试误报。
const originalDbTransaction = db.$transaction.bind(db);

const actor = {
  id: "limit-test-user",
  username: "limit-test-user",
  name: "Limit Test",
  role: "RECEPTION",
  groupId: "group-a",
  departmentId: null,
  active: true,
  roleAssignments: [],
} as const;

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": "203.0.113.120" },
    body: JSON.stringify(body),
  });
}

describe("API request limits", () => {
  beforeEach(async () => resetLoginThrottleForTests());
  afterEach(async () => {
    vi.restoreAllMocks();
    Object.defineProperty(db, "$transaction", {
      configurable: true,
      value: originalDbTransaction,
      writable: true,
    });
    await resetLoginThrottleForTests();
  });

  it("accepts the row-count boundary and rejects boundary plus one", () => {
    expect(rowsLimitError(100, 100, "记录")).toBeUndefined();
    expect(rowsLimitError(101, 100, "记录")).toBe("记录一次最多提交 100 条");
  });

  it("allows batches at the boundary to reach ordinary field validation", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor as never);
    const response = await postBatches(jsonRequest("/api/batches", {
      batches: Array.from({ length: API_LIMITS.batchRows }, () => ({})),
    }));
    const body = await response.json();
    expect(response.status).toBe(400);
    expect(body.error).toBe("请检查填写内容");
    expect(body.fields["batches.99.sourceDate"]).toBeTruthy();
  });

  it.each([
    ["batches", postBatches, "/api/batches", "RECEPTION", { batches: Array.from({ length: API_LIMITS.batchRows + 1 }, () => ({})) }],
    ["events", postEvents, "/api/events", "RECEPTION", Array.from({ length: API_LIMITS.eventRows + 1 }, () => ({}))],
    ["customer finance", postCustomerFinance, "/api/customer-finance", "LEAD", { rows: Array.from({ length: API_LIMITS.customerFinanceRows + 1 }, () => ({})) }],
    ["customer orders", postCustomerOrders, "/api/customer-orders", "LEAD", { rows: Array.from({ length: API_LIMITS.customerOrderRows + 1 }, () => ({})) }],
  ])("rejects oversized %s arrays before database work", async (_label, handler, path, role, body) => {
    vi.spyOn(auth, "requireUser").mockResolvedValue({ ...actor, role } as never);
    const settingsSpy = vi.spyOn(settings, "getSystemSettings");
    const transactionSpy = vi.spyOn(db, "$transaction");

    const response = await handler(jsonRequest(path, body));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("一次最多提交");
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("counts UTF-8 bytes and stops reading an oversized body", async () => {
    const request = new Request("http://localhost/api/test", { method: "POST", body: JSON.stringify({ note: "中".repeat(20) }) });
    await expect(readLimitedJson(request, 32)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("accepts the exact byte boundary and rejects boundary plus one", async () => {
    const atLimit = JSON.stringify({ x: "a".repeat(24) });
    expect(new TextEncoder().encode(atLimit)).toHaveLength(32);
    await expect(readLimitedJson(new Request("http://localhost", { method: "POST", body: atLimit }), 32))
      .resolves.toEqual({ x: "a".repeat(24) });
    await expect(readLimitedJson(new Request("http://localhost", { method: "POST", body: `${atLimit} ` }), 32))
      .rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("accepts the search boundary and rejects boundary plus one", () => {
    expect(hasOversizedQueryValue(new URLSearchParams({ q: "a".repeat(API_LIMITS.searchCharacters) }))).toBe(false);
    expect(hasOversizedQueryValue(new URLSearchParams({ q: "a".repeat(API_LIMITS.searchCharacters + 1) }))).toBe(true);
  });

  it("rejects every secondary bulk array before settings or a write transaction", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor as never);
    const settingsSpy = vi.spyOn(settings, "getSystemSettings");
    const transactionSpy = vi.spyOn(db, "$transaction");

    const historyResponse = await patchHistory(jsonRequest("/api/history", {
      eventIds: Array.from({ length: API_LIMITS.historyEventIds + 1 }, (_, index) => `event-${index}`),
    }));
    expect(historyResponse.status).toBe(400);
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();

    vi.spyOn(leadMembers, "requireLeadRequest").mockResolvedValue({ actor, group: { id: "group-a" } } as never);
    const collaborationResponse = await putCollaborations(jsonRequest("/api/lead/collaborations", {
      groupOperatorId: "operator-a",
      receptionistIds: Array.from({ length: API_LIMITS.collaborationRecipients + 1 }, (_, index) => `user-${index}`),
    }));
    expect(collaborationResponse.status).toBe(400);
    expect(transactionSpy).not.toHaveBeenCalled();

    vi.spyOn(auth, "requireUser").mockResolvedValue({ ...actor, role: "ADMIN" } as never);
    const notificationResponse = await postNotifications(jsonRequest("/api/notifications", {
      title: "Boundary test",
      content: "Boundary test content",
      targetType: "USERS",
      userIds: Array.from({ length: API_LIMITS.notificationRecipients + 1 }, (_, index) => `user-${index}`),
    }));
    expect(notificationResponse.status).toBe(400);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("does not let the legacy pasted-customer input bypass the 2,000-row limit", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor as never);
    const settingsSpy = vi.spyOn(settings, "getSystemSettings");
    const transactionSpy = vi.spyOn(db, "$transaction");
    const response = await postLeads(jsonRequest("/api/leads", {
      sourceDate: "2026-08-25",
      channelId: "channel-a",
      phones: Array.from({ length: API_LIMITS.customerImportRows + 1 }, (_, index) => String(index).padStart(6, "0")).join("\n"),
    }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("一次最多提交");
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("returns 413 for an oversized secondary bulk body before database work", async () => {
    vi.spyOn(leadMembers, "requireLeadRequest").mockResolvedValue({ actor, group: { id: "group-a" } } as never);
    const transactionSpy = vi.spyOn(db, "$transaction");
    const response = await putCollaborations(jsonRequest("/api/lead/collaborations", {
      groupOperatorId: "operator-a",
      receptionistIds: [],
      padding: "x".repeat(API_LIMITS.collaborationBodyBytes),
    }));
    expect(response.status).toBe(413);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("returns 413 for a login body above its route ceiling", async () => {
    const response = await postLogin(jsonRequest("/api/auth/login", {
      username: "u",
      password: "x".repeat(API_LIMITS.loginBodyBytes),
    }));
    expect(response.status).toBe(413);
  });

  it("rejects login field length plus one while allowing the exact username boundary", async () => {
    const authenticateSpy = vi.spyOn(auth, "authenticateUserWithIdentity").mockResolvedValue({ user: null, auditIdentity: null });
    const atLimit = await postLogin(jsonRequest("/api/auth/login", {
      username: "u".repeat(API_LIMITS.loginUsernameCharacters),
      password: "wrong-password",
    }));
    expect(atLimit.status).toBe(401);

    const overLimit = await postLogin(jsonRequest("/api/auth/login", {
      username: "u".repeat(API_LIMITS.loginUsernameCharacters + 1),
      password: "wrong-password",
    }));
    expect(overLimit.status).toBe(400);
    expect(authenticateSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects password length plus one while allowing the exact password boundary", async () => {
    const authenticateSpy = vi.spyOn(auth, "authenticateUserWithIdentity").mockResolvedValue({ user: null, auditIdentity: null });
    const atLimit = await postLogin(jsonRequest("/api/auth/login", {
      username: "limit-password-user",
      password: "p".repeat(API_LIMITS.loginPasswordCharacters),
    }));
    expect(atLimit.status).toBe(401);

    const overLimit = await postLogin(jsonRequest("/api/auth/login", {
      username: "limit-password-user",
      password: "p".repeat(API_LIMITS.loginPasswordCharacters + 1),
    }));
    expect(overLimit.status).toBe(400);
    expect(authenticateSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized password-management inputs before hashing or database work", async () => {
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor as never);
    const transactionSpy = vi.spyOn(db, "$transaction");
    const changeResponse = await postChangePassword(jsonRequest("/api/auth/change-password", {
      currentPassword: "p".repeat(API_LIMITS.loginPasswordCharacters + 1),
      newPassword: "new-password",
    }));
    expect(changeResponse.status).toBe(400);
    expect(transactionSpy).not.toHaveBeenCalled();

    vi.spyOn(leadMembers, "requireLeadRequest").mockResolvedValue({ actor, group: { id: "group-a" } } as never);
    const memberResponse = await postLeadMember(jsonRequest("/api/lead/members", {
      username: "new-user",
      name: "New User",
      password: "p".repeat(API_LIMITS.loginPasswordCharacters + 1),
      role: "RECEPTION",
    }));
    expect(memberResponse.status).toBe(400);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("accepts the note boundary and rejects boundary plus one", () => {
    expect(parseEmploymentUpdate({ stageOverride: "FORMAL", stageOverrideReason: "a".repeat(API_LIMITS.accountReasonCharacters) }).success).toBe(true);
    expect(parseEmploymentUpdate({ stageOverride: "FORMAL", stageOverrideReason: "a".repeat(API_LIMITS.accountReasonCharacters + 1) }).success).toBe(false);
  });

  it("rejects company account, group, risk and historical string limits before business transactions", async () => {
    const transactionSpy = vi.spyOn(db, "$transaction");
    vi.spyOn(companyOrganization, "requireCompanyManagerRequest").mockResolvedValue({
      actor: { ...actor, role: "COMPANY_MANAGER", departmentId: "company-a" },
      company: { id: "company-a" },
    } as never);

    const leadResponse = await postCompanyLead(jsonRequest("/api/company/leads", {
      username: "lead-a",
      name: "Lead A",
      password: "p".repeat(API_LIMITS.loginPasswordCharacters + 1),
      groupId: "group-a",
    }));
    expect(leadResponse.status).toBe(400);
    expect(transactionSpy).not.toHaveBeenCalled();

    const groupResponse = await postCompanyGroup(jsonRequest("/api/company/groups", {
      name: "g".repeat(API_LIMITS.accountDisplayNameCharacters + 1),
    }));
    expect(groupResponse.status).toBe(400);
    expect(transactionSpy).not.toHaveBeenCalled();

    vi.spyOn(adminAuth, "requireAdminRequest").mockResolvedValue({ actor: { ...actor, role: "ADMIN" } } as never);
    const riskResponse = await postRiskDecision(jsonRequest("/api/admin/risk-decisions", {
      memberId: "member-a",
      level: "LIMIT_WATCH",
      evidenceThrough: "2026-08-25",
      reason: "r".repeat(API_LIMITS.accountReasonCharacters + 1),
    }));
    expect(riskResponse.status).toBe(400);
    expect(transactionSpy).not.toHaveBeenCalled();

    vi.spyOn(auth, "requireUser").mockResolvedValue({ ...actor, role: "EXPERT" } as never);
    const historicalResponse = await postHistoricalExpertCustomer(jsonRequest("/api/expert-customers/historical", {
      phone: "1".repeat(81),
      receptionOwnerId: "reception-a",
      groupOperatorOwnerId: "operator-a",
      contactedOn: "2026-08-20",
      joinedOn: "2026-08-20",
      expertIntroducedOn: "2026-08-20",
      expertStage: "QUEUED",
      stageChangedOn: "2026-08-20",
    }));
    expect(historicalResponse.status).toBe(410);
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  it("keeps the nginx example embedded so it cannot replace proxy headers", () => {
    const example = readFileSync(new URL("../../ops/api-request-limits/nginx-location-limits.conf.example", import.meta.url), "utf8");
    const runbook = readFileSync(new URL("../../ops/api-request-limits/README.md", import.meta.url), "utf8");
    expect(example).not.toMatch(/^\s*location\b/m);
    expect(example).not.toContain("proxy_pass");
    expect(example).toContain("X-Real-IP");
    expect(runbook).toContain("nginx -T");
    expect(runbook).toContain("X-Forwarded-For");
    expect(runbook).toContain("winning location");
  });
});
