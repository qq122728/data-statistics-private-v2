import { expect, test, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";

const ADMIN_PASSWORD = "Admin@56790";

async function loginAs(page: Page, username: string, password: string) {
  const response = await page.request.post("/api/auth/login", {
    data: { username: username === "admin@example.com" ? "admin" : username, password },
  });
  expect(response.status()).toBe(200);
}

async function loginAsAdminByApi(page: Page) {
  await loginAs(page, "admin", ADMIN_PASSWORD);
}

const highRiskCredentials = (highRiskReason: string) => ({
  highRiskReason,
  currentPassword: ADMIN_PASSWORD,
});

async function fillHighRiskConfirmation(
  page: Page,
  title: string,
  reason: string,
) {
  const confirmation = page.getByRole("dialog", { name: title });
  await expect(confirmation).toBeVisible();
  await confirmation.getByLabel("操作原因").fill(reason);
  await confirmation.getByLabel("当前管理员密码").fill(ADMIN_PASSWORD);
  return confirmation;
}

function nextMemberPatch(page: Page) {
  return page.waitForResponse((response) => response.url().endsWith("/api/admin/users") && response.request().method() === "PATCH");
}

function businessDate(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

test("admin manages the full team lifecycle through section pages and drawers", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString();
  const groupName = `管理测试小组 ${suffix}`;
  const renamedGroup = `管理测试小组新名 ${suffix}`;
  const channelName = `管理测试渠道 ${suffix}`;
  const renamedChannel = `管理测试渠道新名 ${suffix}`;
  const memberName = `管理测试成员 ${suffix}`;
  const renamedMember = `管理测试组长 ${suffix}`;
  const username = `managed-${suffix}`;
  const renamedUsername = `managed-lead-${suffix}`;
  const newPassword = `new-password-${suffix}`;
  const adminPassword = `admin-password-${suffix}`;
  const appName = `团队数据 ${suffix}`;

  await loginAsAdminByApi(page);

  await page.goto("/admin?section=groups");
  await expect(page.getByRole("heading", { name: "小组管理" })).toBeVisible();
  await page.getByRole("button", { name: "添加小组" }).click();
  let dialog = page.getByRole("dialog", { name: "添加小组" });
  await dialog.getByLabel("小组名称").fill(groupName);
  await dialog.getByRole("button", { name: "添加小组" }).click();
  await expect(page.getByRole("status")).toContainText(groupName);

  let groupRow = page.getByRole("row").filter({ hasText: groupName });
  await groupRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑小组" });
  await dialog.getByLabel("小组名称").fill(renamedGroup);
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("status")).toContainText(renamedGroup);

  groupRow = page.getByRole("row").filter({ hasText: renamedGroup });
  await groupRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑小组" });
  await dialog.getByRole("button", { name: "停用小组" }).click();
  const disableGroupConfirmation = await fillHighRiskConfirmation(
    page,
    "确认停用小组",
    "管理测试完成后停用该小组",
  );
  const disableGroupResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/groups") && response.request().method() === "PATCH");
  await disableGroupConfirmation.getByRole("button", { name: "确认停用小组" }).click();
  expect((await disableGroupResponse).request().postDataJSON()).toMatchObject(highRiskCredentials("管理测试完成后停用该小组"));
  await expect(page.getByRole("status")).toContainText(`已停用小组“${renamedGroup}”`);
  groupRow = page.getByRole("row").filter({ hasText: renamedGroup });
  await expect(groupRow).toContainText("停用");

  await groupRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑小组" });
  await dialog.getByRole("button", { name: "重新启用小组" }).click();
  await dialog.getByRole("button", { name: "确认操作" }).click();
  await expect(page.getByRole("status")).toContainText(`已重新启用小组“${renamedGroup}”`);

  await page.getByRole("link", { name: "渠道管理" }).click();
  await expect(page).toHaveURL(/section=channels/);
  await page.getByRole("button", { name: "添加渠道" }).click();
  dialog = page.getByRole("dialog", { name: "添加渠道" });
  await dialog.getByLabel("渠道名称").fill(channelName);
  await dialog.getByLabel("所属小组").selectOption({ label: renamedGroup });
  await dialog.getByRole("button", { name: "添加渠道" }).click();
  await expect(page.getByRole("status")).toContainText(channelName);

  let channelRow = page.getByRole("row").filter({ hasText: channelName });
  await channelRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑渠道" });
  await dialog.getByLabel("渠道名称").fill(renamedChannel);
  await dialog.getByRole("button", { name: "付费粉" }).click();
  await dialog.getByLabel("有效粉单价（美元）").fill("50.00");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("status")).toContainText(renamedChannel);

  channelRow = page.getByRole("row").filter({ hasText: renamedChannel });
  await expect(channelRow).toContainText("$50.00 / 有效粉");
  await channelRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑渠道" });
  await dialog.getByRole("button", { name: "停用渠道" }).click();
  await dialog.getByRole("button", { name: "确认操作" }).click();
  await expect(page.getByRole("status")).toContainText(`已停用渠道“${renamedChannel}”`);

  channelRow = page.getByRole("row").filter({ hasText: renamedChannel });
  await expect(channelRow).toContainText("停用");
  await channelRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑渠道" });
  await dialog.getByRole("button", { name: "重新启用渠道" }).click();
  await dialog.getByRole("button", { name: "确认操作" }).click();
  await expect(page.getByRole("status")).toContainText(`已重新启用渠道“${renamedChannel}”`);

  await page.getByRole("link", { name: "成员管理" }).click();
  await expect(page).toHaveURL(/section=members/);
  await page.getByRole("button", { name: "添加成员" }).click();
  dialog = page.getByRole("dialog", { name: "添加成员" });
  await dialog.getByLabel("姓名").fill(memberName);
  await dialog.getByLabel("登录账号").fill(username);
  await dialog.getByLabel("初始密码").fill("member-password");
  await dialog.getByLabel("角色").selectOption("RECEPTION");
  await dialog.getByLabel("所属小组").selectOption("group-a");
  const createMemberResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/users") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "添加成员" }).click();
  expect(await (await createMemberResponse).json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(memberName);

  let memberRow = page.getByRole("row").filter({ hasText: memberName });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑成员" });
  await dialog.getByLabel("姓名").fill(renamedMember);
  await dialog.getByLabel("登录账号").fill(renamedUsername);
  await dialog.getByLabel("角色").selectOption("LEAD");
  await dialog.getByLabel("所属小组").selectOption("group-b");
  await dialog.getByLabel("入职日期").fill("2026-08-01");
  await dialog.getByLabel("手动阶段").selectOption("OBSERVATION");
  await dialog.getByLabel("覆盖原因").fill("延长观察以补足样本");
  await expect(dialog.getByText("自动阶段预览")).toBeVisible();
  const editMemberResponse = nextMemberPatch(page);
  await dialog.getByRole("button", { name: "保存修改" }).click();
  expect(await (await editMemberResponse).json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(renamedMember);
  memberRow = page.getByRole("row").filter({ hasText: renamedMember });
  await expect(memberRow).toContainText("组长");
  await expect(memberRow).toContainText("二组");
  await expect(memberRow).toContainText("观察");

  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑成员" });
  await dialog.getByRole("button", { name: "重置密码" }).click();
  await dialog.getByLabel("新临时密码").fill(newPassword);
  const resetPasswordResponse = nextMemberPatch(page);
  await dialog.getByRole("button", { name: "确认重置" }).click();
  expect(await (await resetPasswordResponse).json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(`已重置成员“${renamedMember}”的密码`);

  const loginContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const loginPage = await loginContext.newPage();
  expect((await loginPage.request.post("/api/auth/login", { data: { username: renamedUsername, password: "member-password" } })).status()).toBe(401);
  expect((await loginPage.request.post("/api/auth/login", { data: { username: renamedUsername, password: newPassword } })).status()).toBe(200);
  await loginContext.close();

  memberRow = page.getByRole("row").filter({ hasText: renamedMember });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑成员" });
  await dialog.getByRole("button", { name: "停用账号" }).click();
  const disableMemberResponse = nextMemberPatch(page);
  await dialog.getByRole("button", { name: "确认操作" }).click();
  expect(await (await disableMemberResponse).json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(`已停用成员“${renamedMember}”`);
  memberRow = page.getByRole("row").filter({ hasText: renamedMember });
  await expect(memberRow).toContainText("停用");
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑成员" });
  await dialog.getByRole("button", { name: "重新启用账号" }).click();
  const enableMemberResponse = nextMemberPatch(page);
  await dialog.getByRole("button", { name: "确认操作" }).click();
  expect(await (await enableMemberResponse).json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(`已重新启用成员“${renamedMember}”`);

  memberRow = page.getByRole("row").filter({ hasText: renamedMember });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑成员" });
  await dialog.getByLabel("角色").selectOption("ADMIN");
  await dialog.getByLabel("所属小组").selectOption("");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  const promotionConfirmation = await fillHighRiskConfirmation(
    page,
    "确认授予管理员权限",
    "业务负责人批准授予管理权限",
  );
  await expect(promotionConfirmation).toContainText("全系统管理权限");
  const promotionResponse = nextMemberPatch(page);
  await promotionConfirmation.getByRole("button", { name: "确认授权并保存" }).click();
  expect((await promotionResponse).request().postDataJSON()).toMatchObject(highRiskCredentials("业务负责人批准授予管理权限"));
  await expect(page.getByRole("status")).toContainText(`已保存成员“${renamedMember}”的修改`);

  memberRow = page.getByRole("row").filter({ hasText: renamedMember });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑成员" });
  await dialog.getByRole("button", { name: "重置密码" }).click();
  await dialog.getByLabel("新临时密码").fill(adminPassword);
  await dialog.getByRole("button", { name: "确认重置" }).click();
  const adminPasswordConfirmation = await fillHighRiskConfirmation(
    page,
    "确认重置管理员密码",
    "管理员账号交接后重置密码",
  );
  await expect(adminPasswordConfirmation).toContainText("现有登录会全部退出");
  const adminPasswordResponse = nextMemberPatch(page);
  await adminPasswordConfirmation.getByRole("button", { name: "确认重置管理员密码" }).click();
  expect((await adminPasswordResponse).request().postDataJSON()).toMatchObject({
    password: adminPassword,
    ...highRiskCredentials("管理员账号交接后重置密码"),
  });
  await expect(page.getByRole("status")).toContainText(`已重置成员“${renamedMember}”的密码`);

  memberRow = page.getByRole("row").filter({ hasText: renamedMember });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑成员" });
  await dialog.getByRole("button", { name: "停用账号" }).click();
  const disableAdminConfirmation = await fillHighRiskConfirmation(
    page,
    "确认停用管理员账号",
    "管理员暂时离岗停用账号",
  );
  await expect(disableAdminConfirmation).toContainText("现有登录会全部退出");
  const disableAdminResponse = nextMemberPatch(page);
  await disableAdminConfirmation.getByRole("button", { name: "确认停用管理员账号" }).click();
  expect((await disableAdminResponse).request().postDataJSON()).toMatchObject({
    active: false,
    ...highRiskCredentials("管理员暂时离岗停用账号"),
  });
  await expect(page.getByRole("status")).toContainText(`已停用成员“${renamedMember}”`);

  memberRow = page.getByRole("row").filter({ hasText: renamedMember });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑成员" });
  await dialog.getByRole("button", { name: "重新启用账号" }).click();
  const reactivateAdminConfirmation = await fillHighRiskConfirmation(
    page,
    "确认重新启用管理员账号",
    "管理员返回岗位恢复账号",
  );
  await expect(reactivateAdminConfirmation).toContainText("恢复全系统管理权限");
  const reactivateAdminResponse = nextMemberPatch(page);
  await reactivateAdminConfirmation.getByRole("button", { name: "确认重新启用管理员账号" }).click();
  expect((await reactivateAdminResponse).request().postDataJSON()).toMatchObject({
    active: true,
    ...highRiskCredentials("管理员返回岗位恢复账号"),
  });
  await expect(page.getByRole("status")).toContainText(`已重新启用成员“${renamedMember}”`);

  memberRow = page.getByRole("row").filter({ hasText: renamedMember });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑成员" });
  await dialog.getByLabel("角色").selectOption("LEAD");
  await dialog.getByLabel("所属小组").selectOption({ label: renamedGroup });
  await dialog.getByRole("button", { name: "保存修改" }).click();
  const revokeAdminConfirmation = await fillHighRiskConfirmation(
    page,
    "确认撤销管理员权限",
    "管理员转岗为小组负责人",
  );
  await expect(revokeAdminConfirmation).toContainText("失去全系统管理权限");
  const revokeAdminResponse = nextMemberPatch(page);
  await revokeAdminConfirmation.getByRole("button", { name: "确认撤销管理员权限" }).click();
  expect((await revokeAdminResponse).request().postDataJSON()).toMatchObject({
    role: "LEAD",
    ...highRiskCredentials("管理员转岗为小组负责人"),
  });
  await expect(page.getByRole("status")).toContainText(`已保存成员“${renamedMember}”的修改`);

  await page.getByRole("link", { name: "系统设置" }).click();
  const originalSettings = {
    appName: await page.getByLabel("系统显示名称").inputValue(),
    timezone: await page.getByLabel("业务时区").inputValue(),
    defaultReportMode: await page.getByLabel("默认报表模式").inputValue(),
    allowMemberChannelCreation: false,
  };
  await page.getByLabel("系统显示名称").fill(appName);
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByRole("status")).toHaveText("系统设置已保存并生效");
  await page.reload();
  await expect(page.getByLabel("系统显示名称")).toHaveValue(appName);
  await expect(page.locator(".app-sidebar .app-brand")).toHaveText(appName);

  await page.getByRole("link", { name: "预警规则" }).click();
  await expect(page.getByRole("heading", { name: "预警规则" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "员工阶段" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "连续偏低" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "样本门槛" })).toBeVisible();
  const originalRiskSettingsResponse = await page.request.get("/api/admin/risk-settings");
  const originalRiskSettings = await originalRiskSettingsResponse.json();
  await page.getByLabel("辅导效率阈值").fill("0.81");
  await page.getByLabel("辅导连续天数").fill("8");
  await expect(page.getByText("连续 8 个合格评价日低于 0.81 才建议辅导")).toBeVisible();
  await page.getByRole("button", { name: "保存预警规则" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await expect(page.getByRole("status")).toContainText("操作日志");
  await page.reload();
  await expect(page.getByLabel("辅导效率阈值")).toHaveValue("0.81");
  await expect(page.getByLabel("辅导连续天数")).toHaveValue("8");
  expect((await page.request.patch("/api/admin/risk-settings", { data: originalRiskSettings })).status()).toBe(200);

  await page.getByRole("link", { name: "操作日志" }).click();
  await page.getByLabel("开始日期").fill(businessDate("Asia/Shanghai"));
  await page.getByLabel("结束日期").fill(businessDate("Asia/Shanghai"));
  await page.getByLabel("操作人").selectOption({ label: "管理员" });
  await page.getByLabel("操作类型").selectOption({ label: "修改系统设置" });
  await page.getByRole("button", { name: "筛选日志" }).click();
  const auditRow = page.getByRole("row").filter({ hasText: "修改系统设置" });
  await expect(auditRow).toContainText("管理员");
  await expect(auditRow).toContainText("系统设置");
  await expect(auditRow).toContainText("变更：系统名称");

  await page.getByLabel("操作类型").selectOption({ label: "更新员工阶段" });
  await page.getByRole("button", { name: "筛选日志" }).click();
  const employmentAuditRow = page.getByRole("row").filter({ hasText: "更新员工阶段" });
  await expect(employmentAuditRow).toContainText(renamedMember);
  await expect(employmentAuditRow).toContainText("入职日期");
  await expect(employmentAuditRow).toContainText("手动阶段");
  await expect(employmentAuditRow).toContainText("覆盖原因");

  const restoreSettings = await page.request.patch("/api/admin/settings", { data: originalSettings });
  expect(restoreSettings.status()).toBe(200);

  const memberContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const memberPage = await memberContext.newPage();
  await loginAs(memberPage, "member", "demo-password");
  await memberPage.goto("/admin");
  await expect(memberPage.getByRole("heading", { name: "无权访问" })).toBeVisible();
  const denied = await memberPage.request.post("/api/admin/groups", { data: { name: `越权小组 ${suffix}` } });
  expect(denied.status()).toBe(403);
  await memberContext.close();
});

test("lead cannot see or forge administrator price and employment controls", async ({ page }) => {
  await loginAs(page, "lead", "demo-password");
  await page.goto("/team-members");
  await expect(page.getByText("手动阶段")).toHaveCount(0);
  await expect(page.getByText("有效粉单价")).toHaveCount(0);

  const priceResponse = await page.request.patch("/api/admin/channels", {
    data: { id: "channel-1", groupId: "group-a", effectiveFanPriceCents: 5_000 },
  });
  expect(priceResponse.status()).toBe(403);
  const stageResponse = await page.request.patch("/api/admin/users", {
    data: { id: "member-1", hireDate: "2026-08-01", stageOverride: "FORMAL", stageOverrideReason: "越权指定正式" },
  });
  expect(stageResponse.status()).toBe(403);
  expect((await page.request.get("/api/admin/risk-settings")).status()).toBe(403);
  expect((await page.request.patch("/api/admin/risk-settings", { data: { trainingDays: 1 } })).status()).toBe(403);
  expect((await page.request.post("/api/admin/risk-decisions", {
    data: { memberId: "member-1", level: "LIMIT_WATCH", evidenceThrough: "2026-08-14", reason: "越权人工确认" },
  })).status()).toBe(403);
});

test("administrator can clear a fixed channel price by changing the channel to free", async ({ page }) => {
  await loginAsAdminByApi(page);
  const suffix = Date.now().toString();
  const channelName = `转免费渠道 ${suffix}`;
  const createdResponse = await page.request.post("/api/admin/channels", { data: { name: channelName, groupId: "group-a" } });
  expect(createdResponse.status()).toBe(201);

  await page.goto("/admin?section=channels");
  let channelRow = page.getByRole("row").filter({ hasText: channelName });
  await channelRow.getByRole("button", { name: "编辑" }).click();
  let dialog = page.getByRole("dialog", { name: "编辑渠道" });
  await dialog.getByRole("button", { name: "付费粉" }).click();
  await dialog.getByLabel("有效粉单价（美元）").fill("50.00");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  channelRow = page.getByRole("row").filter({ hasText: channelName });
  await expect(channelRow).toContainText("$50.00 / 有效粉");

  await channelRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑渠道" });
  await dialog.getByRole("button", { name: "免费粉" }).click();
  await dialog.getByRole("button", { name: "保存修改" }).click();
  const clearConfirmation = await fillHighRiskConfirmation(
    page,
    "确认清除渠道单价",
    "渠道已经转为免费来源",
  );
  await expect(clearConfirmation).toContainText("获客成本会按 $0 计算");
  const clearResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/channels") && response.request().method() === "PATCH");
  await clearConfirmation.getByRole("button", { name: "确认清除单价" }).click();
  const response = await clearResponse;
  expect(response.request().postDataJSON()).toMatchObject({ name: channelName, fanCostMode: "FREE", effectiveFanPriceCents: 0, ...highRiskCredentials("渠道已经转为免费来源") });
  expect(await response.json()).toMatchObject({ fanCostMode: "FREE", effectiveFanPriceCents: 0 });
  channelRow = page.getByRole("row").filter({ hasText: channelName });
  await expect(channelRow).toContainText("免费粉");
  await expect(channelRow).toContainText("$0.00");
});

test("creating an administrator requires an accessible high-risk confirmation", async ({ page }) => {
  await loginAsAdminByApi(page);
  const suffix = Date.now().toString();
  const name = `新增管理员 ${suffix}`;
  const username = `new-admin-${suffix}`;
  await page.goto("/admin?section=members");
  await page.getByRole("button", { name: "添加成员" }).click();
  const drawer = page.getByRole("dialog", { name: "添加成员" });
  await drawer.getByLabel("姓名").fill(name);
  await drawer.getByLabel("登录账号").fill(username);
  await drawer.getByLabel("初始密码").fill("temporary-password");
  await drawer.getByLabel("角色").selectOption("ADMIN");
  await drawer.getByLabel("所属小组").selectOption("");
  const submit = drawer.getByRole("button", { name: "添加成员" });
  await submit.click();

  let confirmation = page.getByRole("dialog", { name: "确认创建管理员账号" });
  await expect(confirmation).toContainText("全系统管理权限");
  await expect(confirmation.getByLabel("操作原因")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeHidden();
  await expect(submit).toBeFocused();

  await submit.click();
  confirmation = await fillHighRiskConfirmation(
    page,
    "确认创建管理员账号",
    "新增系统维护管理员账号",
  );
  const createResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/users") && response.request().method() === "POST");
  await confirmation.getByRole("button", { name: "确认创建管理员" }).click();
  const response = await createResponse;
  expect(response.request().postDataJSON()).toMatchObject({
    role: "ADMIN",
    ...highRiskCredentials("新增系统维护管理员账号"),
  });
  expect(await response.json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(`已添加成员“${name}”`);
});

test("disabling a department requires reason and current administrator password", async ({ page }) => {
  await loginAsAdminByApi(page);
  const departmentName = `待停用空部门 ${Date.now()}`;
  await page.goto("/admin?section=departments");
  await page.getByLabel("部门名称").fill(departmentName);
  await page.getByRole("button", { name: "添加部门" }).click();
  let row = page.getByRole("row").filter({ hasText: departmentName });
  await expect(row).toContainText("启用");
  await row.getByRole("button", { name: "停用" }).click();
  const confirmation = await fillHighRiskConfirmation(
    page,
    "确认停用部门",
    "该空部门已不再投入使用",
  );
  await expect(confirmation).toContainText("历史数据不会被删除");
  const disableResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/departments") && response.request().method() === "PATCH");
  await confirmation.getByRole("button", { name: "确认停用部门" }).click();
  expect((await disableResponse).request().postDataJSON()).toMatchObject(highRiskCredentials("该空部门已不再投入使用"));
  row = page.getByRole("row").filter({ hasText: departmentName });
  await expect(row).toContainText("停用");
});

test("admin page does not serialize password hashes into the client payload", async ({ page }) => {
  await loginAsAdminByApi(page);
  const adminDocument = await page.request.get("/admin");
  expect(await adminDocument.text()).not.toContain("passwordHash");
});

test("member creation rejects an ungrouped account", async ({ page }) => {
  await loginAsAdminByApi(page);
  const suffix = Date.now().toString();
  const memberResponse = await page.request.post("/api/admin/users", {
    data: { username: `ungrouped-${suffix}`, name: "未分组成员", password: "demo-password", role: "RECEPTION", groupId: null },
  });
  expect(memberResponse.status()).toBe(400);
});

test("lead creation rejects an inactive group", async ({ page }) => {
  await loginAsAdminByApi(page);
  const suffix = Date.now().toString();
  const inactiveGroupResponse = await page.request.post("/api/admin/groups", { data: { name: `已停用成员组 ${suffix}` } });
  const inactiveGroup = await inactiveGroupResponse.json();
  await page.request.patch("/api/admin/groups", { data: { id: inactiveGroup.id, active: false, ...highRiskCredentials("准备停用组测试") } });
  const leadResponse = await page.request.post("/api/admin/users", {
    data: { username: `inactive-lead-${suffix}`, name: "停用组组长", password: "demo-password", role: "LEAD", groupId: inactiveGroup.id },
  });
  expect(leadResponse.status()).toBe(400);
});

test("member updates cannot remove an active group", async ({ page }) => {
  await loginAsAdminByApi(page);
  const suffix = Date.now().toString();
  const createMemberResponse = await page.request.post("/api/admin/users", {
    data: { username: `grouped-${suffix}`, name: "有分组成员", password: "demo-password", role: "RECEPTION", groupId: "group-a" },
  });
  const member = await createMemberResponse.json();
  const ungroupedResponse = await page.request.patch("/api/admin/users", { data: { id: member.id, groupId: null } });
  expect(ungroupedResponse.status()).toBe(400);
});

test("member updates cannot move to an inactive group", async ({ page }) => {
  await loginAsAdminByApi(page);
  const suffix = Date.now().toString();
  const createMemberResponse = await page.request.post("/api/admin/users", {
    data: { username: `inactive-move-${suffix}`, name: "待转组成员", password: "demo-password", role: "RECEPTION", groupId: "group-a" },
  });
  const member = await createMemberResponse.json();
  const inactiveGroupResponse = await page.request.post("/api/admin/groups", { data: { name: `不可转入组 ${suffix}` } });
  const inactiveGroup = await inactiveGroupResponse.json();
  await page.request.patch("/api/admin/groups", { data: { id: inactiveGroup.id, active: false, ...highRiskCredentials("准备转入停用组测试") } });
  const inactiveResponse = await page.request.patch("/api/admin/users", { data: { id: member.id, groupId: inactiveGroup.id } });
  expect(inactiveResponse.status()).toBe(400);
});

test("changing an ungrouped admin to lead requires an active group", async ({ page }) => {
  await loginAsAdminByApi(page);
  const suffix = Date.now().toString();
  const createAdminResponse = await page.request.post("/api/admin/users", {
    data: { username: `admin-role-${suffix}`, name: "待转角色管理员", password: "demo-password", role: "ADMIN", groupId: null, ...highRiskCredentials("准备管理员转岗边界测试") },
  });
  const admin = await createAdminResponse.json();
  const response = await page.request.patch("/api/admin/users", { data: { id: admin.id, role: "LEAD" } });
  expect(response.status()).toBe(400);
});

test("member drawers exclude inactive groups while administrators may stay ungrouped", async ({ page }) => {
  await loginAsAdminByApi(page);
  const suffix = Date.now().toString();
  const inactiveGroupName = `界面停用组 ${suffix}`;
  const groupResponse = await page.request.post("/api/admin/groups", { data: { name: inactiveGroupName } });
  const group = await groupResponse.json();
  await page.request.patch("/api/admin/groups", { data: { id: group.id, active: false, ...highRiskCredentials("准备成员抽屉停用组选项测试") } });
  await page.goto("/admin?section=members");

  await page.getByRole("button", { name: "添加成员" }).click();
  let dialog = page.getByRole("dialog", { name: "添加成员" });
  const createRole = dialog.getByLabel("角色");
  const createGroup = dialog.getByLabel("所属小组");
  await expect(createGroup.getByRole("option", { name: "未分组" })).toHaveCount(0);
  await expect(createGroup.getByRole("option", { name: inactiveGroupName })).toHaveCount(0);
  await createRole.selectOption("ADMIN");
  await expect(createGroup.getByRole("option", { name: "未分组" })).toHaveCount(1);
  await dialog.getByRole("button", { name: "关闭" }).click();

  const seededMember = page.getByRole("row").filter({ hasText: "组员" });
  await seededMember.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑成员" });
  const memberGroup = dialog.getByLabel("所属小组");
  await expect(memberGroup.getByRole("option", { name: "未分组" })).toHaveCount(0);
  await expect(memberGroup.getByRole("option", { name: inactiveGroupName })).toHaveCount(0);
});
