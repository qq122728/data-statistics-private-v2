import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("August customer phone archive migration", () => {
  it.each([
    "prisma/migrations/20260902040000_archive_august_customer_tracking/migration.sql",
    "prisma/postgres/migrations/20260902040000_archive_august_customer_tracking/migration.sql",
  ])("clears every August phone while retaining the customer ledger in %s", async (path) => {
    const sql = await readFile(path, "utf8");

    expect(sql).toContain("2026-08-01 00:00:00");
    expect(sql).toContain("2026-09-01 00:00:00");
    expect(sql).toContain("ARCHIVED-AUG-LEAD-");
    expect(sql).toContain("ARCHIVED-AUG-ORDER-");
    expect(sql).toContain("ARCHIVED-AUG-EXCEPTION-");
    expect(sql).toContain("[8月号码已清除]");
    expect(sql).not.toContain('"joinedOn" IS NULL');
    expect(sql).not.toContain('"voidedAt" IS NULL');
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"LeadCustomer"/i);
  });
});
