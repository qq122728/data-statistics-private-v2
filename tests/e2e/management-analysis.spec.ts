import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function appDate(days = 0) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + days));
  return date.toISOString().slice(0, 10);
}

const sourceDate = appDate(-7);
const rangeFrom = appDate(-40);
const rangeTo = appDate();
const peerUsername = "management-analysis-peer";
const riskTargetUsername = "management-analysis-risk-target";
const riskTargetName = "风险测试组员";
let riskTargetId = "";

function requestOf(client: Page | APIRequestContext): APIRequestContext {
  return "request" in client ? client.request : client;
}

async function loginAs(client: Page | APIRequestContext, username: string) {
  const response = await requestOf(client).post("/api/auth/login", { data: { username, password: "demo-password" } });
  expect(response.status()).toBe(200);
}

async function addMatureMemberData(client: Page | APIRequestContext, input: {
  username: string;
  channelId?: string;
  channelName?: string;
  newFans: number;
  effectiveFans: number;
  orders: number;
  rechargeCents?: number;
}) {
  await loginAs(client, input.username);
  const request = requestOf(client);
  const batchResponse = await request.post("/api/batches", {
    data: {
      ...(input.channelId ? { channelId: input.channelId } : { channelName: input.channelName }),
      sourceDate,
      quantity: input.newFans,
      effectiveFans: input.effectiveFans,
      noNumber: input.newFans - input.effectiveFans,
      duplicateFans: 0,
    },
  });
  expect(batchResponse.status()).toBe(201);
  const batch = (await batchResponse.json()).batches[0];
  const events = [
    { batchId: batch.id, occurredOn: appDate(), kind: "REPLIES", quantity: Math.min(input.newFans, input.effectiveFans) },
    { batchId: batch.id, occurredOn: appDate(), kind: "GROUP_JOIN", quantity: Math.min(input.newFans, input.effectiveFans) },
    { batchId: batch.id, occurredOn: appDate(), kind: "EXPERT_INTRO", quantity: Math.min(input.orders * 2, input.effectiveFans) },
    { batchId: batch.id, occurredOn: appDate(), kind: "REGISTRATION", quantity: Math.min(input.orders, input.effectiveFans) },
    { batchId: batch.id, occurredOn: appDate(), kind: "ORDER", quantity: input.orders },
    ...(input.rechargeCents ? [{ batchId: batch.id, occurredOn: appDate(), kind: "RECHARGE", amountCents: input.rechargeCents }] : []),
  ];
  const eventResponse = await request.post("/api/events", { data: { events } });
  expect(eventResponse.status()).toBe(201);
  const confirmation = await request.post("/api/daily-confirmations", { data: { businessDate: appDate() } });
  expect(confirmation.status()).toBe(200);
  return batch;
}

test.beforeAll(async ({ request }) => {
  await loginAs(request, "admin");
  const peerResponse = await request.post("/api/admin/users", {
    data: {
      username: peerUsername,
      name: "对照组员",
      password: "demo-password",
      role: "RECEPTION",
      groupId: "group-a",
      hireDate: appDate(-90),
    },
  });
  expect(peerResponse.status()).toBe(201);
  const riskTargetResponse = await request.post("/api/admin/users", {
    data: {
      username: riskTargetUsername,
      name: riskTargetName,
      password: "demo-password",
      role: "RECEPTION",
      groupId: "group-a",
      hireDate: appDate(-90),
    },
  });
  expect(riskTargetResponse.status()).toBe(201);
  riskTargetId = (await riskTargetResponse.json()).id;

  await addMatureMemberData(request, {
    username: "member",
    channelId: "channel-1",
    newFans: 120,
    effectiveFans: 100,
    orders: 1,
    rechargeCents: 20_000,
  });
  await addMatureMemberData(request, {
    username: peerUsername,
    channelId: "channel-1",
    newFans: 110,
    effectiveFans: 100,
    orders: 10,
    rechargeCents: 40_000,
  });
  await addMatureMemberData(request, {
    username: riskTargetUsername,
    channelId: "channel-1",
    newFans: 120,
    effectiveFans: 100,
    orders: 0,
    rechargeCents: 10_000,
  });
  await addMatureMemberData(request, {
    username: "lead",
    channelName: "待定价总览渠道",
    newFans: 20,
    effectiveFans: 20,
    orders: 1,
  });
});

test("lead stays inside its own group across every management entry", async ({ page }) => {
  await loginAs(page, "lead");
  for (const [path, heading] of [["/dashboard", "管理概览"], ["/team-performance", "团队表现"], ["/channel-analysis", "渠道分析"], ["/anomaly-ranking", "组员数据总览"], ["/batch-tracking", "批次追踪"]] as const) {
    await page.goto(`${path}?groupId=group-b&sourceDateFrom=${rangeFrom}&sourceDateTo=${rangeTo}`);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByLabel("小组")).toHaveCount(0);
    await expect(page.getByText("二组", { exact: true })).toHaveCount(0);
  }
  await page.goto("/anomaly-ranking?groupId=group-b&period=mature7");
  await expect(page.getByText("固定小组")).toBeVisible();
  await expect(page.getByText("一组", { exact: true })).toBeVisible();
});

test("members keep reports but cannot enter management analysis pages", async ({ page }) => {
  await loginAs(page, "member");
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "来源批次转化报表" })).toBeVisible();
  const sidebar = page.getByRole("navigation", { name: "应用导航" });
  await expect(sidebar.getByRole("link", { name: "组员数据总览" })).toHaveCount(0);
  for (const path of ["/team-performance", "/channel-analysis", "/anomaly-ranking", "/batch-tracking"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  }
});

test("admin switches all member-overview tabs and retains filters after refresh", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/anomaly-ranking?tab=overview&period=mature30&groupId=group-a");
  await expect(page.getByRole("heading", { name: "组员数据总览" })).toBeVisible();
  await expect(page.getByLabel("小组")).toHaveValue("group-a");
  await expect(page.getByRole("region", { name: "组员数据摘要" })).toBeVisible();
  await expect(page.getByRole("region", { name: "待管理员定价渠道" })).toContainText("待定价总览渠道");

  await page.getByLabel("统计周期").selectOption("mature7");
  await page.getByLabel("人员", { exact: true }).selectOption("member-1");
  await page.getByText("更多筛选", { exact: true }).click();
  await page.getByLabel("包含停用人员").check();
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page).toHaveURL(/period=mature7/);
  await expect(page).toHaveURL(/memberId=member-1/);
  await expect(page).toHaveURL(/includeInactive=1/);

  for (const [name, tab] of [["业绩排行", "performance"], ["转化排行", "conversion"], ["风险预警", "risk"], ["组员总览", "overview"]] as const) {
    await page.getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
    await expect(page).toHaveURL(/period=mature7/);
    await expect(page).toHaveURL(/memberId=member-1/);
    await expect(page).toHaveURL(/includeInactive=1/);
  }
  await page.reload();
  await expect(page.getByLabel("统计周期")).toHaveValue("mature7");
  await expect(page.getByLabel("人员", { exact: true })).toHaveValue("member-1");
  await expect(page.getByLabel("包含停用人员")).toBeChecked();
});

test("member detail drawer preserves focus behavior and active filters", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/anomaly-ranking?tab=overview&period=mature7&groupId=group-a");
  const trigger = page.getByRole("button", { name: "查看详情：组员" });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "组员·组员详情" });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "关闭" })).toBeFocused();
  await expect(drawer.getByText("财务计算过程")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/period=mature7/);
  await expect(page).toHaveURL(/groupId=group-a/);
});

test("member overview uses mobile cards and a full-screen detail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, "admin");
  await page.goto("/anomaly-ranking?tab=overview&period=mature7&groupId=group-a");
  await expect(page.getByTestId("member-desktop-table")).toBeHidden();
  const card = page.getByTestId("member-mobile-card").filter({ has: page.getByText("组员", { exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "查看详情：组员" }).click();
  const drawer = page.getByRole("dialog", { name: "组员·组员详情" });
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(389);
});

test("admin confirms a limit watch with a reason without deactivating the member", async ({ page }) => {
  test.setTimeout(60_000);
  const testStartedAt = Date.now();
  let riskPageMs = 0;
  let evidenceDrawerMs = 0;
  let decisionPostMs = 0;
  await loginAs(page, "admin");
  const originalSettingsResponse = await page.request.get("/api/admin/risk-settings");
  expect(originalSettingsResponse.status()).toBe(200);
  const originalSettings = await originalSettingsResponse.json();
  const patchResponse = await page.request.patch("/api/admin/risk-settings", {
    data: { ...originalSettings, coachingDays: 1, limitDays: 1, eliminationDays: 30 },
  });
  expect(patchResponse.status()).toBe(200);

  try {
    const riskPageStartedAt = Date.now();
    await page.goto(`/anomaly-ranking?tab=risk&period=mature7&groupId=group-a&memberId=${riskTargetId}`);
    const performanceSection = page.getByRole("region", { name: "表现风险" });
    const alert = performanceSection.getByTestId("risk-alert").filter({ hasText: riskTargetName });
    await expect(alert).toBeVisible();
    riskPageMs = Date.now() - riskPageStartedAt;
    const evidenceStartedAt = Date.now();
    await alert.getByRole("button", { name: `查看证据：${riskTargetName}` }).click();
    const drawer = page.getByRole("dialog", { name: `${riskTargetName}·组员详情` });
    await expect(drawer.getByText("启用中", { exact: true })).toBeVisible();
    evidenceDrawerMs = Date.now() - evidenceStartedAt;
    await drawer.getByRole("button", { name: "人工确认限流观察" }).click();

    const decision = page.getByRole("dialog", { name: "人工确认限流观察" });
    const reason = decision.getByLabel("确认原因");
    const cancel = decision.getByRole("button", { name: "取消" });
    await expect(reason).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(reason).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(decision).toBeHidden();
    await expect(drawer).toBeVisible();
    const confirmTrigger = drawer.getByRole("button", { name: "人工确认限流观察" });
    await expect(confirmTrigger).toBeFocused();
    await confirmTrigger.click();
    await expect(reason).toBeFocused();
    await expect(decision.getByRole("button", { name: "提交人工确认" })).toBeDisabled();
    await reason.fill("已人工复核连续偏低证据");
    const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/admin/risk-decisions") && response.request().method() === "POST");
    const decisionStartedAt = Date.now();
    await decision.getByRole("button", { name: "提交人工确认" }).click();
    const response = await responsePromise;
    decisionPostMs = Date.now() - decisionStartedAt;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toMatchObject({ memberId: riskTargetId, level: "LIMIT_WATCH", reason: "已人工复核连续偏低证据" });
    await expect(drawer.getByText("已记录人工确认")).toBeVisible();
    await expect(drawer.getByText("启用中", { exact: true })).toBeVisible();
  } finally {
    const restoreStartedAt = Date.now();
    const restoreResponse = await page.request.patch("/api/admin/risk-settings", { data: originalSettings, timeout: 10_000 });
    expect(restoreResponse.status()).toBe(200);
    console.log("[risk-confirm-timing]", JSON.stringify({
      totalMs: Date.now() - testStartedAt,
      riskPageMs,
      evidenceDrawerMs,
      decisionPostMs,
      cleanupMs: Date.now() - restoreStartedAt,
    }));
  }
});

test("admin drill-down and drawer close keep the active filters", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto(`/channel-analysis?groupId=group-a&sourceDateFrom=${rangeFrom}&sourceDateTo=${rangeTo}`);
  const channelLink = page.getByRole("table").getByRole("link").first();
  await channelLink.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: "关闭" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/groupId=group-a/);
  await expect(page).toHaveURL(new RegExp(`sourceDateFrom=${rangeFrom}`));
  await expect(page).toHaveURL(new RegExp(`sourceDateTo=${rangeTo}`));

  await channelLink.click();
  await page.getByRole("link", { name: "查看相关批次" }).click();
  await expect(page).toHaveURL(/\/batch-tracking/);
  await expect(page).toHaveURL(/groupId=group-a/);
  await expect(page).toHaveURL(new RegExp(`sourceDateFrom=${rangeFrom}`));
  await expect(page).toHaveURL(/normalizedName=/);
});

test("complete analysis tables scroll while keeping identity visible", async ({ page }) => {
  await loginAs(page, "admin");
  for (const path of [
    `/team-performance?groupId=group-a&sourceDateFrom=${rangeFrom}&sourceDateTo=${rangeTo}`,
    `/channel-analysis?groupId=group-a&sourceDateFrom=${rangeFrom}&sourceDateTo=${rangeTo}`,
  ]) {
    await page.goto(path);
    const table = page.locator("table.analysis-metrics-table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "数量指标" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "当前在群" })).toBeVisible();
    const layout = await table.evaluate((element) => {
      const wrapper = element.parentElement;
      const firstHeader = element.querySelector("th");
      return {
        scrolls: Boolean(wrapper && element.scrollWidth > wrapper.clientWidth),
        position: firstHeader ? getComputedStyle(firstHeader).position : "",
        left: firstHeader ? getComputedStyle(firstHeader).left : "",
      };
    });
    expect(layout).toEqual({ scrolls: true, position: "sticky", left: "0px" });
  }
});

test("batch detail returns to a filter-preserving history view", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto(`/batch-tracking?groupId=group-a&sourceDateFrom=${rangeFrom}&sourceDateTo=${rangeTo}`);
  await page.getByRole("table").getByRole("link").first().click();
  await page.getByRole("link", { name: "在历史记录中查看" }).click();
  await expect(page).toHaveURL(/\/history/);
  await expect(page).toHaveURL(/sourceDateFrom=/);
  await expect(page).toHaveURL(/sourceDateTo=/);
  await expect(page).toHaveURL(/memberId=/);
  await expect(page).toHaveURL(/normalizedName=/);
});

test("a lead can confirm a zero-data day", async ({ page }) => {
  const suffix = Date.now().toString();
  await loginAs(page, "admin");
  const groupResponse = await page.request.post("/api/admin/groups", { data: { name: `零数据确认组 ${suffix}` } });
  expect(groupResponse.status()).toBe(201);
  const group = await groupResponse.json();
  const username = `zero-confirm-lead-${suffix}`;
  const userResponse = await page.request.post("/api/admin/users", {
    data: { username, name: `零数据组长 ${suffix}`, password: "demo-password", role: "LEAD", groupId: group.id },
  });
  expect(userResponse.status()).toBe(201);
  await loginAs(page, username);
  await page.goto("/dashboard");
  const confirmation = page.getByRole("button", { name: "确认今日数据已填写完成" });
  await expect(confirmation).toBeVisible();
  await confirmation.click();
  await expect(page.getByRole("button", { name: /已确认/ })).toBeDisabled();
});
