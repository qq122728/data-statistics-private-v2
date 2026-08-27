import { expect, test, type Page } from "@playwright/test";

function todayInAppTimezone() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function loginAsMember(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { username: "member", password: "demo-password" },
  });
  expect(response.status()).toBe(200);
  await page.goto("/dashboard");
}

async function createDashboardFixture(page: Page) {
  const batchResponse = await page.request.post("/api/batches", {
    data: { channelId: "channel-1", sourceDate: "2026-08-07", quantity: 10, effectiveFans: 10, noNumber: 0, duplicateFans: 0 },
  });
  expect(batchResponse.status()).toBe(201);
  const batch = (await batchResponse.json()).batches[0];
  const eventsResponse = await page.request.post("/api/events", {
    data: { events: [
      { batchId: batch.id, occurredOn: "2026-08-11", kind: "REPLIES", quantity: 3 },
      { batchId: batch.id, occurredOn: "2026-08-11", kind: "GROUP_JOIN", quantity: 4 },
      { batchId: batch.id, occurredOn: "2026-08-11", kind: "REGISTRATION", quantity: 2 },
      { batchId: batch.id, occurredOn: "2026-08-11", kind: "ORDER", quantity: 1 },
    ] },
  });
  expect(eventsResponse.status()).toBe(201);
  await page.reload();
}

test("dashboard exposes metrics, filters and operational insight regions", async ({ page }) => {
  await loginAsMember(page);
  await createDashboardFixture(page);

  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect(page.getByTestId("app-header-identity")).toContainText("组员");
  await expect(page.getByTestId("app-header-identity")).toContainText("成员 · 一组");

  const metrics = page.getByRole("region", { name: "关键指标" });
  await expect(metrics.locator("article")).toHaveCount(9);
  for (const label of ["提交号码", "回复", "入群", "退群", "群内", "推专家", "注册", "开单", "入金"]) {
    await expect(metrics.getByText(label, { exact: true })).toBeVisible();
  }

  const ratios = page.getByRole("region", { name: "转化比例" });
  await expect(ratios.locator("article")).toHaveCount(5);
  for (const label of ["入群率", "退群率", "进群后推专家率", "注册率", "开单率"]) {
    await expect(ratios.getByText(label, { exact: true })).toBeVisible();
  }

  const trend = page.getByRole("region", { name: "转化趋势" });
  await expect(trend.getByRole("application")).toBeVisible();
  const recent = page.getByRole("region", { name: "最近操作" });
  await expect(recent.getByRole("table")).toBeVisible();
  const anomalies = page.getByRole("region", { name: "数据异常" });
  await expect(anomalies.locator("ul")).toBeVisible();

  await page.getByLabel("报表模式").selectOption("incremental");
  await page.getByLabel("来源日期开始").fill("2026-08-01");
  await page.getByLabel("发生日期结束").fill("2099-12-31");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page).toHaveURL(/mode=incremental/);
  await expect(page).toHaveURL(/sourceDateFrom=2026-08-01/);
  await expect(page).toHaveURL(/occurredDateTo=2099-12-31/);
  await expect(page.getByText(`增量模式：只统计 ${todayInAppTimezone()} 至 ${todayInAppTimezone()} 发生的新增数据；转化率暂不计算。`)).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("app-header-identity")).toBeVisible();
  await expect(page.getByTestId("app-header-identity")).toContainText("组员");
  await expect(page.getByTestId("app-header-identity")).toContainText("成员 · 一组");
});

test("management overview links preserve the active analysis filters", async ({ page }) => {
  const response = await page.request.post("/api/auth/login", {
    data: { username: "admin", password: "demo-password" },
  });
  expect(response.status()).toBe(200);
  await page.goto("/dashboard?groupId=group-a&sourceDateFrom=2026-07-01&sourceDateTo=2026-08-12");

  await page.getByRole("link", { name: "查看渠道分析" }).click();

  await expect(page).toHaveURL(/\/channel-analysis/);
  await expect(page).toHaveURL(/groupId=group-a/);
  await expect(page).toHaveURL(/sourceDateFrom=2026-07-01/);
  await expect(page).toHaveURL(/sourceDateTo=2026-08-12/);
});
