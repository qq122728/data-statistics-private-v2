import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8").catch(() => "");

describe("dashboard query bounds", () => {
  it("keeps recent, trend and anomaly queries bounded in the database", async () => {
    const [page, queries] = await Promise.all([
      readSource("src/app/(app)/dashboard/page.tsx"),
      readSource("src/lib/analytics/canonical-events.ts"),
    ]);

    expect(page).toContain("loadManagementOverview");
    expect(page).toContain('role: "RECEPTION"');
    expect(page).toContain('db.metricEvent.groupBy({');
    expect(page).not.toContain('events: { select: { kind: true, amountCents: true, continuationNumber: true, voidedAt: true, occurredOn: true } }');
    expect(queries).toContain("LeadCustomer is the source of truth");
    expect(queries).toContain("derivedFromLedger: false");
    expect(queries).toContain("for (const event of batch.events)");
    expect(queries).toContain("for (const lead of batch.leads)");
    expect(queries).toContain('kind: { in: ["RECHARGE", "WITHDRAWAL"] }');
  });
});
