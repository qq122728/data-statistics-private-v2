import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";

async function loginAs(page: Page, username: string, password: string) {
  const response = await page.request.post("/api/auth/login", {
    data: { username, password },
  });
  expect(response.status()).toBe(200);
}

async function getAfterTransientReset(page: Page, url: string) {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.request.get(url);
    } catch (error) {
      failure = error;
      await page.waitForTimeout(250);
    }
  }
  throw failure;
}

async function expectSuccessfulPatch(page: Page, url: string, data: unknown) {
  let status = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await page.request.patch(url, { data });
      status = response.status();
      if (status === 200) return;
    } catch {
      // The dev server can briefly reset a request while another route compiles.
    }
    await page.waitForTimeout(250);
  }
  expect(status).toBe(200);
}

const metricValues = {
  newFans: 100,
  effectiveFans: 80,
  noNumber: 10,
  duplicateFans: 5,
  replies: 5,
  groupJoin: 2,
  groupLeave: 1,
  expertIntro: 2,
  registration: 1,
  order: 1,
  rechargeCents: 1234,
  withdrawalCents: 200,
  channelPerformanceCents: 5000,
};

const fanBreakdown = (quantity: number, effectiveFans = quantity, noNumber = 0, duplicateFans = 0) => ({
  quantity,
  effectiveFans,
  noNumber,
  duplicateFans,
});

type HistoryFixture = Awaited<ReturnType<typeof createHistoryFixture>>;

async function createHistoryFixture(browser: Browser, label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channelName = `${label} ${suffix}`;
  const username = `history-edit-${suffix}`;
  const memberName = `${label}成员 ${suffix}`;
  const sourceDate = "2026-08-10";
  const occurredOn = "2026-08-10";
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin", "demo-password");

  const channelResponse = await adminPage.request.post("/api/admin/channels", {
    data: { name: channelName, groupId: "group-a" },
  });
  expect(channelResponse.status()).toBe(201);
  const channel = await channelResponse.json();
  const userResponse = await adminPage.request.post("/api/admin/users", {
    data: { username, name: memberName, password: "demo-password", role: "RECEPTION", groupId: "group-a" },
  });
  expect(userResponse.status()).toBe(201);
  const member = await userResponse.json();

  const memberContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const memberPage = await memberContext.newPage();
  await loginAs(memberPage, username, "demo-password");
  const fansResponse = await memberPage.request.post("/api/batches", {
    data: {
      channelId: channel.id,
      sourceDate,
      ...fanBreakdown(metricValues.newFans, metricValues.effectiveFans, metricValues.noNumber, metricValues.duplicateFans),
    },
  });
  expect(fansResponse.status()).toBe(201);
  const batch = (await fansResponse.json()).batches[0];
  const eventsResponse = await memberPage.request.post("/api/events", {
    data: { events: [
      { batchId: batch.id, occurredOn, kind: "REPLIES", quantity: metricValues.replies },
      { batchId: batch.id, occurredOn, kind: "GROUP_JOIN", quantity: metricValues.groupJoin },
      { batchId: batch.id, occurredOn, kind: "GROUP_LEAVE", quantity: metricValues.groupLeave },
      { batchId: batch.id, occurredOn, kind: "EXPERT_INTRO", quantity: metricValues.expertIntro },
      { batchId: batch.id, occurredOn, kind: "REGISTRATION", quantity: metricValues.registration },
      { batchId: batch.id, occurredOn, kind: "ORDER", quantity: metricValues.order },
      { batchId: batch.id, occurredOn, kind: "RECHARGE", amountCents: metricValues.rechargeCents },
      { batchId: batch.id, occurredOn, kind: "WITHDRAWAL", amountCents: metricValues.withdrawalCents },
      { batchId: batch.id, occurredOn, kind: "CHANNEL_PERFORMANCE", amountCents: metricValues.channelPerformanceCents },
    ] },
  });
  expect(eventsResponse.status()).toBe(201);
  const events = (await eventsResponse.json()).events as { id: string }[];

  return {
    adminContext,
    adminPage,
    memberContext,
    memberPage,
    member,
    username,
    memberName,
    channel,
    channelName,
    sourceDate,
    occurredOn,
    batch,
    events,
  };
}

async function closeHistoryFixture(fixture: HistoryFixture) {
  await fixture.memberContext.close();
  await fixture.adminContext.close();
}

function historyUpdatePayload(fixture: HistoryFixture) {
  return {
    eventIds: fixture.events.map((event) => event.id),
    fingerprint: "0".repeat(64),
    occurredOn: fixture.occurredOn,
    batchId: fixture.batch.id,
    metrics: metricValues,
  };
}

test("member edits one grouped history record and downstream views update without a history navigation", async ({ browser }) => {
  test.setTimeout(120_000);
  const fixture = await createHistoryFixture(browser, "本人编辑渠道");
  const page = fixture.memberPage;
  const movedOccurredOn = "2026-08-12";
  const siblingOccurredOn = "2026-08-11";
  const siblingResponse = await page.request.post("/api/events", {
    data: { batchId: fixture.batch.id, occurredOn: siblingOccurredOn, kind: "ORDER", quantity: 0 },
  });
  expect(siblingResponse.status()).toBe(201);
  let historyDocuments = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document" && new URL(request.url()).pathname === "/history") historyDocuments += 1;
  });

  await page.goto("/history");
  const channelFilterValue = `${encodeURIComponent("group-a")}:${encodeURIComponent(fixture.channel.id)}`;
  const sourceDateFilter = page.getByLabel("来源日期");
  const channelFilter = page.getByLabel("渠道 · 小组");
  await sourceDateFilter.fill(fixture.sourceDate);
  await expect(sourceDateFilter).toHaveValue(fixture.sourceDate);
  await channelFilter.selectOption(channelFilterValue);
  await expect(channelFilter).toHaveValue(channelFilterValue);
  const originalKey = `${fixture.member.id}::${fixture.occurredOn}::${fixture.batch.id}`;
  const movedKey = `${fixture.member.id}::${movedOccurredOn}::${fixture.batch.id}`;
  const row = page.locator(`[data-history-group-key="${originalKey}"]`);
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "展开详情" }).click();
  for (const label of ["提交号码", "有效粉", "无号码", "撞粉", "回复", "入群", "退群", "推专家", "注册", "开单", "入金", "出金", "通道业绩"]) {
    await expect(row.locator(`[data-metric-label="${label}"]`)).toBeVisible();
  }
  await expect(row.locator('[data-metric-label="入金"]')).toContainText("$12.34");

  const editButton = row.getByRole("button", { name: "编辑", exact: true });
  await editButton.click();
  let drawer = page.getByRole("dialog", { name: "编辑历史数据" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "关闭编辑" })).toBeFocused();
  await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByLabel("通道业绩（美元）")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(drawer.getByRole("button", { name: "关闭编辑" })).toBeFocused();
  await expect(drawer.getByLabel("录入人")).toHaveValue(fixture.memberName);
  await expect(drawer.getByLabel("发生日期")).toHaveValue(fixture.occurredOn);
  await expect(drawer.getByRole("combobox", { name: "来源批次", exact: true })).toHaveValue(fixture.batch.id);
  await expect(drawer.getByRole("heading", { name: "提交号码与回复" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "拉群与退群" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "转化与入金" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "检查修改" })).toBeDisabled();

  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(editButton).toBeFocused();
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "");
  await editButton.click();
  drawer = page.getByRole("dialog", { name: "编辑历史数据" });
  await page.getByTestId("history-edit-backdrop").click({ position: { x: 6, y: 6 } });
  await expect(drawer).toHaveCount(0);
  await editButton.click();
  drawer = page.getByRole("dialog", { name: "编辑历史数据" });

  await drawer.getByLabel("搜索来源批次").fill(fixture.channelName);
  await expect(drawer.getByRole("combobox", { name: "来源批次", exact: true }).getByRole("option", { name: new RegExp(fixture.channelName) })).toHaveCount(1);
  await drawer.getByLabel("回复数量").fill("");
  await drawer.getByLabel("总入金（美元）").fill("");
  await drawer.getByRole("button", { name: "检查修改" }).click();
  const zeroChangeList = drawer.getByRole("list", { name: "变更内容" });
  await expect(zeroChangeList).toContainText("回复：5 → 0");
  await expect(zeroChangeList).toContainText("入金：$12.34 → $0.00");
  await expect(drawer.getByRole("alert")).toHaveCount(0);
  await drawer.getByRole("button", { name: "返回修改" }).click();
  await drawer.getByLabel("有效粉数量").fill("79");
  await drawer.getByLabel("回复数量").fill("4");
  await drawer.getByLabel("入群数量").fill("3");
  await drawer.getByLabel("总入金（美元）").fill("12.35");
  await drawer.getByLabel("出金金额（美元）").fill("2.01");
  await drawer.getByLabel("通道业绩（美元）").fill("50.01");
  await drawer.getByLabel("发生日期").fill(movedOccurredOn);
  await drawer.getByRole("button", { name: "检查修改" }).click();

  const changeList = drawer.getByRole("list", { name: "变更内容" });
  await expect(changeList.getByRole("listitem")).toHaveCount(7);
  await expect(changeList).toContainText(`发生日期：${fixture.occurredOn} → ${movedOccurredOn}`);
  await expect(changeList).toContainText("有效粉：80 → 79");
  await expect(changeList).toContainText("回复：5 → 4");
  await expect(changeList).toContainText("入群：2 → 3");
  await expect(changeList).toContainText("入金：$12.34 → $12.35");
  await expect(changeList).toContainText("出金：$2.00 → $2.01");
  await expect(changeList).toContainText("通道业绩：$50.00 → $50.01");
  await expect(changeList).not.toContainText("提交号码：");

  let releaseRequest!: () => void;
  const allowRequest = new Promise<void>((resolve) => { releaseRequest = resolve; });
  let observedPayload: ReturnType<typeof historyUpdatePayload> | undefined;
  let requestObserved!: () => void;
  const requestStarted = new Promise<void>((resolve) => { requestObserved = resolve; });
  await page.route("**/api/history", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    observedPayload = route.request().postDataJSON();
    requestObserved();
    await allowRequest;
    await route.continue();
  });
  const updateResponse = page.waitForResponse((response) => response.url().endsWith("/api/history") && response.request().method() === "PATCH");
  await drawer.getByRole("button", { name: "确认保存" }).click();
  await requestStarted;
  await expect(drawer.getByRole("button", { name: "保存中…" })).toBeDisabled();
  await expect(drawer.getByRole("button", { name: "关闭编辑" })).toBeDisabled();
  await expect(page.locator(".app-shell")).toHaveAttribute("inert", "");
  await page.locator('a[href="/dashboard"]').click({ force: true });
  await expect(page).toHaveURL(/\/history$/);
  await page.getByTestId("history-edit-backdrop").click({ position: { x: 6, y: 6 } });
  await expect(drawer).toBeVisible();
  releaseRequest();
  const response = await updateResponse;
  expect(response.status()).toBe(200);
  expect(observedPayload?.metrics.rechargeCents).toBe(1235);
  expect(observedPayload?.metrics.withdrawalCents).toBe(201);
  expect(observedPayload?.metrics.channelPerformanceCents).toBe(5001);
  expect((await response.json()).group.metrics).toMatchObject({
    effectiveFans: 79,
    replies: 4,
    groupJoin: 3,
    rechargeCents: 1235,
    withdrawalCents: 201,
    channelPerformanceCents: 5001,
  });

  await expect(page.getByRole("status")).toHaveText("历史数据已更新");
  await expect(drawer).toHaveCount(0);
  await expect(row).toHaveCount(0);
  const movedRow = page.locator(`[data-history-group-key="${movedKey}"]`);
  await expect(movedRow).toContainText("回复4");
  await expect(movedRow).toContainText("入群3");
  await expect(movedRow).toContainText("$12.35");
  await expect(movedRow).toContainText("有效粉79");
  await expect(movedRow).toContainText("出金$2.01");
  await expect(movedRow).toContainText("通道业绩$50.01");
  await expect(page.locator('section[aria-labelledby^="history-date-"] > h2')).toHaveText([
    `${movedOccurredOn} · 1 组`,
    `${siblingOccurredOn} · 1 组`,
  ]);
  await expect(sourceDateFilter).toHaveValue(fixture.sourceDate);
  await expect(channelFilter).toHaveValue(channelFilterValue);
  expect(historyDocuments).toBe(1);

  const historyResponse = await page.request.get(`/api/history?occurredOn=${movedOccurredOn}&sourceDate=${fixture.sourceDate}`);
  expect(historyResponse.status()).toBe(200);
  const historyEvents = (await historyResponse.json()).events as { kind: string; quantity: number | null; amountCents: number | null }[];
  const total = (kind: string) => historyEvents.filter((event) => event.kind === kind).reduce((sum, event) => sum + (event.quantity ?? 0), 0);
  expect(total("REPLIES")).toBe(4);
  expect(total("GROUP_JOIN")).toBe(3);
  expect(historyEvents.filter((event) => event.kind === "RECHARGE").reduce((sum, event) => sum + (event.amountCents ?? 0), 0)).toBe(1235);
  expect(historyEvents.filter((event) => event.kind === "WITHDRAWAL").reduce((sum, event) => sum + (event.amountCents ?? 0), 0)).toBe(201);
  expect(historyEvents.filter((event) => event.kind === "CHANNEL_PERFORMANCE").reduce((sum, event) => sum + (event.amountCents ?? 0), 0)).toBe(5001);

  const filters = `sourceDateFrom=${fixture.sourceDate}&sourceDateTo=${fixture.sourceDate}&normalizedName=${encodeURIComponent(fixture.channelName)}`;
  await page.goto(`/reports?${filters}`);
  await expect(page.getByRole("region", { name: "关键指标" }).locator("article").filter({ hasText: "回复" })).toContainText("4");
  await expect(page.getByRole("region", { name: "关键指标" }).locator("article").filter({ hasText: "入群" }).first()).toContainText("3");
  await page.goto(`/dashboard?${filters}`);
  await expect(page.getByRole("region", { name: "关键指标" }).locator("article").filter({ hasText: "回复" })).toContainText("4");
  await expect(page.getByRole("region", { name: "关键指标" }).locator("article").filter({ hasText: "入群" }).first()).toContainText("3");

  const auditResponse = await getAfterTransientReset(fixture.adminPage, `/api/admin/audit-logs?action=HISTORY_GROUP_UPDATED&actorId=${fixture.member.id}`);
  expect(auditResponse.status()).toBe(200);
  expect(await auditResponse.json()).toEqual(expect.arrayContaining([
    expect.objectContaining({ actorId: fixture.member.id, action: "HISTORY_GROUP_UPDATED", entityType: "HistoryGroup" }),
  ]));

  await closeHistoryFixture(fixture);
});

test("lead and administrator can inspect another member's group but cannot edit it through UI or PATCH", async ({ browser }) => {
  const fixture = await createHistoryFixture(browser, "越权渠道");
  const leadContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const leadPage = await leadContext.newPage();
  await loginAs(leadPage, "lead", "demo-password");
  await leadPage.goto("/history");
  const leadRow = leadPage.getByTestId("history-group-row").filter({ hasText: fixture.channelName }).filter({ hasText: fixture.memberName });
  await expect(leadRow.getByRole("button", { name: "查看详情" })).toBeVisible();
  await expect(leadRow.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  const leadPatch = await leadPage.request.patch("/api/history", { data: historyUpdatePayload(fixture) });
  expect(leadPatch.status()).toBe(403);
  expect(await leadPatch.json()).toEqual({ error: "无权修改该记录" });

  await fixture.adminPage.goto("/history");
  const adminRow = fixture.adminPage.getByTestId("history-group-row").filter({ hasText: fixture.channelName }).filter({ hasText: fixture.memberName });
  await expect(adminRow.getByRole("button", { name: "查看详情" })).toBeVisible();
  await expect(adminRow.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  const adminPatch = await fixture.adminPage.request.patch("/api/history", { data: historyUpdatePayload(fixture) });
  expect(adminPatch.status()).toBe(403);
  expect(await adminPatch.json()).toEqual({ error: "无权修改该记录" });

  await leadContext.close();
  await closeHistoryFixture(fixture);
});

test("a stale history drawer keeps edited values after field and conflict errors", async ({ browser }) => {
  test.setTimeout(90_000);
  const fixture = await createHistoryFixture(browser, "过期页面渠道");
  const staleContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const stalePage = await staleContext.newPage();
  await loginAs(stalePage, fixture.username, "demo-password");
  await Promise.all([fixture.memberPage.goto("/history"), stalePage.goto("/history")]);

  const firstRow = fixture.memberPage.getByTestId("history-group-row").filter({ hasText: fixture.channelName });
  const staleRow = stalePage.getByTestId("history-group-row").filter({ hasText: fixture.channelName });
  await firstRow.getByRole("button", { name: "编辑", exact: true }).click();
  await staleRow.getByRole("button", { name: "编辑", exact: true }).click();
  const firstDrawer = fixture.memberPage.getByRole("dialog", { name: "编辑历史数据" });
  let staleDrawer = stalePage.getByRole("dialog", { name: "编辑历史数据" });

  await firstDrawer.getByLabel("回复数量").fill("4");
  await firstDrawer.getByRole("button", { name: "检查修改" }).click();
  await firstDrawer.getByRole("button", { name: "确认保存" }).click();
  await expect(fixture.memberPage.getByRole("status")).toHaveText("历史数据已更新");

  await staleDrawer.getByLabel("回复数量").fill("2147483648");
  await staleDrawer.getByRole("button", { name: "检查修改" }).click();
  const invalidResponse = stalePage.waitForResponse((response) => response.url().endsWith("/api/history") && response.request().method() === "PATCH");
  await staleDrawer.getByRole("button", { name: "确认保存" }).click();
  expect((await invalidResponse).status()).toBe(400);
  staleDrawer = stalePage.getByRole("dialog", { name: "编辑历史数据" });
  const staleReplies = staleDrawer.getByLabel("回复数量");
  await expect(staleReplies).toHaveValue("2147483648");
  await expect(staleReplies).toHaveAttribute("aria-invalid", "true");

  await staleReplies.fill("3");
  await staleDrawer.getByRole("button", { name: "检查修改" }).click();
  const staleResponse = stalePage.waitForResponse((response) => response.url().endsWith("/api/history") && response.request().method() === "PATCH");
  await staleDrawer.getByRole("button", { name: "确认保存" }).click();
  expect((await staleResponse).status()).toBe(409);
  staleDrawer = stalePage.getByRole("dialog", { name: "编辑历史数据" });
  await expect(staleDrawer.getByRole("alert")).toContainText("这组数据已被更新，请刷新后再修改");
  await expect(staleDrawer.getByLabel("回复数量")).toHaveValue("3");

  await staleContext.close();
  await closeHistoryFixture(fixture);
});

test("member cannot see another member's event in history", async ({ page, browser }) => {
  const suffix = Date.now().toString();
  const otherUsername = `history-other-${suffix}`;
  const otherName = "另一成员的测试记录";
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin", "demo-password");

  const channelResponse = await adminPage.request.post("/api/admin/channels", {
    data: { name: `历史权限渠道 ${suffix}`, groupId: "group-a" },
  });
  expect(channelResponse.status()).toBe(201);
  const channel = await channelResponse.json();
  const userResponse = await adminPage.request.post("/api/admin/users", {
    data: { username: otherUsername, name: otherName, password: "demo-password", role: "RECEPTION", groupId: "group-a" },
  });
  expect(userResponse.status()).toBe(201);

  const otherContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const otherPage = await otherContext.newPage();
  await loginAs(otherPage, otherUsername, "demo-password");
  const batchResponse = await otherPage.request.post("/api/batches", {
    data: { channelId: channel.id, sourceDate: "2026-08-18", ...fanBreakdown(1) },
  });
  expect(batchResponse.status()).toBe(201);
  const batch = (await batchResponse.json()).batches[0];
  const eventResponse = await otherPage.request.post("/api/events", {
    data: { batchId: batch.id, occurredOn: "2026-08-19", kind: "REPLIES", quantity: 1 },
  });
  expect(eventResponse.status()).toBe(201);

  await loginAs(page, "member", "demo-password");
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "历史记录" })).toBeVisible();
  await expect(page.getByText(otherName)).toHaveCount(0);

  await otherContext.close();
  await adminContext.close();
});

test("history filters events and preserves inactive channel and member names", async ({ page, browser }) => {
  const suffix = Date.now().toString();
  const channelName = `历史停用渠道 ${suffix}`;
  const memberName = `已停用录入人 ${suffix}`;
  const username = `history-inactive-${suffix}`;
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin", "demo-password");

  const channelResponse = await adminPage.request.post("/api/admin/channels", {
    data: { name: channelName, groupId: "group-a" },
  });
  const channel = await channelResponse.json();
  const userResponse = await adminPage.request.post("/api/admin/users", {
    data: { username, name: memberName, password: "demo-password", role: "RECEPTION", groupId: "group-a" },
  });
  const member = await userResponse.json();

  const memberContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const memberPage = await memberContext.newPage();
  await loginAs(memberPage, username, "demo-password");
  const batchResponse = await memberPage.request.post("/api/batches", {
    data: { channelId: channel.id, sourceDate: "2026-08-02", ...fanBreakdown(1) },
  });
  const batch = (await batchResponse.json()).batches[0];
  const eventResponse = await memberPage.request.post("/api/events", {
    data: { batchId: batch.id, occurredOn: "2026-08-05", kind: "RECHARGE", amountCents: 1234 },
  });
  expect(eventResponse.status()).toBe(201);
  await expectSuccessfulPatch(adminPage, "/api/admin/channels", { id: channel.id, groupId: "group-a", active: false });
  await expectSuccessfulPatch(adminPage, "/api/admin/users", { id: member.id, active: false });

  const apiResponse = await adminPage.request.get(`/api/history?occurredOn=2026-08-05&sourceDate=2026-08-02&channelId=${channel.id}&enteredById=${member.id}`);
  expect(apiResponse.status()).toBe(200);
  const apiEvents = (await apiResponse.json()).events;
  expect(apiEvents).toHaveLength(1);
  expect(apiEvents[0].enteredBy).not.toHaveProperty("passwordHash");

  await page.context().addCookies((await adminContext.cookies()).filter((cookie) => cookie.name === "data-statistics-session"));
  await page.goto("/history");
  await expect(page.getByText("按发生日期和粉来源批次汇总；你可以编辑本人录入的数据。", { exact: true })).toBeVisible();
  await page.getByLabel("发生日期").fill("2026-08-05");
  await page.getByLabel("来源日期").fill("2026-08-02");
  await page.getByLabel("渠道 · 小组").selectOption(`${encodeURIComponent("group-a")}:${encodeURIComponent(channel.id)}`);
  await page.getByLabel("成员").selectOption(member.id);
  await expect(page.getByText("共 1 组", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "清除筛选" })).toBeVisible();
  const row = page.getByTestId("history-group-row").filter({ hasText: channelName });
  await expect(row).toContainText(memberName);
  await expect(row).toContainText("$12.34");
  await expect(row.getByText("渠道已停用", { exact: true })).toBeVisible();
  await expect(row.getByText("成员已停用", { exact: true })).toBeVisible();

  await memberContext.close();
  await adminContext.close();
});

test("history page does not serialize password hashes into the client payload", async ({ page }) => {
  const suffix = Date.now().toString();
  await loginAs(page, "admin", "demo-password");
  const channelResponse = await page.request.post("/api/admin/channels", {
    data: { name: `历史脱敏渠道 ${suffix}`, groupId: "group-a" },
  });
  const channel = await channelResponse.json();
  await loginAs(page, "member", "demo-password");
  const batchResponse = await page.request.post("/api/batches", {
    data: { channelId: channel.id, sourceDate: "2026-08-24", ...fanBreakdown(1) },
  });
  const batch = (await batchResponse.json()).batches[0];
  await page.request.post("/api/events", {
    data: { batchId: batch.id, occurredOn: "2026-08-24", kind: "REPLIES", quantity: 1 },
  });

  const historyDocument = await page.request.get("/history");

  expect(await historyDocument.text()).not.toContain("passwordHash");
});

test("history API scopes admin, lead, and member results before applying filters", async ({ browser }) => {
  const suffix = Date.now().toString();
  const occurredOn = "2026-08-21";
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin", "demo-password");
  const ownChannelResponse = await adminPage.request.post("/api/admin/channels", {
    data: { name: `历史范围一组 ${suffix}`, groupId: "group-a" },
  });
  const ownChannel = await ownChannelResponse.json();
  const otherChannelResponse = await adminPage.request.post("/api/admin/channels", {
    data: { name: `历史范围二组 ${suffix}`, groupId: "group-b" },
  });
  const otherChannel = await otherChannelResponse.json();
  const ownWriterResponse = await adminPage.request.post("/api/admin/users", {
    data: { username: `history-own-${suffix}`, name: `范围一组录入人 ${suffix}`, password: "demo-password", role: "RECEPTION", groupId: "group-a" },
  });
  const ownWriter = await ownWriterResponse.json();
  const otherWriterResponse = await adminPage.request.post("/api/admin/users", {
    data: { username: `history-other-${suffix}`, name: `范围二组录入人 ${suffix}`, password: "demo-password", role: "RECEPTION", groupId: "group-b" },
  });
  const otherWriter = await otherWriterResponse.json();

  const ownWriterContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const ownWriterPage = await ownWriterContext.newPage();
  await loginAs(ownWriterPage, ownWriter.username, "demo-password");
  const memberContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const memberPage = await memberContext.newPage();
  await loginAs(memberPage, "member", "demo-password");
  const otherWriterContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const otherWriterPage = await otherWriterContext.newPage();
  await loginAs(otherWriterPage, otherWriter.username, "demo-password");
  const [ownBatchResponse, otherBatchResponse] = await Promise.all([
    ownWriterPage.request.post("/api/batches", { data: { channelId: ownChannel.id, sourceDate: "2026-08-20", ...fanBreakdown(1) } }),
    otherWriterPage.request.post("/api/batches", { data: { channelId: otherChannel.id, sourceDate: "2026-08-20", ...fanBreakdown(1) } }),
  ]);
  const ownBatch = (await ownBatchResponse.json()).batches[0];
  const otherBatch = (await otherBatchResponse.json()).batches[0];
  for (const response of [
    await ownWriterPage.request.post("/api/events", { data: { batchId: ownBatch.id, occurredOn, kind: "REPLIES", quantity: 1 } }),
    await memberPage.request.post("/api/events", { data: { batchId: ownBatch.id, occurredOn, kind: "REPLIES", quantity: 2 } }),
    await otherWriterPage.request.post("/api/events", { data: { batchId: otherBatch.id, occurredOn, kind: "REPLIES", quantity: 3 } }),
  ]) {
    expect(response.status()).toBe(201);
  }

  const leadContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const leadPage = await leadContext.newPage();
  await loginAs(leadPage, "lead", "demo-password");
  const [adminResponse, leadResponse, memberResponse, memberCrossUserResponse] = await Promise.all([
    adminPage.request.get(`/api/history?occurredOn=${occurredOn}`),
    leadPage.request.get(`/api/history?occurredOn=${occurredOn}`),
    memberPage.request.get(`/api/history?occurredOn=${occurredOn}`),
    memberPage.request.get(`/api/history?occurredOn=${occurredOn}&enteredById=${ownWriter.id}`),
  ]);
  const [adminEvents, leadEvents, memberEvents, memberCrossUserEvents] = await Promise.all([
    adminResponse.json().then((body) => body.events),
    leadResponse.json().then((body) => body.events),
    memberResponse.json().then((body) => body.events),
    memberCrossUserResponse.json().then((body) => body.events),
  ]);
  expect(adminEvents.map((event: { enteredBy: { id: string } }) => event.enteredBy.id)).toEqual(expect.arrayContaining([ownWriter.id, "member-1", otherWriter.id]));
  expect(leadEvents.map((event: { enteredBy: { id: string } }) => event.enteredBy.id)).toEqual(expect.arrayContaining([ownWriter.id, "member-1"]));
  expect(leadEvents.map((event: { enteredBy: { id: string } }) => event.enteredBy.id)).not.toContain(otherWriter.id);
  expect(memberEvents.map((event: { enteredBy: { id: string } }) => event.enteredBy.id)).toEqual(expect.arrayContaining(["member-1"]));
  expect(memberEvents.map((event: { enteredBy: { id: string } }) => event.enteredBy.id)).not.toContain(ownWriter.id);
  expect(memberCrossUserEvents).toEqual([]);

  await ownWriterContext.close();
  await memberContext.close();
  await otherWriterContext.close();
  await leadContext.close();
  await adminContext.close();
});
