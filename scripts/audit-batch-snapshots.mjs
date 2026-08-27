import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

try {
  const batches = await db.sourceBatch.findMany({
    select: {
      id: true,
      sourceDate: true,
      groupId: true,
      channelId: true,
      fanCostModeSnapshot: true,
      effectiveFanPriceCentsSnapshot: true,
      channelTypeSnapshot: true,
      rebateRateBpsSnapshot: true,
      advertisingSpendCents: true,
      advertisingFanCount: true,
      advertisingServiceFeeRateBps: true,
      group: { select: { name: true } },
      channel: { select: { name: true } },
    },
    orderBy: [{ sourceDate: "desc" }, { id: "asc" }],
  });

  const findings = batches.flatMap((batch) => {
    const issues = [];
    if (batch.channelTypeSnapshot === "ADS") {
      if (batch.advertisingSpendCents === null) issues.push("缺广告消耗");
      if (batch.advertisingFanCount === null) issues.push("缺当次产粉数");
      if (batch.advertisingServiceFeeRateBps === null) issues.push("缺服务费率");
      if (batch.effectiveFanPriceCentsSnapshot === null) issues.push("缺冻结单粉成本");
    }
    if (batch.channelTypeSnapshot === "REBATE" && batch.rebateRateBpsSnapshot === null) issues.push("缺冻结返点比例");
    if (batch.channelTypeSnapshot !== "REBATE" && batch.fanCostModeSnapshot === "PAID" && batch.effectiveFanPriceCentsSnapshot === null) issues.push("缺冻结单粉成本");
    return issues.length ? [{
      batchId: batch.id,
      sourceDate: batch.sourceDate,
      group: batch.group.name,
      channel: batch.channel.name,
      type: batch.channelTypeSnapshot,
      issues: issues.join("；"),
    }] : [];
  });

  if (!findings.length) {
    console.log("批次快照完整：未发现需要人工核对的价格、投流或返点字段。");
  } else {
    console.table(findings);
    console.log(`发现 ${findings.length} 个历史批次需要人工核对；此脚本只读取，不会修改任何数据。`);
    process.exitCode = 2;
  }
} catch (error) {
  // 先把“数据库还没升级”说清楚，避免把技术报错误当成历史数据缺失。
  if (
    error &&
    typeof error === "object" &&
    error.code === "P2022" &&
    error.meta?.column?.includes("SourceBatch.advertisingFanCount")
  ) {
    console.error("无法开始快照巡检：数据库尚未执行 advertisingFanCount 快照迁移。请先在已备份的目标库执行对应 Prisma 迁移，再重新运行本巡检；本次没有读取之外的任何修改。");
    process.exitCode = 2;
  } else {
    throw error;
  }
} finally {
  await db.$disconnect();
}
