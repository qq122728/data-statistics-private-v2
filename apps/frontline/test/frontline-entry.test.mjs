import assert from "node:assert/strict";
import test from "node:test";

import { resolveFrontlineEntry } from "../lib/frontline-entry.ts";

test("组长兼专家仍进入管理端", () => {
  assert.deepEqual(resolveFrontlineEntry(["LEAD", "EXPERT"], "group-1"), { workspace: "ADMIN" });
});

test("纯专家留在一线前台", () => {
  assert.deepEqual(resolveFrontlineEntry(["EXPERT"], "group-1"), { workspace: "FRONTLINE", role: "EXPERT" });
});

test("接粉与炒群账号保持原工作台", () => {
  assert.deepEqual(resolveFrontlineEntry(["RECEPTION"], "group-1"), { workspace: "FRONTLINE", role: "RECEPTION" });
  assert.deepEqual(resolveFrontlineEntry(["GROUP_OPERATOR"], "group-1"), { workspace: "FRONTLINE", role: "GROUP_OPERATOR" });
});

test("管理账号或未分组账号进入管理端", () => {
  assert.deepEqual(resolveFrontlineEntry(["COMPANY_MANAGER"], null), { workspace: "ADMIN" });
  assert.deepEqual(resolveFrontlineEntry(["EXPERT"], null), { workspace: "ADMIN" });
});
