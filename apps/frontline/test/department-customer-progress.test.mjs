import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/DepartmentCustomerProgress.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/DepartmentCustomerProgress.module.css", import.meta.url), "utf8");

test("搜索、渠道和刷新共用当前筛选条件", () => {
  assert.match(component, /if \(query\) params\.set\("q", query\)/);
  assert.match(component, /if \(channel\) params\.set\("channel", channel\)/);
  assert.match(component, /\[groupId, page, query, channel, reloadKey\]/);
  assert.match(component, /setReloadKey\(\(value\) => value \+ 1\)/);
});

test("清除恢复全部客户并回到第一页", () => {
  assert.match(component, /setDraftQuery\(""\); setQuery\(""\); setPage\(1\)/);
});

test("加载期间禁用重复搜索、清除、刷新和筛选", () => {
  assert.match(component, /disabled=\{!groupId \|\| loading\}/);
  assert.match(component, /className=\{styles\.secondary\} disabled=\{loading\}/);
  assert.match(component, /aria-label="查看小组" disabled=\{loading\}/);
  assert.match(component, /aria-label="来源渠道" disabled=\{loading\}/);
});

test("搜索按钮与输入框底边对齐，窄屏时搜索框单独换行", () => {
  assert.match(css, /\.search\{[^}]*display:grid;[^}]*align-items:end/);
  assert.match(css, /@media\(max-width:560px\)[^{]*\{[^]*\.search>\.field\{grid-column:1\/-1\}/);
  assert.match(css, /\.toolbar>\.secondary\{width:100%\}/);
});

test("各级管理员共享同一张只读客户表及统一字段", () => {
  assert.match(component, /组内共享客户进度表/);
  assert.match(component, /管理账号只读/);
  assert.match(component, /组内共享 · 分栏填写/);
  for (const field of ["设备号", "来源渠道", "接粉归属", "炒群情况", "专家情况", "注册日期", "首充", "续充", "出金", "净业绩"]) {
    assert.match(component, new RegExp(field));
  }
});

test("组员和组长都能从共享表新增已进群客户", () => {
  assert.match(component, /member \? <button[^]*新增一行/);
  assert.match(component, /新增已进群客户/);
  assert.match(component, /requestJson\("\/api\/lead\/customer-reporting", \{ method: "POST"/);
  for (const field of ["客户号码", "客户姓名", "来源渠道", "进群日期", "设备号", "接粉归属"]) assert.match(component, new RegExp(field));
});
