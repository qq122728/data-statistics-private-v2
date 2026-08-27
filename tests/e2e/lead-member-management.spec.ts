import { expect, test, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./base-url";

async function loginAs(page: Page, username: string, password: string) {
  const response = await page.request.post("/api/auth/login", { data: { username, password } });
  expect(response.status()).toBe(200);
}

function nextLeadMemberMutation(page: Page, method: "POST" | "PATCH") {
  return page.waitForResponse((response) => response.url().endsWith("/api/lead/members") && response.request().method() === method);
}

test("lead manages only a same-group member through the browser and administrators can audit it", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const suffix = Date.now().toString();
  const initialName = `组长验收组员 ${suffix}`;
  const renamedName = `组长验收改名 ${suffix}`;
  const initialUsername = `lead-member-${suffix}`;
  const renamedUsername = `lead-member-renamed-${suffix}`;
  const initialPassword = `initial-password-${suffix}`;
  const replacementPassword = `replacement-password-${suffix}`;

  await loginAs(page, "lead", "demo-password");
  await page.goto("/team-members");
  await expect(page.getByRole("heading", { name: "组员管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "组员管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "管理员中心" })).toHaveCount(0);

  await page.getByRole("button", { name: "添加组员" }).click();
  let dialog = page.getByRole("dialog", { name: "添加组员" });
  await dialog.getByLabel("姓名").fill(initialName);
  await dialog.getByLabel("登录账号").fill(initialUsername);
  await dialog.getByLabel("初始密码").fill(initialPassword);
  const createResponse = nextLeadMemberMutation(page, "POST");
  await dialog.getByRole("button", { name: "添加组员" }).click();
  expect(await (await createResponse).json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(initialName);

  const memberContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const memberPage = await memberContext.newPage();
  await loginAs(memberPage, initialUsername, initialPassword);
  expect((await memberPage.request.get("/api/lead/members")).status()).toBe(403);

  let memberRow = page.getByRole("row").filter({ hasText: initialName });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑组员" });
  await dialog.getByLabel("姓名").fill(renamedName);
  await dialog.getByLabel("登录账号").fill(renamedUsername);
  const editResponse = nextLeadMemberMutation(page, "PATCH");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  expect(await (await editResponse).json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(renamedName);

  memberRow = page.getByRole("row").filter({ hasText: renamedName });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑组员" });
  await dialog.getByRole("button", { name: "重置密码" }).click();
  await dialog.getByLabel("新临时密码").fill(replacementPassword);
  const resetResponse = nextLeadMemberMutation(page, "PATCH");
  await dialog.getByRole("button", { name: "确认重置" }).click();
  expect(await (await resetResponse).json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(`已重置组员“${renamedName}”的密码`);

  expect((await memberPage.request.get("/api/lead/members")).status()).toBe(401);
  expect((await memberPage.request.post("/api/auth/login", { data: { username: renamedUsername, password: initialPassword } })).status()).toBe(401);
  expect((await memberPage.request.post("/api/auth/login", { data: { username: renamedUsername, password: replacementPassword } })).status()).toBe(200);

  memberRow = page.getByRole("row").filter({ hasText: renamedName });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑组员" });
  await dialog.getByRole("button", { name: "停用账号" }).click();
  const disableResponse = nextLeadMemberMutation(page, "PATCH");
  await dialog.getByRole("button", { name: "确认操作" }).click();
  expect(await (await disableResponse).json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(`已停用组员“${renamedName}”`);
  expect((await memberPage.request.post("/api/auth/login", { data: { username: renamedUsername, password: replacementPassword } })).status()).toBe(401);

  memberRow = page.getByRole("row").filter({ hasText: renamedName });
  await memberRow.getByRole("button", { name: "编辑" }).click();
  dialog = page.getByRole("dialog", { name: "编辑组员" });
  await dialog.getByRole("button", { name: "重新启用账号" }).click();
  const enableResponse = nextLeadMemberMutation(page, "PATCH");
  await dialog.getByRole("button", { name: "确认操作" }).click();
  expect(await (await enableResponse).json()).not.toHaveProperty("passwordHash");
  await expect(page.getByRole("status")).toContainText(`已重新启用组员“${renamedName}”`);
  await loginAs(memberPage, renamedUsername, replacementPassword);

  await memberPage.goto("/team-members");
  await expect(memberPage.getByRole("heading", { name: "无权访问" })).toBeVisible();
  await expect(memberPage.getByRole("link", { name: "组员管理" })).toHaveCount(0);
  await expect(memberPage.getByRole("link", { name: "管理员中心" })).toHaveCount(0);
  expect((await memberPage.request.get("/api/lead/members")).status()).toBe(403);

  const adminContext = await browser.newContext({ baseURL: E2E_BASE_URL });
  const adminPage = await adminContext.newPage();
  await loginAs(adminPage, "admin", "demo-password");
  await adminPage.goto("/admin?section=audit");
  await expect(adminPage.getByRole("heading", { name: "操作日志" })).toBeVisible();
  await expect(adminPage.getByRole("link", { name: "组员管理" })).toHaveCount(0);
  await expect(adminPage.getByRole("link", { name: "管理员中心" })).toHaveCount(1);
  await adminPage.getByLabel("操作人").selectOption({ label: "组长" });
  await adminPage.getByRole("button", { name: "筛选日志" }).click();
  const auditRows = adminPage.getByRole("row").filter({ hasText: "组长" });
  await expect(auditRows.filter({ hasText: "添加成员" })).toContainText("变更：名称、登录账号、角色、所属小组");
  await expect(auditRows.filter({ hasText: "更新成员" })).toHaveCount(1);
  await expect(auditRows.filter({ hasText: "重置密码" })).toHaveCount(1);
  await expect(auditRows.filter({ hasText: "修改成员状态" })).toHaveCount(2);

  await adminContext.close();
  await memberContext.close();
});
