import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";

const accounts = [
  { username: "admin", password: "Admin@56790", heading: "总公司工作台" },
  { username: "resource", password: "Resource@56790", heading: "资源工作台" },
  { username: "resource_sms", password: "SmsResource@56790", heading: "资源工作台" },
  { username: "company", password: "Company@56790", heading: "公司工作台" },
  { username: "lead", password: "Lead@56790", heading: "组长工作台" },
  { username: "reception", password: "Reception@56790", heading: "今日待办" },
  { username: "operator", password: "Operator@56790", heading: "炒群今日待办" },
  { username: "expert", password: "Expert@56790", heading: "专家今日待办" },
] as const;

async function login(page: Page, username: string, password: string) {
  const response = await page.request.post("/api/auth/login", { data: { username, password } });
  expect(response.status(), `${username} 应能使用当前测试密码登录`).toBe(200);
}

async function rolePage(browser: Browser, username: string, password: string) {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL });
  const page = await context.newPage();
  await login(page, username, password);
  return { context, page };
}

async function close(context: BrowserContext) {
  await context.close();
}

function businessDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

test("all current test accounts can sign in and see the shared leaderboard", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const account of accounts) {
    const { context, page } = await rolePage(browser, account.username, account.password);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: account.heading })).toBeVisible();
    await page.goto("/performance-leaderboard");
    await expect(page.getByRole("heading", { name: "精英榜" })).toBeVisible();
    await close(context);
  }
});

test("reception enters customer profile first and chooses the device when contacting", async ({ browser }) => {
  test.setTimeout(120_000);
  const reception = await rolePage(browser, "reception", "Reception@56790");
  await reception.page.goto("/entry?workspace=intake");

  await expect(reception.page.getByText(/录入客户资料/)).toBeVisible();
  await expect(reception.page.getByLabel(/客户平台/)).toBeVisible();
  await expect(reception.page.getByText(/设备号会在“待回复”里，实际联系客户时再选择/)).toBeVisible();
  await reception.page.getByRole("button", { name: "客户回复管理" }).click();
  await expect(reception.page.getByRole("heading", { name: "联系与回复" })).toBeVisible();
  await close(reception.context);
});

test("a customer can move from reception through group operation to expert order", async ({ browser }) => {
  test.setTimeout(120_000);
  const today = businessDate("Asia/Shanghai");
  const phone = `151${Date.now().toString().slice(-8)}`;
  const channelName = `闭环验收渠道-${Date.now()}`;

  const reception = await rolePage(browser, "reception", "Reception@56790");
  const imported = await reception.page.request.post("/api/leads", {
    data: { sourceDate: today, channelName, rows: [{ phone, deviceCode: "E2E-1" }] },
  });
  expect(imported.status()).toBe(201);
  expect(await imported.json()).toMatchObject({ imported: 1 });

  await reception.page.goto("/entry?tab=reply");
  const replyRow = reception.page.getByRole("row").filter({ hasText: phone });
  await expect(replyRow).toBeVisible();
  await replyRow.getByRole("button", { name: "确认已回复" }).click();
  const replyDialog = reception.page.getByRole("dialog", { name: "确认客户已经联系？" });
  await expect(replyDialog).toBeVisible();
  await replyDialog.getByRole("button", { name: "确认已回复" }).click();
  await expect(reception.page.getByRole("status")).toContainText("已确认联系");

  await reception.page.getByRole("button", { name: /已回复，待入群/ }).click();
  let groupRow = reception.page.getByRole("row").filter({ hasText: phone });
  await expect(groupRow).toBeVisible();
  await groupRow.getByRole("button", { name: "撤销回复" }).click();
  const undoReplyDialog = reception.page.getByRole("dialog", { name: "确认撤销客户回复？" });
  await expect(undoReplyDialog).toBeVisible();
  await undoReplyDialog.getByLabel("撤销原因").fill("闭环验收：刚才误点");
  await undoReplyDialog.getByRole("button", { name: "确认撤销回复" }).click();
  await expect(reception.page.getByRole("status")).toContainText("已撤销回复");

  await reception.page.getByRole("button", { name: /待回复/ }).click();
  await expect(replyRow).toBeVisible();
  await replyRow.getByRole("button", { name: "确认已回复" }).click();
  await reception.page.getByRole("dialog", { name: "确认客户已经联系？" }).getByRole("button", { name: "确认已回复" }).click();
  await reception.page.getByRole("button", { name: /已回复，待入群/ }).click();
  groupRow = reception.page.getByRole("row").filter({ hasText: phone });
  await expect(groupRow).toBeVisible();
  await groupRow.getByRole("button", { name: "确认入群" }).click();
  const groupDialog = reception.page.getByRole("dialog", { name: "确认客户已经入群？" });
  await expect(groupDialog).toBeVisible();
  await groupDialog.getByRole("button", { name: "确认入群" }).click();
  await expect(reception.page.getByRole("status")).toContainText("已确认入群");
  await close(reception.context);

  const operator = await rolePage(browser, "operator", "Operator@56790");
  await operator.page.goto("/group-customers");
  let operatorRow = operator.page.getByRole("row").filter({ hasText: phone });
  await expect(operatorRow).toBeVisible();
  await operatorRow.getByRole("button", { name: "填写进度" }).click();
  const progressDialog = operator.page.getByRole("dialog", { name: "填写今日进度" });
  await progressDialog.getByPlaceholder(/群内有互动/).fill("闭环验收：已完成今日跟进，准备推专家。");
  await progressDialog.getByRole("button", { name: "保存今日进度" }).click();
  await expect(operator.page.getByRole("status")).toContainText("今日进度已保存");

  operatorRow = operator.page.getByRole("row").filter({ hasText: phone });
  await operatorRow.getByRole("button", { name: "推专家" }).click();
  const assignmentDialog = operator.page.getByRole("dialog", { name: "推专家并分配负责人" });
  await assignmentDialog.getByText("前台专家 A", { exact: true }).click();
  await assignmentDialog.getByRole("button", { name: "确认介绍并分配" }).click();
  await expect(operator.page.getByRole("status")).toContainText("客户当前为排队中");
  await close(operator.context);

  const expert = await rolePage(browser, "expert", "Expert@56790");
  await expert.page.goto("/expert-customers");
  let expertRow = expert.page.getByRole("row").filter({ hasText: phone });
  await expect(expertRow).toBeVisible();
  await expertRow.getByRole("button", { name: "开始接待" }).click();
  let stageDialog = expert.page.getByRole("dialog", { name: "开始接待该客户？" });
  await stageDialog.getByRole("button", { name: "确认开始接待" }).click();
  await expert.page.getByRole("button", { name: /交资料 1/ }).click();
  expertRow = expert.page.getByRole("row").filter({ hasText: phone });
  await expect(expertRow).toContainText("交资料");
  await expertRow.getByRole("button", { name: "资料已交 · 开始追踪" }).click();
  stageDialog = expert.page.getByRole("dialog", { name: "确认客户已交资料？" });
  await stageDialog.getByRole("button", { name: "确认开始追踪" }).click();
  await expert.page.getByRole("button", { name: /追踪中 1/ }).click();
  expertRow = expert.page.getByRole("row").filter({ hasText: phone });
  await expect(expertRow).toContainText("追踪中");
  await expertRow.getByRole("button", { name: "转为待注册" }).click();
  stageDialog = expert.page.getByRole("dialog", { name: "确认转为待注册？" });
  await stageDialog.getByRole("button", { name: "确认转待注册" }).click();
  await expert.page.getByRole("button", { name: /待注册 1/ }).click();
  expertRow = expert.page.getByRole("row").filter({ hasText: phone });
  await expect(expertRow).toContainText("待注册");
  const registered = expert.page.waitForResponse((response) =>
    response.url().includes("/api/leads/") &&
    response.request().method() === "PATCH" &&
    Boolean(response.request().postData()?.includes('"register"')),
  );
  await expertRow.getByRole("button", { name: "标记已注册" }).click();
  const registrationDialog = expert.page.getByRole("dialog", { name: "确认客户已经完成注册？" });
  await expect(registrationDialog).toBeVisible();
  await registrationDialog.getByRole("button", { name: "确认标记已注册" }).click();
  expect((await registered).status()).toBe(200);
  await expert.page.getByRole("button", { name: /待开单 1/ }).click();
  expertRow = expert.page.getByRole("row").filter({ hasText: phone });
  await expect(expertRow).toContainText("待开单");
  await expertRow.getByRole("button", { name: "登记开单" }).click();
  const orderEditor = expert.page.getByRole("dialog", { name: "登记开单" });
  await orderEditor.getByLabel("首充金额（美元）").fill("100");
  const ordered = expert.page.waitForResponse((response) =>
    response.url().endsWith("/api/customer-orders") && response.request().method() === "POST",
  );
  await orderEditor.getByRole("button", { name: "下一步确认" }).click();
  const orderDialog = expert.page.getByRole("dialog", { name: "确认登记客户开单？" });
  await expect(orderDialog).toContainText("$100.00");
  await orderDialog.getByRole("button", { name: "确认登记开单" }).click();
  expect((await ordered).status()).toBe(201);
  await expert.page.getByRole("button", { name: /已开单 1/ }).click();
  await expect(expert.page.getByRole("row").filter({ hasText: phone })).toContainText("$100.00");
  await close(expert.context);
});
