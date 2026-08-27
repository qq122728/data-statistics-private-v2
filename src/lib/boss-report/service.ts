import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { generateBossAiAnalysis } from "./deepseek";
import { loadDailyBossBrief } from "./data";
import { formatBossDailyBrief } from "./format";
import { dueBossBriefRegions, listBossBriefRegions, prepareRegionalBossBriefs } from "./regional";
import {
  sendBossTelegramChunk,
  splitTelegramText,
  TelegramMessageRejectedError,
} from "./telegram";

const LAST_SENT_SETTING = "bossBrief:lastSentDate";
const auditKey = (reportDate: string) => `bossBrief:audit:${reportDate}`;
const dailyMessageKey = (reportDate: string) => `bossBrief:message:${reportDate}:daily`;
const regionalSentKey = (regionKey: string, reportDate: string) => `bossBrief:regional:lastSent:${regionKey}:${reportDate}`;
const regionalAuditKey = (regionKey: string, reportDate: string) => `bossBrief:regional:audit:${regionKey}:${reportDate}`;
const regionalMessageKey = (regionKey: string, reportDate: string, part: "dispatch" | "operating" | "expert") =>
  `bossBrief:regional:message:${regionKey}:${reportDate}:${part}`;
const MESSAGE_CLAIM_LEASE_MS = 10 * 60 * 1_000;

type RegionalMessageInput = {
  regionKey: string;
  reportDate: string;
  operatingMessage: string;
  expertMessage: string;
  force?: boolean;
};

type MessageClaim = { key: string; value: string };
type MessageClaimResult = MessageClaim | "sent" | "busy" | "uncertain";

class MessageDeliveryNeedsReconciliationError extends Error {
  constructor(key: string, reason = "发送结果不明") {
    super(`消息${reason}，需要人工核对后再决定是否强制重发（${key}）`);
    this.name = "MessageDeliveryNeedsReconciliationError";
  }
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function parseClaim(value: string): { status?: string; claimedAt?: string; fingerprint?: string } {
  try {
    return JSON.parse(value) as { status?: string; claimedAt?: string; fingerprint?: string };
  } catch {
    return {};
  }
}

function messageFingerprint(message: string) {
  return createHash("sha256").update(message).digest("hex");
}

async function claimMessage(
  key: string,
  now = new Date(),
  options: { fingerprint?: string; force?: boolean } = {},
): Promise<MessageClaimResult> {
  const value = JSON.stringify({ status: "sending", claimedAt: now.toISOString(), fingerprint: options.fingerprint });
  try {
    await db.systemSetting.create({ data: { key, value, updatedById: null } });
    return { key, value };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const existing = await db.systemSetting.findUnique({ where: { key } });
  if (!existing) return claimMessage(key, now, options);
  const state = parseClaim(existing.value);
  if (state.status === "sent" && !options.force) return "sent";
  const claimedAt = state.claimedAt ? new Date(state.claimedAt).getTime() : Number.NaN;
  if (Number.isFinite(claimedAt) && now.getTime() - claimedAt < MESSAGE_CLAIM_LEASE_MS) return "busy";
  // sending 可能仍在执行，也可能已经把消息发出后崩溃。即使管理员 force，
  // 也不能靠超时抢占；否则慢任务和新任务会同时向 Telegram 发送。
  if (state.status === "sending") return "uncertain";
  if (!options.force && state.fingerprint && options.fingerprint && state.fingerprint !== options.fingerprint) {
    return "uncertain";
  }
  if (state.status === "retryable" || options.force) {
    const replaced = await db.systemSetting.updateMany({
      where: { key, value: existing.value },
      data: { value, updatedById: null },
    });
    return replaced.count === 1 ? { key, value } : claimMessage(key, now, options);
  }
  // Telegram 不支持幂等键。旧的 sending 既可能是“尚未发送”，也可能是
  // “已发送、但进程在记账前崩溃”，所以绝不能按租约到期自动重发。
  return "uncertain";
}

async function completeMessage(claim: MessageClaim, now = new Date()) {
  const completed = await db.systemSetting.updateMany({
    where: { key: claim.key, value: claim.value },
    data: {
      value: JSON.stringify({
        status: "sent",
        sentAt: now.toISOString(),
        fingerprint: parseClaim(claim.value).fingerprint,
      }),
      updatedById: null,
    },
  });
  if (completed.count !== 1) throw new Error(`消息发送状态已被其他任务改变（${claim.key}）`);
}

async function releaseMessage(claim: MessageClaim) {
  await db.systemSetting.deleteMany({ where: { key: claim.key, value: claim.value } });
}

async function allowMessageRetry(claim: MessageClaim) {
  const retryable = await db.systemSetting.updateMany({
    where: { key: claim.key, value: claim.value },
    data: {
      value: JSON.stringify({
        status: "retryable",
        failedAt: new Date().toISOString(),
        fingerprint: parseClaim(claim.value).fingerprint,
      }),
      updatedById: null,
    },
  });
  if (retryable.count !== 1) throw new Error(`消息重试状态已被其他任务改变（${claim.key}）`);
}

async function sendMessagePart(
  key: string,
  message: string,
  sender: (message: string) => Promise<void>,
  force = false,
) {
  const fingerprint = messageFingerprint(message);
  const partClaim = await claimMessage(key, new Date(), { fingerprint, force });
  if (partClaim === "sent") return false;
  if (partClaim === "busy") return false;
  if (partClaim === "uncertain") throw new MessageDeliveryNeedsReconciliationError(key, "内容已变化或发送结果不明");
  try {
    if (force) {
      await db.systemSetting.deleteMany({ where: { key: { startsWith: `${key}:chunk:` } } });
    }
    const chunks = splitTelegramText(message);
    for (const [index, chunk] of chunks.entries()) {
      const chunkKey = `${key}:chunk:${index}`;
      const chunkClaim = await claimMessage(chunkKey, new Date(), { fingerprint: messageFingerprint(chunk) });
      if (chunkClaim === "sent") continue;
      if (chunkClaim === "busy") throw new MessageDeliveryNeedsReconciliationError(chunkKey);
      if (chunkClaim === "uncertain") throw new MessageDeliveryNeedsReconciliationError(chunkKey);
      try {
        await sender(chunk);
      } catch (error) {
        // 只有 Telegram 明确回答“未发送”时才允许自动补发；超时、断网等
        // 无法确认结果的错误会保留 sending，避免老板群收到重复内容。
        if (error instanceof TelegramMessageRejectedError) await releaseMessage(chunkClaim);
        throw error;
      }
      await completeMessage(chunkClaim);
    }
    await completeMessage(partClaim);
    return true;
  } catch (error) {
    if (error instanceof TelegramMessageRejectedError) await allowMessageRetry(partClaim);
    throw error;
  }
}

/** 同一地区同一天只允许一个任务发送；半途失败时只重试尚未成功的那一条。 */
export async function sendRegionalBriefMessagesExactlyOnce(
  input: RegionalMessageInput,
  sender: (message: string) => Promise<void> = sendBossTelegramChunk,
) {
  const dispatchKey = regionalMessageKey(input.regionKey, input.reportDate, "dispatch");
  const dispatchFingerprint = messageFingerprint(`${input.operatingMessage}\0${input.expertMessage}`);
  const dispatchClaim = await claimMessage(dispatchKey, new Date(), {
    fingerprint: dispatchFingerprint,
    force: input.force,
  });
  if (dispatchClaim === "sent") return { sent: false as const, reason: "already-sent" as const };
  if (dispatchClaim === "busy") return { sent: false as const, reason: "already-sending" as const };
  if (dispatchClaim === "uncertain") {
    throw new MessageDeliveryNeedsReconciliationError(dispatchKey, "内容已变化或发送结果不明");
  }
  if (input.force) {
    await Promise.all([
      db.systemSetting.deleteMany({
        where: { key: { startsWith: regionalMessageKey(input.regionKey, input.reportDate, "operating") } },
      }),
      db.systemSetting.deleteMany({
        where: { key: { startsWith: regionalMessageKey(input.regionKey, input.reportDate, "expert") } },
      }),
    ]);
  }
  try {
    const operatingSent = await sendMessagePart(
      regionalMessageKey(input.regionKey, input.reportDate, "operating"),
      input.operatingMessage,
      sender,
    );
    const expertSent = await sendMessagePart(
      regionalMessageKey(input.regionKey, input.reportDate, "expert"),
      input.expertMessage,
      sender,
    );
    await completeMessage(dispatchClaim);
    return { sent: true as const, operatingSent, expertSent };
  } catch (error) {
    if (error instanceof TelegramMessageRejectedError) await allowMessageRetry(dispatchClaim);
    throw error;
  }
}

async function saveReportAudit(
  reportDate: string,
  value: Record<string, unknown>,
) {
  await db.systemSetting.upsert({
    where: { key: auditKey(reportDate) },
    update: { value: JSON.stringify(value), updatedById: null },
    create: { key: auditKey(reportDate), value: JSON.stringify(value), updatedById: null },
  });
}

export async function prepareBossDailyBrief(reportDate: string) {
  const brief = await loadDailyBossBrief(reportDate);
  const ai = await generateBossAiAnalysis(brief);
  return { brief, ai, message: formatBossDailyBrief(brief, ai) };
}

export async function sendBossDailyBrief(reportDate: string, force = false) {
  const previous = await db.systemSetting.findUnique({ where: { key: LAST_SENT_SETTING } });
  if (!force && previous?.value === reportDate) return { sent: false as const, reason: "already-sent" as const };
  const prepared = await prepareBossDailyBrief(reportDate);
  const auditBase = {
    version: 1,
    reportDate,
    generatedAt: prepared.brief.generatedAt,
    model: process.env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    aiStatus: prepared.ai ? "generated" : "unavailable",
    input: prepared.brief,
    ai: prepared.ai,
    finalMessage: prepared.message,
  };
  await saveReportAudit(reportDate, { ...auditBase, status: "prepared" });
  try {
    await sendMessagePart(dailyMessageKey(reportDate), prepared.message, sendBossTelegramChunk, force);
  } catch (error) {
    await saveReportAudit(reportDate, {
      ...auditBase,
      status: "failed",
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "发送失败",
    });
    throw error;
  }
  await db.$transaction([
    db.systemSetting.upsert({
      where: { key: LAST_SENT_SETTING },
      update: { value: reportDate, updatedById: null },
      create: { key: LAST_SENT_SETTING, value: reportDate, updatedById: null },
    }),
    db.systemSetting.upsert({
      where: { key: auditKey(reportDate) },
      update: { value: JSON.stringify({ ...auditBase, status: "sent", sentAt: new Date().toISOString() }), updatedById: null },
      create: { key: auditKey(reportDate), value: JSON.stringify({ ...auditBase, status: "sent", sentAt: new Date().toISOString() }), updatedById: null },
    }),
  ]);
  return { sent: true as const, ...prepared };
}

export async function prepareDueRegionalBossBriefs(options: { now?: Date; reportDate?: string; force?: boolean } = {}) {
  const now = options.now ?? new Date();
  const regions = await listBossBriefRegions();
  const targets = options.force || options.reportDate ? regions : dueBossBriefRegions(regions, now);
  return Promise.all(targets.map(async (region) => prepareRegionalBossBriefs(
    region,
    options.reportDate,
    now,
  )));
}

/** 每个国家／时区在自己下班后 30 分钟发送两份简报，同一天同一地区绝不重复发送。 */
export async function sendDueRegionalBossBriefs(options: { now?: Date; reportDate?: string; force?: boolean } = {}) {
  const prepared = await prepareDueRegionalBossBriefs(options);
  const results: Array<{ region: string; reportDate: string; sent: boolean; reason?: string }> = [];
  for (const item of prepared) {
    const key = regionalSentKey(item.region.key, item.reportDate);
    const previous = await db.systemSetting.findUnique({ where: { key } });
    if (!options.force && previous) {
      results.push({ region: item.region.key, reportDate: item.reportDate, sent: false, reason: "already-sent" });
      continue;
    }
    const audit = {
      version: 2,
      type: "regional-country-and-expert-brief",
      region: item.region,
      reportDate: item.reportDate,
      generatedAt: item.operating.generatedAt,
      aiStatus: item.ai ? "generated" : "unavailable",
      operating: item.operating,
      experts: item.experts,
      ai: item.ai,
      operatingMessage: item.operatingMessage,
      expertMessage: item.expertMessage,
    };
    await db.systemSetting.upsert({
      where: { key: regionalAuditKey(item.region.key, item.reportDate) },
      update: { value: JSON.stringify({ ...audit, status: "prepared" }), updatedById: null },
      create: { key: regionalAuditKey(item.region.key, item.reportDate), value: JSON.stringify({ ...audit, status: "prepared" }), updatedById: null },
    });
    try {
      const delivery = await sendRegionalBriefMessagesExactlyOnce({
        regionKey: item.region.key,
        reportDate: item.reportDate,
        operatingMessage: item.operatingMessage,
        expertMessage: item.expertMessage,
        force: options.force,
      });
      if (!delivery.sent) {
        results.push({ region: item.region.key, reportDate: item.reportDate, sent: false, reason: "already-sent" });
        continue;
      }
    } catch (error) {
      await db.systemSetting.upsert({
        where: { key: regionalAuditKey(item.region.key, item.reportDate) },
        update: { value: JSON.stringify({ ...audit, status: "failed", failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "发送失败" }), updatedById: null },
        create: { key: regionalAuditKey(item.region.key, item.reportDate), value: JSON.stringify({ ...audit, status: "failed", failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "发送失败" }), updatedById: null },
      });
      throw error;
    }
    await db.$transaction([
      db.systemSetting.upsert({ where: { key }, update: { value: item.reportDate, updatedById: null }, create: { key, value: item.reportDate, updatedById: null } }),
      db.systemSetting.upsert({
        where: { key: regionalAuditKey(item.region.key, item.reportDate) },
        update: { value: JSON.stringify({ ...audit, status: "sent", sentAt: new Date().toISOString() }), updatedById: null },
        create: { key: regionalAuditKey(item.region.key, item.reportDate), value: JSON.stringify({ ...audit, status: "sent", sentAt: new Date().toISOString() }), updatedById: null },
      }),
    ]);
    results.push({ region: item.region.key, reportDate: item.reportDate, sent: true });
  }
  return { sentCount: results.filter((row) => row.sent).length, results };
}
