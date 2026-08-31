import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("组长更换计划的 PostgreSQL 运行权限", () => {
  const sql = readFileSync(
    "prisma/postgres/migrations/20260831043500_grant_group_lead_change_runtime/migration.sql",
    "utf8",
  );

  it("只向网站运行账号开放计划表所需的 DML 权限", () => {
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE, DELETE");
    expect(sql).toContain('ON TABLE public."GroupLeadChangePlan"');
    expect(sql).toContain("TO data_statistics_runtime");
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|CREATE|TRUNCATE)/i);
  });

  it("兼容先跑业务迁移、后创建运行账号的新环境", () => {
    expect(sql).toContain("IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'data_statistics_runtime')");
  });
});
