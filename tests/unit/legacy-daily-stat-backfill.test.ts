import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy daily stat backfill safety", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts/ops/backfill-legacy-daily-stats.mjs"), "utf8");

  it("is guarded, idempotent and excludes customer-progress compatibility events", () => {
    expect(source).toContain('CONFIRM_LEGACY_DAILY_STAT_BACKFILL !== "YES"');
    expect(source).toContain('id: { startsWith: PREFIX }');
    expect(source).toContain('derivedFromLedger: false');
    expect(source).toContain('voidedAt: null');
  });

  it("reconciles migrated added-data totals before reporting success", () => {
    expect(source).toContain("source !== migrated");
    expect(source).toContain("Backfill reconciliation failed");
  });
});

describe("transition customer stat backfill safety", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts/ops/backfill-transition-customer-stats.mjs"), "utf8");

  it("is a guarded one-time exception for pre-cutover customer data", () => {
    expect(source).toContain('CONFIRM_TRANSITION_CUSTOMER_STAT_BACKFILL !== "YES"');
    expect(source).toContain('id: { startsWith: PREFIX }');
    expect(source).toContain('derivedFromLedger: true');
    expect(source).toContain('isHistoricalRecord: false');
  });

  it("reconciles imported number totals", () => {
    expect(source).toContain("sourceAdded !== migratedAdded");
    expect(source).toContain("Transition reconciliation failed");
  });
});
