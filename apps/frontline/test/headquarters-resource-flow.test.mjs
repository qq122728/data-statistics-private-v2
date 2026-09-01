import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("总公司按先建渠道再开资源账号的顺序展示真实入口", async () => {
  const source = await readFile(new URL("components/HeadquartersWorkspace.tsx", root), "utf8");
  assert.match(source, /第 1 步先建立渠道/);
  assert.match(source, /\/api\/admin\/channels/);
  assert.match(source, /资源部管理员/);
  assert.match(source, /\/api\/org\/resource-managers/);
  assert.match(source, /resourceChannelIds/);
  assert.match(source, /一个资源部账号只能选择一种渠道类型|渠道分为投流、短信和底料/);
  assert.match(source, /<option value="REBATE">底料<\/option>/);
});

test("总公司首页按部门和小组纵向排列、按渠道横向汇总", async () => {
  const source = await readFile(new URL("components/HeadquartersWorkspace.tsx", root), "utf8");
  for (const text of ["部门、小组与渠道横向汇总", "部门 / 小组", "渠道汇总", "小组合计", "departmentDivider", "departmentTotal", "ChannelSummaryCell"]) assert.ok(source.includes(text));
  assert.match(source, /report\?\.groupChannels/);
});

test("资源部报表包含小组组员筛选、完整指标比率和底部合计，但没有审核入口", async () => {
  const source = await readFile(new URL("components/ResourceWorkspace.tsx", root), "utf8");
  for (const text of ["小组", "组员", "人工无效", "回复率", "进群率", "异常退群率", "注册率", "开单率", "合计"]) assert.match(source, new RegExp(text));
  assert.doesNotMatch(source, /数据审核|待审核|\/api\/resource\/daily-stats/);
});
