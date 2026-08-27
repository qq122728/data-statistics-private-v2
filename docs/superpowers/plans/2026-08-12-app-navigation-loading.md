# 全站页面切换骨架屏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为所有登录后的侧边栏页面提供统一、即时且可访问的内容区加载骨架。

**Architecture:** 在 Next.js `src/app/(app)` 路由组中增加公共 `loading.tsx`，让 App Router 在服务端页面等待期间自动替换 `children`，而现有公共布局、侧边栏和顶部栏保持挂载。骨架组件只负责加载呈现，样式写入现有全局样式表，不持有路由状态、不修改业务查询。

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript、CSS、Vitest、React DOM Server

## Global Constraints

- 所有登录后页面共用一套骨架，登录页不受影响。
- 不修改数据库查询、统计口径、权限、登录状态或路由地址。
- 不引入新依赖，不使用自定义计时器或全屏遮罩。
- 用户启用减少动态效果时停止骨架动画。

---

### Task 1: 公共页面加载骨架

**Files:**
- Create: `src/app/(app)/loading.tsx`
- Modify: `src/app/globals.css`
- Create: `tests/unit/app-loading.test.ts`

**Interfaces:**
- Consumes: Next.js App Router 对路由组 `loading.tsx` 默认导出的约定。
- Produces: `AppPageLoading(): JSX.Element` 默认导出；页面根节点提供 `role="status"`、`aria-live="polite"`、`aria-busy="true"` 和屏幕阅读器文案“正在加载页面”。

- [ ] **Step 1: 写失败测试**

```tsx
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AppPageLoading from "../../src/app/(app)/loading";

describe("application page loading state", () => {
  it("renders an accessible content skeleton without fake business values", () => {
    const html = renderToStaticMarkup(createElement(AppPageLoading));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在加载页面");
    expect((html.match(/data-skeleton=/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(html).not.toMatch(/>\s*(?:¥|\d+(?:\.\d+)?%?)\s*</);
  });
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- --run tests/unit/app-loading.test.ts`

Expected: FAIL，因为 `src/app/(app)/loading.tsx` 尚不存在。

- [ ] **Step 3: 写最小实现**

在 `loading.tsx` 中默认导出公共内容骨架：一个标题块、一个筛选卡片、四个指标卡片和一个表格卡片。所有视觉占位块使用 `data-skeleton` 和 `.page-loading-skeleton`，只保留屏幕阅读器加载文案，不放入数字或业务文字。

在 `globals.css` 中增加低幅度透明度动画，并增加：

```css
@media (prefers-reduced-motion: reduce) {
  .page-loading-skeleton { animation: none; }
}
```

- [ ] **Step 4: 运行聚焦测试并确认 GREEN**

Run: `npm test -- --run tests/unit/app-loading.test.ts tests/unit/navigation.test.ts`

Expected: 相关测试全部 PASS。

- [ ] **Step 5: 浏览器验证真实导航**

在已登录的本地页面依次点击团队表现、渠道分析、异常榜单和批次追踪。确认切换期间侧边栏与顶部栏保持显示，最终页面标题正确，浏览器控制台无新增错误。

- [ ] **Step 6: 完整验证**

Run: `npm test -- --run`

Expected: 全部单元测试 PASS。

Run: `npm run build`

Expected: 生产构建退出码为 0。

Run: `git diff --check`

Expected: 无空白错误。

- [ ] **Step 7: 提交实现**

```bash
git add 'src/app/(app)/loading.tsx' src/app/globals.css tests/unit/app-loading.test.ts
git commit -m "feat: add app navigation loading skeleton"
```

