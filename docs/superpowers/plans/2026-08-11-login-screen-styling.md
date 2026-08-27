# 登录页样式修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将未排版的登录页改为与数据统计后台一致、清晰可用的居中登录卡片。

**Architecture:** 只修改客户端登录页面的 JSX 与 Tailwind 工具类，不接触认证 API、会话或跳转逻辑。通过 Playwright 断言关键视觉结构与既有登录跳转，防止样式修复损坏功能。

**Tech Stack:** Next.js App Router、React、Tailwind CSS、Playwright。

## Global Constraints

- 保留账号、密码、失败提示、登录按钮和既有跳转逻辑。
- 登录页使用浅灰背景、白色居中卡片和蓝色主按钮。
- 桌面和小屏幕下均不得横向溢出。
- 不修改录入、报表、历史记录或管理员页面。

---

### Task 1: 登录卡片与回归验证

**Files:**
- Modify: `src/app/login/page.tsx`
- Modify: `tests/e2e/auth-landing.spec.ts`

**Interfaces:**
- Consumes: `POST /api/auth/login`、`getSafeNextPath()`。
- Produces: 带有 `data-testid="login-card"` 的居中登录卡片；现有成功登录跳转到 `/entry`。

- [ ] **Step 1: 写失败的浏览器测试**

```ts
test("login page presents the account form inside a styled card", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByTestId("login-card")).toBeVisible();
  await expect(page.getByRole("heading", { name: "数据统计" })).toBeVisible();
  await expect(page.getByLabel("账号")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
});
```

- [ ] **Step 2: 验证测试失败**

Run: `CI=1 npx playwright test tests/e2e/auth-landing.spec.ts --reporter=line`

Expected: FAIL，提示找不到 `login-card`。

- [ ] **Step 3: 实现最小样式结构**

在 `src/app/login/page.tsx` 中：

```tsx
<main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
  <section data-testid="login-card" className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
    {/* 保留现有账号、密码、错误提示与表单提交逻辑 */}
  </section>
</main>
```

为标签、输入框、错误提示和按钮添加与后台一致的间距、边框、焦点、红色错误与蓝色主操作样式。

- [ ] **Step 4: 验证样式与登录流程**

Run: `CI=1 npx playwright test tests/e2e/auth-landing.spec.ts --reporter=line`

Expected: PASS，包含新卡片断言和原有两条登录跳转断言。

- [ ] **Step 5: 提交**

```bash
git add src/app/login/page.tsx tests/e2e/auth-landing.spec.ts
git commit -m "fix: style login screen"
```
