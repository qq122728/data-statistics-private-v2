import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const unified = readFileSync(new URL("../components/UnifiedNotificationCenter.tsx", import.meta.url), "utf8");
const workspaces = ["CompanyWorkspace.tsx", "HeadquartersWorkspace.tsx", "DepartmentWorkspace.tsx", "FreshWorkspace.tsx", "ResourceWorkspace.tsx", "SupportNotificationWorkspace.tsx"].map((name) => readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8"));

test("统一通知中心使用真实读取、发布、已读和确认接口", () => {
  assert.ok(unified.includes('requestJson<Payload>("/api/notifications")'));
  assert.ok(unified.includes('requestJson<{ recipientCount: number }>("/api/notifications"'));
  assert.ok(unified.includes('action: "READ" | "ACKNOWLEDGE"'));
  assert.ok(unified.includes("payload?.canSend && payload.sendScope"));
});

test("各新版工作区接入统一通知和未读提示", () => {
  for (const source of workspaces) assert.ok(source.includes("UnifiedNotificationCenter"));
  for (const source of workspaces.slice(0, 4)) assert.ok(source.includes("NotificationBadge"));
});

test("财务和人事使用新版只读通知工作台", () => {
  const support = workspaces.at(-1);
  assert.ok(support.includes("只读通知权限"));
  assert.ok(support.includes("不能向其他人发布通知"));
  assert.ok(!support.includes("/api/notifications\", { method: \"POST\""));
});
