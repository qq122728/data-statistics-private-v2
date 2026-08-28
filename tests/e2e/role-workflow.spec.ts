import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";

const baseURL = E2E_BASE_URL;

async function loginAs(browser: Browser, username: string, password: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const seededUsername = username.replace("@example.com", "");
  const response = await page.request.post("/api/auth/login", {
    data: { username: seededUsername, password },
  });
  expect(response.status()).toBe(200);
  return { context, page };
}

function todayInAppTimezone() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function fanBreakdown(quantity: number, effectiveFans = quantity, noNumber = 0, duplicateFans = 0) {
  return { quantity, effectiveFans, noNumber, duplicateFans };
}

test("admin sees all data while a member sees only own data", async ({ browser }) => {
  const suffix = Date.now().toString();
  const sourceDate = todayInAppTimezone();
  const adminSession = await loginAs(browser, "admin@example.com", "demo-password");
  const admin = adminSession.page;

  const ownChannelResponse = await admin.request.post("/api/admin/channels", {
    data: { name: `角色流程一组 ${suffix}`, groupId: "group-a" },
  });
  const otherChannelResponse = await admin.request.post("/api/admin/channels", {
    data: { name: `角色流程二组 ${suffix}`, groupId: "group-b" },
  });
  expect(ownChannelResponse.status()).toBe(201);
  expect(otherChannelResponse.status()).toBe(201);
  const ownChannel = await ownChannelResponse.json();
  const otherChannel = await otherChannelResponse.json();
  const otherUsername = `role-flow-group-b-${suffix}`;
  const otherUserResponse = await admin.request.post("/api/admin/users", {
    data: { username: otherUsername, name: `二组业务员 ${suffix}`, password: "demo-password", role: "RECEPTION", groupId: "group-b" },
  });
  expect(otherUserResponse.status()).toBe(201);

  const memberSession = await loginAs(browser, "member@example.com", "demo-password");
  const member = memberSession.page;
  const otherMemberSession = await loginAs(browser, otherUsername, "demo-password");
  const ownBatchResponse = await member.request.post("/api/batches", {
    data: { channelId: ownChannel.id, groupId: "group-a", sourceDate, ...fanBreakdown(3) },
  });
  const otherBatchResponse = await otherMemberSession.page.request.post("/api/batches", {
    data: { channelId: otherChannel.id, groupId: "group-b", sourceDate, ...fanBreakdown(5) },
  });
  expect(ownBatchResponse.status()).toBe(201);
  expect(otherBatchResponse.status()).toBe(201);
  const ownBatch = (await ownBatchResponse.json()).batches[0];

  const ownEventResponse = await member.request.post("/api/events", {
    data: { batchId: ownBatch.id, occurredOn: sourceDate, kind: "REPLIES", quantity: 2 },
  });
  expect(ownEventResponse.status()).toBe(201);

  await admin.goto("/reports");
  await expect(admin).toHaveURL(/\/team-performance/);
  await expect(admin.getByRole("heading", { name: "团队表现" })).toBeVisible();
  await expect(admin.getByRole("link", { name: "二组", exact: true })).toBeVisible();

  await admin.goto(`/channel-analysis?sourceDateFrom=${sourceDate}&sourceDateTo=${sourceDate}`);
  const ownChannelRow = admin.getByRole("row").filter({ hasText: `角色流程一组 ${suffix}` });
  const otherChannelRow = admin.getByRole("row").filter({ hasText: `角色流程二组 ${suffix}` });
  await expect(ownChannelRow.getByRole("cell").nth(1)).toHaveText("3");
  await expect(otherChannelRow.getByRole("cell").nth(1)).toHaveText("5");

  await member.goto("/reports");
  await expect(member.getByText("二组")).toHaveCount(0);
  await expect(member.getByText(`${sourceDate} · 角色流程一组 ${suffix}`)).toBeVisible();
  await expect(member.getByText(`${sourceDate} · 角色流程二组 ${suffix}`)).toHaveCount(0);

  const sidebar = member.getByRole("navigation", { name: "应用导航" });
  const contextBar = member.getByRole("banner", { name: "当前登录信息" });
  await expect(sidebar).toBeVisible();
  await expect(contextBar).toBeVisible();
  expect(await sidebar.evaluate((element) => getComputedStyle(element.closest("aside")!).position)).toBe("fixed");
  expect(await contextBar.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);

  await memberSession.context.close();
  await otherMemberSession.context.close();
  await adminSession.context.close();
});

test("role matrix rejects administrator business entry and keeps lead writes owned by the lead", async ({ browser }) => {
  const suffix = Date.now().toString();
  const sourceDate = todayInAppTimezone();
  const adminSession = await loginAs(browser, "admin", "demo-password");
  const leadSession = await loginAs(browser, "lead", "demo-password");
  const memberSession = await loginAs(browser, "member", "demo-password");

  const adminBatchResponse = await adminSession.page.request.post("/api/batches", {
    data: {
      channelId: "channel-1",
      groupId: "group-a",
      sourceDate,
      ...fanBreakdown(10, 8, 1, 1),
    },
  });
  expect(adminBatchResponse.status()).toBe(403);
  await adminSession.page.goto("/entry");
  await expect(adminSession.page).toHaveURL(/\/dashboard/);
  await expect(adminSession.page.getByRole("navigation", { name: "应用导航" }).getByRole("link", { name: "数据录入" })).toHaveCount(0);

  const leadBatchResponse = await leadSession.page.request.post("/api/batches", {
    data: {
      channelName: `组长自建渠道 ${suffix}`,
      sourceDate,
      enteredById: "member-1",
      ...fanBreakdown(10, 8, 1, 1),
    },
  });
  expect(leadBatchResponse.status()).toBe(201);
  const leadBatch = (await leadBatchResponse.json()).batches[0];
  const leadEventResponse = await leadSession.page.request.post("/api/events", {
    data: {
      batchId: leadBatch.id,
      occurredOn: sourceDate,
      kind: "WITHDRAWAL",
      amountCents: 1_234,
      enteredById: "member-1",
    },
  });
  expect(leadEventResponse.status()).toBe(201);
  expect((await leadEventResponse.json()).events[0]).toMatchObject({
    enteredById: "lead-1",
    kind: "WITHDRAWAL",
    amountCents: 1_234,
  });

  const adminEventResponse = await adminSession.page.request.post("/api/events", {
    data: { batchId: leadBatch.id, occurredOn: sourceDate, kind: "CHANNEL_PERFORMANCE", amountCents: 5_000 },
  });
  expect(adminEventResponse.status()).toBe(403);

  expect((await memberSession.page.request.patch("/api/admin/channels", {
    data: { id: "channel-1", groupId: "group-a", name: "forged" },
  })).status()).toBe(403);
  expect((await memberSession.page.request.patch("/api/admin/users", {
    data: { id: "member-1", stageOverride: "FORMAL", stageOverrideReason: "成员越权调整阶段" },
  })).status()).toBe(403);
  expect((await memberSession.page.request.patch("/api/admin/risk-settings", {
    data: { trainingDays: 1 },
  })).status()).toBe(403);
  expect((await memberSession.page.request.post("/api/admin/risk-decisions", {
    data: { memberId: "member-1", level: "LIMIT_WATCH", evidenceThrough: sourceDate, reason: "成员越权人工确认" },
  })).status()).toBe(403);

  await memberSession.context.close();
  await leadSession.context.close();
  await adminSession.context.close();
});
