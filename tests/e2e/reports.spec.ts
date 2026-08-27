import { expect, test, type Page } from "@playwright/test";

async function loginAs(page: Page, username: string, password: string) {
  let status = 0;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const response = await page.request.post("/api/auth/login", { data: { username, password }, timeout: 3_000 });
      status = response.status();
      if (status === 200) {
        await page.goto("/");
        return;
      }
    } catch {
      // A freshly started Next dev server can briefly accept the browser before its API route is ready.
    }
    await page.waitForTimeout(250);
  }
  expect(status).toBe(200);
}

test("member retains cohort conversion cards, funnel and occurrence-date increments", async ({ page }) => {
  const suffix = Date.now();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "admin", "demo-password");
  const channelResponse = await page.request.post("/api/admin/channels", {
    data: { id: `report-channel-${suffix}`, name: `报表渠道 ${suffix}`, groupId: "group-a" },
  });
  const channel = await channelResponse.json();
  await loginAs(page, "member", "demo-password");
  const batchResponse = await page.request.post("/api/batches", {
    data: { channelId: channel.id, sourceDate: "2026-08-08", quantity: 10, effectiveFans: 10, noNumber: 0, duplicateFans: 0 },
  });
  const batch = (await batchResponse.json()).batches[0];
  await page.request.post("/api/events", {
    data: { batchId: batch.id, occurredOn: "2026-08-10", kind: "GROUP_JOIN", quantity: 6 },
  });

  await page.goto(`/reports?groupId=group-a&channelId=${channel.id}&sourceDateFrom=2026-08-08&sourceDateTo=2026-08-08`);
  await expect(page.getByRole("heading", { name: "来源批次转化报表" })).toBeVisible();
  await expect(page.getByText(`2026-08-08 · 报表渠道 ${suffix}`)).toBeVisible();
  const metricCards = page.getByRole("region", { name: "关键指标" });
  await expect(metricCards.getByText("推专家", { exact: true })).toBeVisible();
  await expect(metricCards.getByText("注册", { exact: true })).toBeVisible();
  await expect(metricCards.locator("article")).toHaveCount(9);
  const conversionCards = page.getByRole("region", { name: "转化比例" });
  await expect(conversionCards.locator("article")).toHaveCount(5);
  await expect(conversionCards.locator("article").filter({ hasText: "入群率" })).toContainText("60.0%");
  await expect(page.getByText("暂无数据").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "转化漏斗" })).toBeVisible();
  const channelComparison = page.getByRole("region", { name: "渠道对比" });
  await expect(channelComparison.getByRole("heading", { name: "渠道对比" })).toBeVisible();
  const comparisonRow = channelComparison.getByRole("row").filter({ hasText: `报表渠道 ${suffix}` });
  await expect(comparisonRow.getByRole("cell").nth(1)).toHaveText("10");
  await expect(comparisonRow.getByRole("cell").nth(2)).toHaveText("6");
  await expect(comparisonRow.getByRole("cell").last()).toHaveText("入群率 60.0%");
  const detailSection = page.getByRole("heading", { name: "来源批次明细" }).locator("xpath=ancestor::section");
  for (const metric of ["提交号码", "回复", "入群", "退群", "在群", "推专家", "注册", "开单", "入金", "入群率", "退群率", "进群后推专家率", "注册率", "开单率"]) {
    await expect(detailSection.getByText(metric, { exact: true })).toBeVisible();
  }
  const detailWidth = await detailSection.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(detailWidth.scroll).toBeLessThanOrEqual(detailWidth.client);
  const pageWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client);

  await page.getByLabel("报表模式").selectOption("incremental");
  await page.getByLabel("发生日期开始").fill("2026-08-10");
  await page.getByLabel("发生日期结束").fill("2026-08-10");
  await page.getByRole("button", { name: "查询报表" }).click();
  await expect(page.getByLabel("报表模式")).toHaveValue("incremental");
  await expect(page.getByRole("region", { name: "关键指标" }).locator("article").filter({ hasText: "提交号码" }).first()).toContainText("0");
  await expect(page.getByRole("region", { name: "转化比例" })).not.toContainText("60.0%");
  await expect(page.getByRole("heading", { name: "转化漏斗" }).locator("xpath=ancestor::section")).toContainText("暂无数据");
});
