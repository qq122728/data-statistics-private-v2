import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/lib/db";
import { dueBossBriefRegions, formatRegionalExpertBrief, formatRegionalOperatingBrief, type BossBriefRegion, type RegionalExpertBrief } from "../../src/lib/boss-report/regional";
import { sendRegionalBriefMessagesExactlyOnce } from "../../src/lib/boss-report/service";
import { TelegramMessageRejectedError } from "../../src/lib/boss-report/telegram";
import type { DailyBossBrief } from "../../src/lib/boss-report/types";

const createdSettingPrefixes: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(createdSettingPrefixes.splice(0).map((prefix) => db.systemSetting.deleteMany({ where: { key: { startsWith: prefix } } })));
});

const region: BossBriefRegion = {
  key: "DE:Europe/Berlin:1320",
  countryCode: "DE",
  timezone: "Europe/Berlin",
  countryLabel: "德国",
  timezoneLabel: "德国时间",
  workEndMinutes: 22 * 60,
  groupIds: ["group-a"],
  groupNames: ["恒升部 / A组"],
};

const operating: DailyBossBrief = {
  reportDate: "2026-08-19",
  generatedAt: "2026-08-19T20:30:00.000Z",
  hasData: true,
  totals: { newFans: 10, effectiveFans: 8, replies: 6, groupJoin: 4, expertIntro: 3, expertContacted: 2, registration: 1, orders: 1, rechargeCents: 10_000, withdrawalCents: 1_000, netPerformanceCents: 9_000, costCents: 2_000, rebateCents: 0, profitCents: 7_000 },
  rates: { replyRate: 0.75, joinRate: 0.5, expertIntroRate: 0.75, expertContactRate: 2 / 3, expertOrderRate: 0.5 },
  topCompanies: [],
  topGroups: [],
  groupRows: [{ groupId: "group-a", name: "A组", departmentName: "恒升部", newFans: 10, effectiveFans: 8, replies: 6, groupJoin: 4, expertIntro: 3, expertContacted: 2, registration: 1, orders: 1, rechargeCents: 10_000, withdrawalCents: 1_000, netPerformanceCents: 9_000, costCents: 2_000, profitCents: 7_000 }],
  anomalies: { overdueExpertIntro: 1, overdueExpertContact: 2, overdueOrder: 3, invalidCustomers: 0, pendingCostGroups: 0 },
};

const stages = { QUEUED: 1, MATERIALS: 0, TRACKING: 2, PENDING_REGISTRATION: 0, PENDING_ORDER: 1, DECLINED_DEPOSIT: 0, ORDERED: 3, STALLED: 0 };

describe("国家／小组 AI 简报", () => {
  it("以每个小组所在地的下班后 30 分钟为准，不使用服务器时间", () => {
    expect(dueBossBriefRegions([region], new Date("2026-08-19T20:29:00Z"))).toEqual([]);
    expect(dueBossBriefRegions([region], new Date("2026-08-19T20:30:00Z"))).toEqual([region]);
    expect(dueBossBriefRegions([region], new Date("2026-08-19T21:00:00Z"))).toEqual([]);
  });

  it("经营简报同时列出国家汇总、每个小组和 AI 分析", () => {
    const message = formatRegionalOperatingBrief(region, operating, {
      summary: "今天开单已形成，但专家联系需要跟进。",
      findings: ["推专家后 1 天仍未联系 2 人"],
      actions: ["先逐个补齐专家联系结果"],
    });
    expect(message).toContain("德国 · 德国时间");
    expect(message).toContain("恒升部 / A组：有效 8");
    expect(message).toContain("净业绩 $90.00");
    expect(message).toContain("AI经营分析");
  });

  it("专家简报包含专家、组长兼专家及超过 48 小时的追踪提醒", () => {
    const experts: RegionalExpertBrief = {
      region,
      reportDate: "2026-08-19",
      total: 7,
      stages,
      trackingOver48: 1,
      trackingStartMissing: 1,
      members: [
        { name: "专家 A", roleLabel: "专家", groupName: "A组", total: 4, stages: { ...stages, QUEUED: 0, TRACKING: 1, PENDING_ORDER: 0, ORDERED: 3 }, trackingOver48: 1, trackingStartMissing: 0 },
        { name: "组长 A", roleLabel: "组长兼专家", groupName: "A组", total: 3, stages: { ...stages, QUEUED: 1, TRACKING: 1, PENDING_ORDER: 1, ORDERED: 0 }, trackingOver48: 0, trackingStartMissing: 1 },
      ],
    };
    const message = formatRegionalExpertBrief(experts);
    expect(message).toContain("专家 A（专家）");
    expect(message).toContain("组长 A（组长兼专家）");
    expect(message).toContain("追踪超过 48 小时 1");
    expect(message).toContain("追踪开始时间缺失 1");
  });

  it("并发执行同一地区日报时每条消息只发送一次", async () => {
    const regionKey = `test-${randomUUID()}`;
    createdSettingPrefixes.push(`bossBrief:regional:message:${regionKey}:`);
    const sent: string[] = [];
    const sender = vi.fn(async (message: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      sent.push(message);
    });
    const input = { regionKey, reportDate: "2026-08-19", operatingMessage: "经营简报", expertMessage: "专家简报" };

    const results = await Promise.all([
      sendRegionalBriefMessagesExactlyOnce(input, sender),
      sendRegionalBriefMessagesExactlyOnce(input, sender),
    ]);

    expect(sent).toEqual(["经营简报", "专家简报"]);
    expect(results.filter((result) => result.sent).length).toBe(1);
  });

  it("Telegram 明确拒绝第二条消息后，重试只补发第二条", async () => {
    const regionKey = `test-${randomUUID()}`;
    createdSettingPrefixes.push(`bossBrief:regional:message:${regionKey}:`);
    let expertAttempts = 0;
    const sender = vi.fn(async (message: string) => {
      if (message === "专家简报" && expertAttempts++ === 0) throw new TelegramMessageRejectedError("Telegram 暂时不可用");
    });
    const input = { regionKey, reportDate: "2026-08-19", operatingMessage: "经营简报", expertMessage: "专家简报" };

    await expect(sendRegionalBriefMessagesExactlyOnce(input, sender)).rejects.toThrow("Telegram 暂时不可用");
    await expect(sendRegionalBriefMessagesExactlyOnce(input, sender)).resolves.toMatchObject({ sent: true });

    expect(sender.mock.calls.map(([message]) => message)).toEqual(["经营简报", "专家简报", "专家简报"]);
  });

  it("长消息后续分片被明确拒绝时，重试不会重复已经成功的分片", async () => {
    const regionKey = `test-${randomUUID()}`;
    createdSettingPrefixes.push(`bossBrief:regional:message:${regionKey}:`);
    const firstChunk = "A".repeat(3_900);
    const secondChunk = "B".repeat(100);
    let secondChunkAttempts = 0;
    const sender = vi.fn(async (message: string) => {
      if (message === secondChunk && secondChunkAttempts++ === 0) {
        throw new TelegramMessageRejectedError("Telegram 明确拒绝");
      }
    });
    const input = {
      regionKey,
      reportDate: "2026-08-19",
      operatingMessage: `${firstChunk}\n${secondChunk}`,
      expertMessage: "专家简报",
    };

    await expect(sendRegionalBriefMessagesExactlyOnce(input, sender)).rejects.toThrow("Telegram 明确拒绝");
    await expect(sendRegionalBriefMessagesExactlyOnce(input, sender)).resolves.toMatchObject({ sent: true });

    expect(sender.mock.calls.map(([message]) => message)).toEqual([
      firstChunk,
      secondChunk,
      secondChunk,
      "专家简报",
    ]);
  });

  it("部分发送后日报内容发生变化时冻结续传，避免把新旧分片拼在一起", async () => {
    const regionKey = `test-${randomUUID()}`;
    createdSettingPrefixes.push(`bossBrief:regional:message:${regionKey}:`);
    const firstChunk = "A".repeat(3_900);
    const secondChunk = "B".repeat(100);
    const sender = vi.fn(async (message: string) => {
      if (message === secondChunk) throw new TelegramMessageRejectedError("Telegram 明确拒绝");
    });
    const input = {
      regionKey,
      reportDate: "2026-08-19",
      operatingMessage: `${firstChunk}\n${secondChunk}`,
      expertMessage: "专家简报",
    };

    await expect(sendRegionalBriefMessagesExactlyOnce(input, sender)).rejects.toThrow("Telegram 明确拒绝");
    await expect(sendRegionalBriefMessagesExactlyOnce({
      ...input,
      operatingMessage: `${"C".repeat(3_900)}\n${secondChunk}`,
    }, sender)).rejects.toThrow("内容已变化");

    expect(sender.mock.calls.map(([message]) => message)).toEqual([firstChunk, secondChunk]);
  });

  it("发送结果不明时冻结自动重发，避免超时后重复发送", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T20:30:00.000Z"));
    const regionKey = `test-${randomUUID()}`;
    createdSettingPrefixes.push(`bossBrief:regional:message:${regionKey}:`);
    const sender = vi.fn(async () => {
      throw new Error("连接超时，无法确认 Telegram 是否已收到");
    });
    const input = { regionKey, reportDate: "2026-08-19", operatingMessage: "经营简报", expertMessage: "专家简报" };

    try {
      await expect(sendRegionalBriefMessagesExactlyOnce(input, sender)).rejects.toThrow("连接超时");
      vi.advanceTimersByTime(11 * 60 * 1_000);
      await expect(sendRegionalBriefMessagesExactlyOnce(input, sender)).rejects.toThrow("需要人工核对");
    } finally {
      vi.useRealTimers();
    }

    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("进程在消息发出后崩溃留下 sending 状态时，也不会自动重发", async () => {
    const regionKey = `test-${randomUUID()}`;
    createdSettingPrefixes.push(`bossBrief:regional:message:${regionKey}:`);
    const sender = vi.fn(async () => undefined);
    await db.systemSetting.create({
      data: {
        key: `bossBrief:regional:message:${regionKey}:2026-08-19:dispatch`,
        value: JSON.stringify({ status: "sending", claimedAt: "2026-08-19T00:00:00.000Z" }),
      },
    });
    const input = { regionKey, reportDate: "2026-08-19", operatingMessage: "经营简报", expertMessage: "专家简报" };

    await expect(sendRegionalBriefMessagesExactlyOnce(input, sender)).rejects.toThrow("需要人工核对");

    expect(sender).not.toHaveBeenCalled();
  });

  it("管理员明确强制重发时重新发送两条消息", async () => {
    const regionKey = `test-${randomUUID()}`;
    createdSettingPrefixes.push(`bossBrief:regional:message:${regionKey}:`);
    const sender = vi.fn(async (_message: string) => undefined);
    const input = { regionKey, reportDate: "2026-08-19", operatingMessage: "经营简报", expertMessage: "专家简报" };

    await sendRegionalBriefMessagesExactlyOnce(input, sender);
    await sendRegionalBriefMessagesExactlyOnce({ ...input, force: true }, sender);

    expect(sender.mock.calls.map(([message]) => message)).toEqual(["经营简报", "专家简报", "经营简报", "专家简报"]);
  });

  it("管理员强制重发不会抢占仍在发送的任务", async () => {
    const regionKey = `test-${randomUUID()}`;
    createdSettingPrefixes.push(`bossBrief:regional:message:${regionKey}:`);
    let releaseFirst!: () => void;
    const firstIsSending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const sender = vi.fn(async (message: string) => {
      if (message === "经营简报") {
        firstStarted();
        await firstIsSending;
      }
    });
    const input = { regionKey, reportDate: "2026-08-19", operatingMessage: "经营简报", expertMessage: "专家简报" };

    const original = sendRegionalBriefMessagesExactlyOnce(input, sender);
    await firstStartedPromise;
    await expect(sendRegionalBriefMessagesExactlyOnce({ ...input, force: true }, sender)).resolves.toMatchObject({
      sent: false,
      reason: "already-sending",
    });
    releaseFirst();
    await original;

    expect(sender.mock.calls.map(([message]) => message)).toEqual(["经营简报", "专家简报"]);
  });

  it("发送超过租约时间后，管理员强制重发仍不会抢占旧任务", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T20:30:00.000Z"));
    const regionKey = `test-${randomUUID()}`;
    createdSettingPrefixes.push(`bossBrief:regional:message:${regionKey}:`);
    let releaseFirst!: () => void;
    const firstIsSending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstStartedPromise = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const sender = vi.fn(async (message: string) => {
      if (message === "经营简报") {
        firstStarted();
        await firstIsSending;
      }
    });
    const input = { regionKey, reportDate: "2026-08-19", operatingMessage: "经营简报", expertMessage: "专家简报" };

    try {
      const original = sendRegionalBriefMessagesExactlyOnce(input, sender);
      await firstStartedPromise;
      vi.advanceTimersByTime(11 * 60 * 1_000);
      await expect(sendRegionalBriefMessagesExactlyOnce({ ...input, force: true }, sender)).rejects.toThrow("需要人工核对");
      releaseFirst();
      await original;
    } finally {
      vi.useRealTimers();
    }

    expect(sender.mock.calls.map(([message]) => message)).toEqual(["经营简报", "专家简报"]);
  });
});
