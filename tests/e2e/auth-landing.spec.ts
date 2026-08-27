import { expect, test, type Page } from "@playwright/test";

async function loginAsMember(page: Page) {
  let status = 0;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await page.request.post("/api/auth/login", {
        data: { username: "member", password: "demo-password" },
        timeout: 3_000,
      });
      status = response.status();
      if (status === 200) return;
    } catch {
      // Next dev can briefly reset a connection while compiling another route.
    }
    await page.waitForTimeout(250);
  }
  expect(status).toBe(200);
}

test("login page presents the account form inside a styled card", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByTestId("login-card")).toBeVisible();
  await expect(page.getByRole("heading", { name: "数据统计" })).toBeVisible();
  await expect(page.getByLabel("账号")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
});

test("login fields reserve enough space for their leading icons", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByLabel("账号")).toHaveCSS("padding-left", "40px");
  await expect(page.getByLabel("密码")).toHaveCSS("padding-left", "40px");
});

test("a normal form login lands on the workbench", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("账号").fill("member");
  await page.getByLabel("密码").fill("demo-password");

  await Promise.all([
    expect(page).toHaveURL(/\/dashboard$/),
    page.getByRole("button", { name: "登录工作台" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
});

test("an authenticated visit to the root redirects to dashboard", async ({ page }) => {
  await loginAsMember(page);

  await page.goto("/");

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
});
