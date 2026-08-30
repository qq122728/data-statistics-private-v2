import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { GET as listLeadReviews, POST as sendForReview } from "../../src/app/api/lead/channel-review/route";
import { GET as listResourceInbox } from "../../src/app/api/resource/channel-review/route";
import { POST as actOnReview } from "../../src/app/api/resource/channel-review/[id]/route";

const prefix = "channel-review-test-";
const REVIEW_DATE = "2026-08-20";

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { entityType: "ChannelReviewEntry", actorId: { startsWith: prefix } } });
  await db.channelReviewEntry.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.leadCustomer.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.metricEvent.deleteMany({ where: { batch: { groupId: { startsWith: prefix } } } });
  await db.sourceBatch.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.resourceChannelAccess.deleteMany({ where: { userId: { startsWith: prefix } } });
  await db.channel.deleteMany({ where: { groupId: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

async function fixture() {
  const suffix = randomUUID();
  const departmentId = `${prefix}department-${suffix}`;
  const groupId = `${prefix}group-${suffix}`;
  const smsChannelId = `${prefix}sms-channel-${suffix}`;
  const adsChannelId = `${prefix}ads-channel-${suffix}`;

  await db.department.create({ data: { id: departmentId, name: `${prefix}部门-${suffix}`, timezone: "UTC" } });
  await db.teamGroup.create({ data: { id: groupId, name: `${prefix}小组-${suffix}`, departmentId, timezone: "UTC" } });

  const lead = await db.user.create({ data: { id: `${prefix}lead-${suffix}`, username: `${prefix}lead-${suffix}`, name: "组长", role: "LEAD", groupId } });
  const resourceSms = await db.user.create({ data: { id: `${prefix}resource-sms-${suffix}`, username: `${prefix}resource-sms-${suffix}`, name: "资源部·短信", role: "RESOURCE_MANAGER" } });
  const resourceAds = await db.user.create({ data: { id: `${prefix}resource-ads-${suffix}`, username: `${prefix}resource-ads-${suffix}`, name: "资源部·投流", role: "RESOURCE_MANAGER" } });

  await db.channel.create({ data: { id: smsChannelId, groupId, name: "短信渠道", normalizedName: `${prefix}短信渠道-${suffix}`, channelType: "SMS" } });
  await db.channel.create({ data: { id: adsChannelId, groupId, name: "投流渠道", normalizedName: `${prefix}投流渠道-${suffix}`, channelType: "ADS" } });
  await db.resourceChannelAccess.create({ data: { userId: resourceSms.id, channelId: smsChannelId } });
  await db.resourceChannelAccess.create({ data: { userId: resourceAds.id, channelId: adsChannelId } });

  const smsBatch = await db.sourceBatch.create({ data: { groupId, channelId: smsChannelId, sourceDate: REVIEW_DATE } });
  const adsBatch = await db.sourceBatch.create({ data: { groupId, channelId: adsChannelId, sourceDate: REVIEW_DATE } });
  // channel-analysis 的 NEW_FANS/EFFECTIVE_FANS 是按 LeadCustomer 记录派生的（见
  // canonical-events.ts），不是靠原始 MetricEvent 行——一个批次下建一条真实客户记录，
  // 这一天这个渠道才会在 loadChannelAnalysis 里真正出现一行，跟发送校验复用的是同一条路径。
  await db.leadCustomer.create({ data: { phone: `${prefix}sms-${suffix}`, batchId: smsBatch.id, ownerId: lead.id } });
  await db.leadCustomer.create({ data: { phone: `${prefix}ads-${suffix}`, batchId: adsBatch.id, ownerId: lead.id } });

  // 模拟 getSessionUser() 已经按渠道类型展开过的 resourceChannelAccess（见 lib/auth.ts）——
  // 只有一个渠道时展开结果就是它自己，跟真实登录后拿到的形状一致。
  const signedResourceSms: auth.SessionUser = { ...resourceSms, resourceChannelAccess: [{ channelId: smsChannelId }] };
  const signedResourceAds: auth.SessionUser = { ...resourceAds, resourceChannelAccess: [{ channelId: adsChannelId }] };

  return { groupId, smsChannelId, adsChannelId, lead, resourceSms: signedResourceSms, resourceAds: signedResourceAds, suffix };
}

function signInAs(user: auth.SessionUser) {
  vi.restoreAllMocks();
  vi.spyOn(auth, "requireUser").mockResolvedValue(user);
}

function sendRequest(body: unknown) {
  return new Request("http://localhost/api/lead/channel-review", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function actRequest(body: unknown) {
  return new Request("http://localhost/api/resource/channel-review/x", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function normalizedNameOf(data: Awaited<ReturnType<typeof fixture>>, channelId: string) {
  return channelId === data.smsChannelId ? `${prefix}短信渠道-${data.suffix}` : `${prefix}投流渠道-${data.suffix}`;
}

describe.sequential("组长与资源部的渠道数据核对（需求文档4.5）", () => {
  it("lets a LEAD send a channel+date for review and read it back", async () => {
    const data = await fixture();
    signInAs(data.lead);
    const sent = await sendForReview(sendRequest({ normalizedName: normalizedNameOf(data, data.smsChannelId), reviewDate: REVIEW_DATE }));
    expect(sent.status).toBe(200);
    await expect(sent.json()).resolves.toMatchObject({ entry: { status: "SENT" } });

    const list = await listLeadReviews();
    expect(list.status).toBe(200);
    const { entries } = await list.json() as { entries: Array<{ reviewDate: string; status: string }> };
    expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ reviewDate: REVIEW_DATE, status: "SENT" })]));
  });

  it("blocks a non-LEAD account from sending a review", async () => {
    const data = await fixture();
    signInAs(data.resourceSms);
    const response = await sendForReview(sendRequest({ normalizedName: normalizedNameOf(data, data.smsChannelId), reviewDate: REVIEW_DATE }));
    expect(response.status).toBe(403);
  });

  it("rejects a channel that does not belong to the lead's own group", async () => {
    const data = await fixture();
    signInAs(data.lead);
    const response = await sendForReview(sendRequest({ normalizedName: "不存在的渠道名字", reviewDate: REVIEW_DATE }));
    expect(response.status).toBe(404);
  });

  it("rejects a date with no real channel data that day", async () => {
    const data = await fixture();
    signInAs(data.lead);
    const response = await sendForReview(sendRequest({ normalizedName: normalizedNameOf(data, data.smsChannelId), reviewDate: "2026-01-01" }));
    expect(response.status).toBe(400);
  });

  it("scopes the resource inbox to the account's bound channel type only", async () => {
    const data = await fixture();
    signInAs(data.lead);
    await sendForReview(sendRequest({ normalizedName: normalizedNameOf(data, data.smsChannelId), reviewDate: REVIEW_DATE }));
    await sendForReview(sendRequest({ normalizedName: normalizedNameOf(data, data.adsChannelId), reviewDate: REVIEW_DATE }));

    signInAs(data.resourceSms);
    const smsInbox = await listResourceInbox();
    const smsEntries = (await smsInbox.json() as { entries: Array<{ normalizedName: string }> }).entries;
    expect(smsEntries).toHaveLength(1);
    expect(smsEntries[0]?.normalizedName).toBe(normalizedNameOf(data, data.smsChannelId));

    signInAs(data.resourceAds);
    const adsInbox = await listResourceInbox();
    const adsEntries = (await adsInbox.json() as { entries: Array<{ normalizedName: string }> }).entries;
    expect(adsEntries).toHaveLength(1);
    expect(adsEntries[0]?.normalizedName).toBe(normalizedNameOf(data, data.adsChannelId));
  });

  it("requires a reason to dispute but not to confirm, and blocks a resource account outside the channel's scope", async () => {
    const data = await fixture();
    signInAs(data.lead);
    await sendForReview(sendRequest({ normalizedName: normalizedNameOf(data, data.smsChannelId), reviewDate: REVIEW_DATE }));
    signInAs(data.resourceSms);
    const inbox = await listResourceInbox();
    const [entry] = (await inbox.json() as { entries: Array<{ id: string }> }).entries;

    // 越权渠道：投流账号不能处理短信渠道的记录，返回 404 而不是 403，不泄露记录是否存在。
    signInAs(data.resourceAds);
    const crossChannel = await actOnReview(actRequest({ decision: "CONFIRM" }), { params: Promise.resolve({ id: entry.id }) });
    expect(crossChannel.status).toBe(404);

    signInAs(data.resourceSms);
    const missingReason = await actOnReview(actRequest({ decision: "DISPUTE" }), { params: Promise.resolve({ id: entry.id }) });
    expect(missingReason.status).toBe(400);

    const disputed = await actOnReview(actRequest({ decision: "DISPUTE", note: "进群数跟后台对不上" }), { params: Promise.resolve({ id: entry.id }) });
    expect(disputed.status).toBe(200);
    await expect(disputed.json()).resolves.toMatchObject({ reviewStatus: "DISPUTED" });
    await expect(db.channelReviewEntry.findUniqueOrThrow({ where: { id: entry.id } })).resolves.toMatchObject({ status: "DISPUTED", note: "进群数跟后台对不上" });

    // 已经处理过（DISPUTED），不能再处理一次。
    const again = await actOnReview(actRequest({ decision: "CONFIRM" }), { params: Promise.resolve({ id: entry.id }) });
    expect(again.status).toBe(409);
  });

  it("lets the lead resend after a dispute, resetting status and clearing the note", async () => {
    const data = await fixture();
    signInAs(data.lead);
    await sendForReview(sendRequest({ normalizedName: normalizedNameOf(data, data.smsChannelId), reviewDate: REVIEW_DATE }));
    signInAs(data.resourceSms);
    const inbox = await listResourceInbox();
    const [entry] = (await inbox.json() as { entries: Array<{ id: string }> }).entries;
    await actOnReview(actRequest({ decision: "DISPUTE", note: "数字对不上" }), { params: Promise.resolve({ id: entry.id }) });

    signInAs(data.lead);
    const resent = await sendForReview(sendRequest({ normalizedName: normalizedNameOf(data, data.smsChannelId), reviewDate: REVIEW_DATE }));
    expect(resent.status).toBe(200);
    await expect(db.channelReviewEntry.findUniqueOrThrow({ where: { id: entry.id } })).resolves.toMatchObject({ status: "SENT", note: null, reviewedById: null });
  });

  it("makes a confirmation terminal: the resource account cannot act again and the lead cannot resend", async () => {
    const data = await fixture();
    signInAs(data.lead);
    await sendForReview(sendRequest({ normalizedName: normalizedNameOf(data, data.smsChannelId), reviewDate: REVIEW_DATE }));
    signInAs(data.resourceSms);
    const inbox = await listResourceInbox();
    const [entry] = (await inbox.json() as { entries: Array<{ id: string }> }).entries;
    const confirmed = await actOnReview(actRequest({ decision: "CONFIRM" }), { params: Promise.resolve({ id: entry.id }) });
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toMatchObject({ reviewStatus: "CONFIRMED" });

    const secondAttempt = await actOnReview(actRequest({ decision: "DISPUTE", note: "太迟了" }), { params: Promise.resolve({ id: entry.id }) });
    expect(secondAttempt.status).toBe(409);

    signInAs(data.lead);
    const resendAttempt = await sendForReview(sendRequest({ normalizedName: normalizedNameOf(data, data.smsChannelId), reviewDate: REVIEW_DATE }));
    expect(resendAttempt.status).toBe(409);
  });
});
