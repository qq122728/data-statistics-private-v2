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

  it("prevents a pure pre-cutover join from occupying an active phone again", async () => {
    const route = await readFile(
      "src/app/api/lead/customer-reporting/route.ts",
      "utf8",
    );

    expect(route).toContain("usesCustomerNumberTracking(input.joinedOn)");
    expect(route).toContain(
      "usesCustomerNumberTracking(input.expertIntroducedOn)",
    );
    expect(route).toContain("更早的纯历史进群已封账");
  });

  it.each([
    "prisma/migrations/20260902050000_archive_pre_september_joined_customers/migration.sql",
    "prisma/postgres/migrations/20260902050000_archive_pre_september_joined_customers/migration.sql",
  ])("also archives late backfills whose join happened before the cutover in %s", async (path) => {
    const sql = await readFile(path, "utf8");

    expect(sql).toContain('"trackingArchivedAt" IS NULL');
    expect(sql).toContain('"joinedOn" < \'2026-09-01\'');
    expect(sql).toContain("ARCHIVED-PRESEP-LEAD-");
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"LeadCustomer"/i);
  });
});
