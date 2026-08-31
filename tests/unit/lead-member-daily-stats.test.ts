import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { GET, PATCH } from "../../src/app/api/lead/member-daily-stats/[memberId]/route";
import { db } from "../../src/lib/db";

const prefix = "lead-member-daily-stats-";

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { entityId: { startsWith: prefix } } });
  await db.dailyStatEntry.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("组长检查统一组员日报", () => {
  it("能读取并纠正统一行中的资金字段，同时校验完整漏斗", async () => {
    const suffix = randomUUID();
    const groupId = `${prefix}group-${suffix}`;
    const leadId = `${prefix}lead-${suffix}`;
    const memberId = `${prefix}member-${suffix}`;
    const channelId = `${prefix}channel-${suffix}`;
    const entryId = `${prefix}entry-${suffix}`;
    await db.teamGroup.create({ data: { id: groupId, name: "组长检查组" } });
    const lead = await db.user.create({ data: { id: leadId, username: leadId, name: "检查组长", role: "LEAD", groupId } });
    await db.user.create({ data: { id: memberId, username: memberId, name: "统一组员", role: "RECEPTION", groupId } });
    await db.channel.create({ data: { id: channelId, groupId, name: "检查渠道", normalizedName: channelId } });
    const entry = await db.dailyStatEntry.create({ data: {
      id: entryId,
      identityKey: `unified-member-v1:${JSON.stringify([memberId, groupId, "2026-08-31", "RECEPTION", channelId, null, null])}`,
      ownerId: memberId, groupId, channelId, businessDate: "2026-08-31", timezone: "UTC", position: "RECEPTION", status: "APPROVED",
    } });
    const revision = await db.dailyStatRevision.create({ data: {
      entryId: entry.id, version: 1, createdById: memberId,
      dispatchCount: 10, duplicateCount: 1, manualInvalidCount: 1, effectiveCount: 8,
      replyCount: 5, joinCount: 4, normalLeaveCount: 1, currentInGroupCount: 3,
      expertIntroCount: 3, registrationCount: 2, orderCount: 1, bankInitialDepositCents: 10_000,
    } });
    await db.dailyStatEntry.update({ where: { id: entry.id }, data: { currentRevisionId: revision.id, approvedRevisionId: revision.id } });
    vi.spyOn(auth, "requireRole").mockResolvedValue(lead);
    const context = { params: Promise.resolve({ memberId }) };

    const listed = await GET(new Request(`http://localhost/api/lead/member-daily-stats/${memberId}`), context);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      member: { id: memberId },
      entries: [expect.objectContaining({ id: entryId, identityKey: expect.stringContaining("unified-member-v1:") })],
    });

    const corrected = await PATCH(new Request(`http://localhost/api/lead/member-daily-stats/${memberId}`, {
      method: "PATCH", body: JSON.stringify({ entryId, field: "bankRechargeCents", value: 5_000, reason: "核对流水后纠正" }),
    }), context);
    expect(corrected.status).toBe(200);
    await expect(db.dailyStatEntry.findUniqueOrThrow({ where: { id: entryId }, include: { approvedRevision: true } })).resolves.toMatchObject({
      status: "APPROVED", approvedRevision: { version: 2, bankInitialDepositCents: 10_000, bankRechargeCents: 5_000, registrationCount: 2, orderCount: 1 },
    });

    const crossDayCorrection = await PATCH(new Request(`http://localhost/api/lead/member-daily-stats/${memberId}`, {
      method: "PATCH", body: JSON.stringify({ entryId, field: "registrationCount", value: 4, reason: "补记以前客户今日注册" }),
    }), context);
    expect(crossDayCorrection.status).toBe(200);
    await expect(db.dailyStatEntry.findUniqueOrThrow({ where: { id: entryId }, include: { approvedRevision: true } }))
      .resolves.toMatchObject({ approvedRevision: { registrationCount: 4 } });
    await expect(db.auditLog.findFirst({ where: { action: "DAILY_STAT_LEAD_CORRECTED", entityId: entryId } })).resolves.toBeTruthy();
  });
});
