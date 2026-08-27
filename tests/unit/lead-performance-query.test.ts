import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

describe("lead performance query scalability", () => {
  it("aggregates group and expert performance in the database", async () => {
    const [groupQuery, expertQuery, groupPage, expertPage] = await Promise.all([
      read("src/lib/customer-queries/group-customers.ts"),
      read("src/lib/customer-queries/expert-customers.ts"),
      read("src/app/(app)/group-customers/page.tsx"),
      read("src/app/(app)/expert-customers/page.tsx"),
    ]);
    expect(groupQuery).toContain("loadGroupPerformanceSummary");
    expect(groupQuery).toContain('GROUP BY COALESCE(lc."groupOperatorOwnerId", gor."groupOperatorId")');
    expect(expertQuery).toContain("loadExpertPerformanceSummary");
    expect(expertQuery).toContain("GROUP BY lc.\"expertOwnerId\"");
    expect(expertQuery).toContain('expertContactedOn: { not: null }');
    expect(groupPage).not.toContain("performanceLeads");
    expect(expertPage).not.toContain("performanceLeads");
  });

  it("loads customer details only after expansion and one page at a time", async () => {
    const [groupTable, expertTable, endpoint] = await Promise.all([
      read("src/components/lead/GroupOperatorPerformanceTable.tsx"),
      read("src/components/lead/ExpertPerformanceTable.tsx"),
      read("src/app/api/lead/performance-details/route.ts"),
    ]);
    for (const source of [groupTable, expertTable]) {
      expect(source).toContain("/api/lead/performance-details");
      expect(source).toContain("继续加载");
    }
    expect(endpoint).toContain("requireLeadRequest");
    expect(endpoint).toContain("pageSize: 10");
    expect(endpoint).toContain('"Cache-Control": "private, max-age=30"');
  });

  it("keeps performance filter indexes in the schema", async () => {
    const schema = await read("prisma/schema.prisma");
    expect(schema).toContain("@@index([batchId, invalid, groupStatus, expertIntroducedOn])");
    expect(schema).toContain("@@index([batchId, invalid, expertOwnerId, registeredOn])");
    expect(schema).toContain("@@index([groupOperatorOwnerId, updatedAt])");
  });
});
