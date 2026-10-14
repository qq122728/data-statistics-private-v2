import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { GET as getDailyStats } from "../../src/app/api/daily-stats/route";
import { GET as getPersonalPerformance } from "../../src/app/api/personal-performance/route";
import { loadCurrentInGroupCustomers } from "../../src/lib/current-in-group-customers";
import { db } from "../../src/lib/db";

const prefix = "current-group-merge-test-";

afterEach(async () => {
  vi.restoreAllMocks();
  await db.leadCustomer.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.customerSheetRow.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

it("merges old and new in-group customers per number and keeps same-ID channels in the right group", async () => {
  const suffix = randomUUID();
  const departmentId = `${prefix}department-${suffix}`;
  const groupA = `${prefix}a-${suffix}`;
  const groupB = `${prefix}b-${suffix}`;
  const channelId = `${prefix}shared-channel-${suffix}`;
  const ownerAId = `${prefix}owner-a-${suffix}`;
  const ownerBId = `${prefix}owner-b-${suffix}`;
  const operatorId = `${prefix}operator-${suffix}`;
  const newPhone = `${Math.floor(100000 + Math.random() * 900000)}`;
  const leftPhone = String((Number(newPhone) + 1) % 1_000_000).padStart(6, "0");
  await db.department.create({ data: { id: departmentId, name: departmentId } });
  await db.teamGroup.createMany({ data: [
    { id: groupA, name: groupA, departmentId, groupType: "HACKER" },
    { id: groupB, name: groupB, departmentId, groupType: "HACKER" },
  ] });
  const [ownerA, , operator] = await Promise.all([
    db.user.create({ data: { id: ownerAId, username: ownerAId, name: "甲组员", role: "RECEPTION", groupId: groupA } }),
    db.user.create({ data: { id: ownerBId, username: ownerBId, name: "乙组员", role: "RECEPTION", groupId: groupB } }),
    db.user.create({ data: { id: operatorId, username: operatorId, name: "甲群负责人", role: "GROUP_OPERATOR", groupId: groupA } }),
  ]);
  await db.channel.createMany({ data: [
    { id: channelId, groupId: groupA, name: "甲渠道", normalizedName: `a-${suffix}` },
    { id: channelId, groupId: groupB, name: "乙渠道", normalizedName: `b-${suffix}` },
  ] });
  const batch = await db.sourceBatch.create({ data: { groupId: groupA, channelId, sourceDate: "2026-10-01" } });
  await db.leadCustomer.create({ data: {
    phone: newPhone, batchId: batch.id, ownerId: ownerAId, groupOperatorOwnerId: operatorId,
    groupStatus: "JOINED", joinedOn: "2026-10-02",
  } });
  await db.leadCustomer.create({ data: {
    phone: leftPhone, batchId: batch.id, ownerId: ownerAId, groupOperatorOwnerId: operatorId,
    groupStatus: "LEFT", joinedOn: "2026-10-02", leftOn: "2026-10-03",
  } });
  const oldRow = (groupId: string, ownerId: string, phone: string) => ({
    groupId, ownerId, phone,
    data: JSON.stringify({ intakeOn: "2026-10-01", joinedOn: "2026-10-02", channelId,
      operatorId: groupId === groupA ? operatorId : null }),
  });
  await db.customerSheetRow.createMany({ data: [
    oldRow(groupA, ownerAId, `00${newPhone}`),
    oldRow(groupA, ownerAId, `00${leftPhone}`),
    oldRow(groupA, ownerAId, "99887766"),
    oldRow(groupB, ownerBId, "88776655"),
  ] });

  const rows = await loadCurrentInGroupCustomers([groupA, groupB], "2026-10-14");
  expect(rows.filter((row) => row.groupId === groupA)).toHaveLength(2);
  expect(rows.filter((row) => row.groupId === groupB)).toEqual([
    expect.objectContaining({ channel: expect.objectContaining({ name: "乙渠道" }), member: expect.objectContaining({ id: ownerBId }) }),
  ]);
  expect(rows.find((row) => row.groupId === groupA && row.channel.name === "甲渠道")).toBeDefined();

  vi.spyOn(auth, "requireUser").mockResolvedValue(ownerA);
  const response = await getDailyStats(new Request("http://localhost/api/daily-stats?from=2026-10-01&to=2026-10-14"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ currentInGroupCount: 2, numberStockBaseline: { [channelId]: 2 } });

  const receptionPerformance = await getPersonalPerformance(new Request("http://localhost/api/personal-performance?role=RECEPTION&range=custom&sourceDateFrom=2026-10-14&sourceDateTo=2026-10-14"));
  expect(receptionPerformance.status).toBe(200);
  expect((await receptionPerformance.json()).currentInGroup).toBe(2);
  vi.spyOn(auth, "requireUser").mockResolvedValue(operator);
  const operatorHistory = await getDailyStats(new Request("http://localhost/api/daily-stats?from=2026-10-01&to=2026-10-14"));
  expect(operatorHistory.status).toBe(200);
  expect(await operatorHistory.json()).toMatchObject({ currentInGroupCount: 2, numberStockBaseline: { [channelId]: 2 } });
  const operatorPerformance = await getPersonalPerformance(new Request("http://localhost/api/personal-performance?role=GROUP_OPERATOR&range=custom&sourceDateFrom=2026-10-14&sourceDateTo=2026-10-14"));
  expect(operatorPerformance.status).toBe(200);
  expect((await operatorPerformance.json()).currentInGroup).toBe(2);
});
