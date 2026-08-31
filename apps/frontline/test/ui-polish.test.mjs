import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("新版工作区统一加载 UI 收口样式", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/ui-polish.css", root), "utf8"),
  ]);
  assert.match(page, /import "\.\/ui-polish\.css"/);
  assert.match(css, /focus-visible/);
  assert.match(css, /grid-template-columns: 104px minmax\(0, 1fr\)/);
  assert.match(css, /fresh-sidebar nav button span/);
  assert.match(css, /position: sticky/);
});

test("部门管理员前端严格使用先建组再开组长账号", async () => {
  const source = await readFile(new URL("components/DepartmentWorkspace.tsx", root), "utf8");
  assert.doesNotMatch(source, /withLead|leadAccount|同时开设首任组长账号|一次建好小组和首任组长账号/);
  assert.match(source, /先开设小组，再为已存在的小组单独开设组长账号/);
});

test("管理端个人汇总明确采用最初来源成员归属", async () => {
  const files = await Promise.all([
    "components/GroupChannelAnalysis.tsx",
    "components/DepartmentWorkspace.tsx",
    "components/CompanyWorkspace.tsx",
    "components/HeadquartersWorkspace.tsx",
    "components/ResourceWorkspace.tsx",
  ].map((path) => readFile(new URL(path, root), "utf8")));
  assert.match(files[0], /每名组员只显示一行/);
  assert.match(files[1], /个人归属数据汇总（每人一行）/);
  assert.match(files[2], /按归属个人/);
  assert.match(files[3], /个人归属汇总（每人一行）/);
  assert.match(files[4], /后续数据归最初来源组员/);
});

test("五类管理账号共用统一工作台外壳", async () => {
  const paths = [
    "components/CompanyWorkspace.tsx",
    "components/HeadquartersWorkspace.tsx",
    "components/DepartmentWorkspace.tsx",
    "components/ResourceWorkspace.tsx",
    "components/SupportNotificationWorkspace.tsx",
  ];
  const [shell, css, ...workspaces] = await Promise.all([
    readFile(new URL("components/WorkspaceShell.tsx", root), "utf8"),
    readFile(new URL("components/WorkspaceShell.module.css", root), "utf8"),
    ...paths.map((path) => readFile(new URL(path, root), "utf8")),
  ]);
  for (const source of workspaces) assert.match(source, /<WorkspaceShell/);
  assert.match(shell, /aria-label=.*功能导航/);
  assert.match(shell, /aria-current=\{active \? "page"/);
  assert.match(css, /grid-template-columns: 220px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
});

test("窄屏管理端保留可读导航，总公司二级入口都有图标", async () => {
  const [css, headquarters] = await Promise.all([
    readFile(new URL("components/WorkspaceShell.module.css", root), "utf8"),
    readFile(new URL("components/HeadquartersWorkspace.tsx", root), "utf8"),
  ]);
  assert.doesNotMatch(css, /\.navButton span,\s*\.navGroup > small/);
  assert.match(css, /grid-template-columns: 96px minmax\(0, 1fr\)/);
  for (const icon of ["organization", "settings", "accounts", "transfer", "devices", "channel"]) {
    assert.match(headquarters, new RegExp(`icon="${icon}"`));
  }
});

test("资源部使用净业绩口径且不显示审核入口", async () => {
  const resource = await readFile(new URL("components/ResourceWorkspace.tsx", root), "utf8");
  assert.match(resource, /\["净业绩", money/);
  assert.doesNotMatch(resource, /净入金|PendingTable|ReviewTable|待确认每日数据|待渠道对账|\/api\/resource\/channel-review/);
});
