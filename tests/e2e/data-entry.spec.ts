import { expect, test, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";

async function loginAs(page: Page, username: string, password: string) {
  let status = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await page.request.post("/api/auth/login", {
        data: { username: username === "admin@example.com" ? "admin" : username, password },
        timeout: 3_000,
      });
      status = response.status();
      if (status === 200) {
        await page.goto("/");
        return;
      }
    } catch {
      // The fresh Next dev server can briefly accept the browser before its API routes are ready.
    }
    await page.waitForTimeout(250);
  }
  expect(status).toBe(200);
}

async function warmAdminChannelRoute(page: Page) {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await page.request.post("/api/admin/channels", { data: {} });
      expect(response.status()).toBe(400);
      return;
    } catch (error) {
      failure = error;
      await page.waitForTimeout(250);
    }
  }
  throw failure;
}

async function addMetricRow(page: Page, batch: string, quantity: string) {
  await page.getByRole("button", { name: "添加一行" }).click();
  const row = page.getByTestId("metric-row").last();
  await row.getByRole("combobox", { name: "来源批次" }).selectOption({ label: batch });
  await row.getByLabel("数量").fill(quantity);
}

async function chooseChannel(row: ReturnType<Page["getByTestId"]>, name: string) {
  await row.getByLabel("渠道", { exact: true }).fill(name);
  await row.getByRole("option", { name, exact: true }).click();
}

async function expectAssociatedError(row: ReturnType<Page["getByTestId"]>, label: string) {
  const control = label === "来源批次" ? row.getByRole("combobox", { name: label }) : row.getByLabel(label, { exact: true });
  await expect(control).toHaveAttribute("aria-invalid", "true");
  const errorId = await control.getAttribute("aria-describedby");
  expect(errorId).toBeTruthy();
  await expect(row.locator(`[id="${errorId}"]`)).toBeVisible();
}

async function chooseEntryStep(page: Page, name: string) {
  await page.getByTestId("entry-stepper").getByRole("button", { name: new RegExp(name) }).click();
}

function businessDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

const fanBreakdown = (quantity: number, effectiveFans = quantity, noNumber = 0, duplicateFans = 0) => ({
  quantity,
  effectiveFans,
  noNumber,
  duplicateFans,
});

test("member records replies for two earlier source batches without new fans", async ({ page, browser }) => {
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin@example.com", "demo-password");

  const suffix = Date.now();
  await warmAdminChannelRoute(adminPage);
  const createFirstChannel = await adminPage.request.post("/api/admin/channels", {
    data: { id: `entry-channel-1-${suffix}`, name: "渠道 1", groupId: "group-a" },
  });
  expect(createFirstChannel.status()).toBe(201);
  const channel1 = await createFirstChannel.json();
  const createSecondChannel = await adminPage.request.post("/api/admin/channels", {
    data: { id: `entry-channel-2-${suffix}`, name: "渠道 2", groupId: "group-a" },
  });
  expect(createSecondChannel.status()).toBe(201);
  const channel2 = await createSecondChannel.json();

  await loginAs(page, "member", "demo-password");
  const firstBatch = await page.request.post("/api/batches", {
    data: { channelId: channel1.id, sourceDate: "2026-08-08", ...fanBreakdown(1) },
  });
  expect(firstBatch.status()).toBe(201);
  const secondBatch = await page.request.post("/api/batches", {
    data: { channelId: channel2.id, sourceDate: "2026-08-06", ...fanBreakdown(1) },
  });
  expect(secondBatch.status()).toBe(201);
  await adminContext.close();

  await page.goto("/entry");
  await chooseEntryStep(page, "回复记录");
  await addMetricRow(page, "2026-08-08 · 渠道 1 · 一组", "2");
  await addMetricRow(page, "2026-08-06 · 渠道 2 · 一组", "2");
  await page.getByRole("button", { name: "保存回复" }).click();
  await expect(page.getByText("已保存 2 条回复记录")).toBeVisible();
});

test("member records multiple new-fans rows for different channels in one save", async ({ page, browser }) => {
  const suffix = Date.now();
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin@example.com", "demo-password");
  const channelResponse = await adminPage.request.post("/api/admin/channels", { data: { name: `提交号码渠道 ${suffix}`, groupId: "group-a" } });
  expect(channelResponse.status()).toBe(201);
  await adminContext.close();
  await loginAs(page, "member", "demo-password");
  await page.goto("/entry");

  await page.getByRole("button", { name: "添加一行" }).click();
  await page.getByRole("button", { name: "添加一行" }).click();
  const rows = page.getByTestId("new-fans-row");
  await chooseChannel(rows.nth(0), "底料");
  await rows.nth(0).getByLabel("当日粉数量").fill("3");
  await rows.nth(0).getByLabel("有效粉数量").fill("2");
  await rows.nth(0).getByLabel("无号码数量").fill("1");
  await rows.nth(0).getByLabel("撞粉数量").fill("0");
  await chooseChannel(rows.nth(1), `提交号码渠道 ${suffix}`);
  await rows.nth(1).getByLabel("当日粉数量").fill("4");
  await rows.nth(1).getByLabel("有效粉数量").fill("3");
  await rows.nth(1).getByLabel("无号码数量").fill("0");
  await rows.nth(1).getByLabel("撞粉数量").fill("1");
  const save = page.waitForResponse((response) => response.url().endsWith("/api/batches") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存提交号码" }).click();
  const savedResponse = await save;
  expect(savedResponse.status()).toBe(201);
  expect(await savedResponse.json()).toMatchObject({ saved: 2 });
  await expect(page.getByText("已保存 2 条提交号码记录")).toBeVisible();
});

test("an inline-created channel is shared within its group, isolated from other groups, and reportable", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const suffix = Date.now();
  const channelName = `行内创建渠道 ${suffix}`;
  const sourceDate = businessDate("Asia/Shanghai");

  await loginAs(page, "member", "demo-password");
  await page.goto("/entry");
  await page.getByRole("button", { name: "添加一行" }).click();
  const memberRow = page.getByTestId("new-fans-row");
  await memberRow.getByLabel("来源日期").fill(sourceDate);
  await memberRow.getByLabel("渠道", { exact: true }).fill(channelName);
  await memberRow.getByRole("option", { name: `创建渠道：${channelName}`, exact: true }).click();
  await memberRow.getByLabel("当日粉数量").fill("100");
  await memberRow.getByLabel("有效粉数量").fill("80");
  await memberRow.getByLabel("无号码数量").fill("10");
  await memberRow.getByLabel("撞粉数量").fill("11");
  await expect(memberRow.getByRole("alert")).toContainText("有效粉、无 WS 号码和撞粉合计不能大于提交号码");
  await memberRow.getByLabel("撞粉数量").fill("5");
  await expect(memberRow).toContainText("剩余其他无效粉：5");
  await page.getByRole("button", { name: "保存提交号码" }).click();
  await expect(page.getByRole("status")).toHaveText("已保存 1 条提交号码记录");

  await chooseEntryStep(page, "财务记录");
  await page.getByRole("button", { name: "添加一行" }).click();
  const financialRow = page.getByTestId("financial-row");
  await financialRow.getByRole("combobox", { name: "来源批次" }).selectOption({ label: `${sourceDate} · ${channelName} · 一组` });
  await financialRow.getByLabel("发生日期").fill(sourceDate);
  await financialRow.getByLabel("出金金额（美元）").fill("12.34");
  await financialRow.getByLabel("通道业绩（美元）").fill("45.67");
  const financialSaved = page.waitForResponse((response) => response.url().endsWith("/api/events") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存财务记录" }).click();
  const financialResponse = await financialSaved;
  expect(financialResponse.status()).toBe(201);
  expect((await financialResponse.json()).events).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "WITHDRAWAL", amountCents: 1234 }),
    expect.objectContaining({ kind: "CHANNEL_PERFORMANCE", amountCents: 4567 }),
  ]));

  const leadContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const leadPage = await leadContext.newPage();
  await loginAs(leadPage, "lead", "demo-password");
  await leadPage.goto("/entry");
  await leadPage.getByRole("button", { name: "添加一行" }).click();
  const leadRow = leadPage.getByTestId("new-fans-row");
  await leadRow.getByLabel("渠道", { exact: true }).fill(channelName);
  await expect(leadRow.getByRole("option", { name: channelName, exact: true })).toBeVisible();
  await expect(leadRow.getByRole("option", { name: `创建渠道：${channelName}`, exact: true })).toHaveCount(0);
  await leadContext.close();

  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin", "demo-password");
  await adminPage.goto(`/reports?groupId=group-a&sourceDateFrom=${sourceDate}&sourceDateTo=${sourceDate}`);
  await expect(adminPage).toHaveURL(/\/team-performance/);

  await adminPage.goto(`/channel-analysis?groupId=group-a&normalizedName=${encodeURIComponent(channelName)}&sourceDateFrom=${sourceDate}&sourceDateTo=${sourceDate}`);
  const channelRow = adminPage.getByRole("row").filter({ hasText: channelName });
  await expect(channelRow).toContainText("100");

  await adminContext.close();
});

test("new-fans form keeps its row when the server rejects a deactivated channel", async ({ page, browser }) => {
  const suffix = Date.now();
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin@example.com", "demo-password");
  const channelResponse = await adminPage.request.post("/api/admin/channels", { data: { name: `停用渠道 ${suffix}`, groupId: "group-a" } });
  const channel = await channelResponse.json();
  await loginAs(page, "member", "demo-password");
  await page.goto("/entry");
  await page.getByRole("button", { name: "添加一行" }).click();
  const row = page.getByTestId("new-fans-row");
  await chooseChannel(row, `停用渠道 ${suffix}`);
  await row.getByLabel("当日粉数量").fill("6");
  await row.getByLabel("有效粉数量").fill("6");
  await row.getByLabel("无号码数量").fill("0");
  await row.getByLabel("撞粉数量").fill("0");
  await adminPage.request.patch("/api/admin/channels", { data: { id: channel.id, groupId: "group-a", active: false } });
  await page.getByRole("button", { name: "保存提交号码" }).click();
  await expect(row.getByText("渠道或小组已停用")).toBeVisible();
  await expect(row.getByLabel("渠道")).toHaveValue(`停用渠道 ${suffix}`);
  await expect(row.getByLabel("当日粉数量")).toHaveValue("6");
  await adminContext.close();
});

test("entry APIs reuse keys and reject invalid, inactive, and cross-group writes", async ({ page, browser }) => {
  const suffix = Date.now();
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin@example.com", "demo-password");
  const ownChannelResponse = await adminPage.request.post("/api/admin/channels", { data: { name: `接口渠道 A ${suffix}`, groupId: "group-a" } });
  const ownChannel = await ownChannelResponse.json();
  const otherChannelResponse = await adminPage.request.post("/api/admin/channels", { data: { name: `接口渠道 B ${suffix}`, groupId: "group-b" } });
  const otherChannel = await otherChannelResponse.json();
  const otherUsername = `entry-group-b-${suffix}`;
  expect((await adminPage.request.post("/api/admin/users", {
    data: { username: otherUsername, name: `二组录入人 ${suffix}`, password: "demo-password", role: "RECEPTION", groupId: "group-b" },
  })).status()).toBe(201);
  const otherContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const otherPage = await otherContext.newPage();
  await loginAs(otherPage, otherUsername, "demo-password");
  await loginAs(page, "member", "demo-password");

  const negative = await page.request.post("/api/batches", { data: { channelId: ownChannel.id, sourceDate: "2026-08-14", ...fanBreakdown(0), quantity: -1 } });
  expect(negative.status()).toBe(400);
  expect((await negative.json()).fields["batches.0.quantity"]).toBeTruthy();
  const first = await page.request.post("/api/batches", { data: { channelId: ownChannel.id, sourceDate: "2026-08-14", ...fanBreakdown(1) } });
  const second = await page.request.post("/api/batches", { data: { channelId: ownChannel.id, sourceDate: "2026-08-14", ...fanBreakdown(2) } });
  const firstBody = await first.json();
  const secondBody = await second.json();
  expect(firstBody.batches[0].id).toBe(secondBody.batches[0].id);
  const ownBatch = firstBody.batches[0].id;
  const otherBatchResponse = await otherPage.request.post("/api/batches", { data: { channelId: otherChannel.id, sourceDate: "2026-08-14", ...fanBreakdown(1) } });
  const otherBatch = (await otherBatchResponse.json()).batches[0];
  const crossGroup = await page.request.post("/api/events", { data: { batchId: otherBatch.id, occurredOn: "2026-08-14", kind: "REPLIES", quantity: 1 } });
  expect(crossGroup.status()).toBe(403);
  expect((await crossGroup.json()).fields["rows.0.batchId"]).toBeTruthy();
  await adminPage.request.patch("/api/admin/channels", { data: { id: ownChannel.id, groupId: "group-a", active: false } });
  const inactive = await page.request.post("/api/events", { data: { batchId: ownBatch, occurredOn: "2026-08-14", kind: "REPLIES", quantity: 1 } });
  expect(inactive.status()).toBe(400);
  await otherContext.close();
  await adminContext.close();
});

test("entry API returns all row-scoped errors without writing a partial batch", async ({ page, browser }) => {
  const suffix = Date.now();
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin@example.com", "demo-password");
  const otherChannelResponse = await adminPage.request.post("/api/admin/channels", { data: { name: `错误渠道 ${suffix}`, groupId: "group-b" } });
  const otherChannel = await otherChannelResponse.json();
  const otherUsername = `entry-errors-group-b-${suffix}`;
  expect((await adminPage.request.post("/api/admin/users", {
    data: { username: otherUsername, name: `错误二组录入人 ${suffix}`, password: "demo-password", role: "RECEPTION", groupId: "group-b" },
  })).status()).toBe(201);
  const otherContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const otherPage = await otherContext.newPage();
  await loginAs(otherPage, otherUsername, "demo-password");
  const otherBatchResponse = await otherPage.request.post("/api/batches", { data: { channelId: otherChannel.id, sourceDate: "2026-08-16", ...fanBreakdown(1) } });
  const otherBatch = (await otherBatchResponse.json()).batches[0];
  const memberContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const memberPage = await memberContext.newPage();
  await loginAs(memberPage, "member", "demo-password");
  const response = await memberPage.request.post("/api/events", { data: { events: [
    { batchId: "missing-batch", occurredOn: "2026-08-16", kind: "REPLIES", quantity: 1 },
    { batchId: otherBatch.id, occurredOn: "2026-08-16", kind: "REPLIES", quantity: 1 },
  ] } });
  expect(response.status()).toBe(403);
  const body = await response.json();
  expect(body.fields["rows.0.batchId"]).toBeTruthy();
  expect(body.fields["rows.1.batchId"]).toBeTruthy();
  await otherContext.close();
  await memberContext.close();
  await adminContext.close();
});

test("entry API rejects mixed invalid rows without writing a valid sibling event", async ({ page, browser }) => {
  const suffix = Date.now();
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin@example.com", "demo-password");
  const channelResponse = await adminPage.request.post("/api/admin/channels", { data: { name: `混合错误渠道 ${suffix}`, groupId: "group-a" } });
  const channel = await channelResponse.json();
  const memberContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const memberPage = await memberContext.newPage();
  await loginAs(memberPage, "member", "demo-password");
  const batchResponse = await memberPage.request.post("/api/batches", { data: { channelId: channel.id, sourceDate: "2026-08-17", ...fanBreakdown(1) } });
  const batch = (await batchResponse.json()).batches[0];
  const response = await memberPage.request.post("/api/events", { data: { events: [
    { batchId: batch.id, occurredOn: "2026-08-17", kind: "REPLIES", quantity: -1 },
    { batchId: "missing-mixed-batch", occurredOn: "2026-08-17", kind: "REPLIES", quantity: 1 },
    { batchId: batch.id, occurredOn: "2026-08-17", kind: "REPLIES", quantity: 2 },
  ] } });
  expect(response.status()).toBe(400);
  const body = await response.json();
  expect(body.fields["rows.0.quantity"]).toBeTruthy();
  expect(body.fields["rows.1.batchId"]).toBeTruthy();
  await expect.poll(async () => {
    const history = await memberPage.request.get(`/api/history?occurredOn=2026-08-17&sourceDate=2026-08-17&channelId=${channel.id}`);
    const events = (await history.json()).events as Array<{ kind: string }>;
    return events.filter((event) => event.kind === "REPLIES").length;
  }).toBe(0);
  await memberContext.close();
  await adminContext.close();
});

test("one group or conversion row saves every entered metric atomically", async ({ page, browser }) => {
  const suffix = Date.now();
  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin@example.com", "demo-password");
  const channelResponse = await adminPage.request.post("/api/admin/channels", { data: { name: `入金渠道 ${suffix}`, groupId: "group-a" } });
  const channel = await channelResponse.json();
  await loginAs(page, "member", "demo-password");
  const batchResponse = await page.request.post("/api/batches", { data: { channelId: channel.id, sourceDate: "2026-08-15", ...fanBreakdown(1) } });
  const batchId = (await batchResponse.json()).batches[0].id;
  await adminContext.close();
  await page.goto("/entry");
  await chooseEntryStep(page, "拉群与退群");
  await page.getByRole("button", { name: "添加一行" }).click();
  const groupChanges = page.getByTestId("metric-row");
  await groupChanges.getByRole("combobox", { name: "来源批次" }).selectOption({ label: `2026-08-15 · 入金渠道 ${suffix} · 一组` });
  await groupChanges.getByLabel("发生日期").fill("2026-08-18");
  await groupChanges.getByLabel("拉群数量").fill("2");
  await groupChanges.getByLabel("退群数量").fill("-1");
  await page.locator("form").evaluate((form) => { (form as HTMLFormElement).noValidate = true; });
  await page.getByRole("button", { name: "保存拉群与退群" }).click();
  await expectAssociatedError(groupChanges, "退群数量");
  await expect.poll(async () => {
    const history = await page.request.get(`/api/history?occurredOn=2026-08-18&sourceDate=2026-08-15&channelId=${channel.id}`);
    return (await history.json()).events.length;
  }).toBe(0);

  await groupChanges.getByLabel("退群数量").fill("0");
  const groupSaved = page.waitForResponse((response) => response.url().endsWith("/api/events") && response.request().method() === "POST" && response.status() === 201);
  await page.getByRole("button", { name: "保存拉群与退群" }).click();
  await expect(page.getByText("已保存 2 条拉群与退群记录")).toBeVisible();
  expect((await (await groupSaved).json()).events).toEqual(expect.arrayContaining([
    expect.objectContaining({ batchId, occurredOn: "2026-08-18", kind: "GROUP_JOIN", quantity: 2 }),
    expect.objectContaining({ batchId, occurredOn: "2026-08-18", kind: "GROUP_LEAVE", quantity: 0 }),
  ]));

  await chooseEntryStep(page, "转化与入金");
  await page.getByRole("button", { name: "添加一行" }).click();
  const conversion = page.getByTestId("metric-row");
  await conversion.getByRole("combobox", { name: "来源批次" }).selectOption({ label: `2026-08-15 · 入金渠道 ${suffix} · 一组` });
  await conversion.getByLabel("发生日期").fill("2026-08-19");
  await conversion.getByLabel("推专家数量").fill("4");
  await conversion.getByLabel("注册数量").fill("3");
  await conversion.getByLabel("开单人数").fill("2");
  await conversion.getByLabel("总入金（美元）").fill("12.34");
  const conversionSaved = page.waitForResponse((response) => response.url().endsWith("/api/events") && response.request().method() === "POST" && response.status() === 201);
  await page.getByRole("button", { name: "保存转化与入金" }).click();
  await expect(page.getByText("已保存 4 条转化与入金记录")).toBeVisible();
  expect((await (await conversionSaved).json()).events).toEqual(expect.arrayContaining([
    expect.objectContaining({ batchId, occurredOn: "2026-08-19", kind: "EXPERT_INTRO", quantity: 4 }),
    expect.objectContaining({ batchId, occurredOn: "2026-08-19", kind: "REGISTRATION", quantity: 3 }),
    expect.objectContaining({ batchId, occurredOn: "2026-08-19", kind: "ORDER", quantity: 2 }),
    expect.objectContaining({ batchId, occurredOn: "2026-08-19", kind: "RECHARGE", amountCents: 1234 }),
  ]));

  await page.getByRole("button", { name: "添加一行" }).click();
  const sparse = page.getByTestId("metric-row");
  await sparse.getByRole("combobox", { name: "来源批次" }).selectOption({ label: `2026-08-15 · 入金渠道 ${suffix} · 一组` });
  await sparse.getByLabel("发生日期").fill("2026-08-20");
  await sparse.getByLabel("注册数量").fill("0");
  const sparseSaved = page.waitForResponse((response) => response.url().endsWith("/api/events") && response.request().method() === "POST" && response.status() === 201);
  await page.getByRole("button", { name: "保存转化与入金" }).click();
  await expect(page.getByText("已保存 1 条转化与入金记录")).toBeVisible();
  expect((await (await sparseSaved).json()).events).toEqual([
    expect.objectContaining({ batchId, occurredOn: "2026-08-20", kind: "REGISTRATION", quantity: 0 }),
  ]);

  await page.getByRole("button", { name: "添加一行" }).click();
  const failed = page.getByTestId("metric-row").last();
  await failed.getByRole("combobox", { name: "来源批次" }).selectOption({ label: `2026-08-15 · 入金渠道 ${suffix} · 一组` });
  await failed.getByLabel("总入金（美元）").fill("1.234");
  await page.locator("form").evaluate((form) => { (form as HTMLFormElement).noValidate = true; });
  await page.getByRole("button", { name: "保存转化与入金" }).click();
  await expectAssociatedError(failed, "总入金（美元）");
  await expect(failed.getByLabel("总入金（美元）")).toHaveValue("1.234");
});

test("entry field errors identify their individual controls", async ({ page }) => {
  await loginAs(page, "member", "demo-password");
  await page.goto("/entry");
  await chooseEntryStep(page, "回复记录");
  await page.getByRole("button", { name: "添加一行" }).click();

  const replyRow = page.getByTestId("metric-row");
  await replyRow.getByLabel("发生日期").fill("");
  await replyRow.getByLabel("数量").fill("-1");
  await page.locator("form").evaluate((form) => { (form as HTMLFormElement).noValidate = true; });
  await page.getByRole("button", { name: "保存回复" }).click();

  await expectAssociatedError(replyRow, "来源批次");
  await expectAssociatedError(replyRow, "发生日期");
  await expectAssociatedError(replyRow, "数量");

  await chooseEntryStep(page, "拉群与退群");
  await page.getByRole("button", { name: "添加一行" }).click();
  const groupChangesRow = page.getByTestId("metric-row");
  await groupChangesRow.getByLabel("拉群数量").fill("-1");
  await page.locator("form").evaluate((form) => { (form as HTMLFormElement).noValidate = true; });
  await page.getByRole("button", { name: "保存拉群与退群" }).click();

  await expectAssociatedError(groupChangesRow, "拉群数量");

  await chooseEntryStep(page, "转化与入金");
  await page.getByRole("button", { name: "添加一行" }).click();
  const conversionRow = page.getByTestId("metric-row");
  await conversionRow.getByLabel("注册数量").fill("-1");
  await page.locator("form").evaluate((form) => { (form as HTMLFormElement).noValidate = true; });
  await page.getByRole("button", { name: "保存转化与入金" }).click();

  await expectAssociatedError(conversionRow, "注册数量");

  await conversionRow.getByLabel("注册数量").fill("");
  await conversionRow.getByLabel("总入金（美元）").fill("1.234");
  await page.locator("form").evaluate((form) => { (form as HTMLFormElement).noValidate = true; });
  await page.getByRole("button", { name: "保存转化与入金" }).click();

  await expectAssociatedError(conversionRow, "总入金（美元）");
});
