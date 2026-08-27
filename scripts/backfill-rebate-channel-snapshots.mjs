import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const references = (process.env.REBATE_CHANNEL_REFS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => {
    const separator = value.lastIndexOf("@");
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`渠道标识格式错误：${value}。正确格式是 渠道ID@小组ID`);
    }
    return { channelId: value.slice(0, separator), groupId: value.slice(separator + 1) };
  });

const rate = Number(process.env.REBATE_RATE_BPS ?? "3000");
if (!references.length) {
  throw new Error("请通过 REBATE_CHANNEL_REFS 填写已确认的底料渠道，例如 channel-id@group-id");
}
if (!Number.isInteger(rate) || rate < 0 || rate > 10_000) {
  throw new Error("REBATE_RATE_BPS 必须是 0 到 10000 的整数；3000 代表 30%");
}

try {
  const preview = [];
  for (const reference of references) {
    const channel = await db.channel.findUnique({
      where: { id_groupId: { id: reference.channelId, groupId: reference.groupId } },
      select: { id: true, groupId: true, name: true, channelType: true, rebateRateBps: true, _count: { select: { batches: true } } },
    });
    if (!channel) throw new Error(`找不到渠道 ${reference.channelId}@${reference.groupId}`);
    preview.push(channel);
  }

  console.table(preview.map((channel) => ({
    channelId: channel.id,
    groupId: channel.groupId,
    name: channel.name,
    currentType: channel.channelType,
    historicalBatches: channel._count.batches,
    nextRebateRate: `${(rate / 100).toFixed(2)}%`,
  })));

  if (process.env.CONFIRM_REBATE_BACKFILL !== "YES") {
    console.log("当前仅预览，没有修改数据。核对无误后增加 CONFIRM_REBATE_BACKFILL=YES 再执行。");
    process.exitCode = 2;
  } else if (process.env.CONFIRM_BACKUP_TAKEN !== "YES") {
    throw new Error("安全拦截：请先完成数据库备份，并设置 CONFIRM_BACKUP_TAKEN=YES 后再回填历史快照。");
  } else {
    await db.$transaction(async (client) => {
      for (const reference of references) {
        await client.channel.update({
          where: { id_groupId: { id: reference.channelId, groupId: reference.groupId } },
          data: { channelType: "REBATE", fanCostMode: "FREE", effectiveFanPriceCents: 0, rebateRateBps: rate },
        });
        await client.sourceBatch.updateMany({
          where: { channelId: reference.channelId, groupId: reference.groupId },
          data: { channelTypeSnapshot: "REBATE", fanCostModeSnapshot: "FREE", effectiveFanPriceCentsSnapshot: 0, rebateRateBpsSnapshot: rate },
        });
      }
    });
    console.log(`已回填 ${references.length} 个底料渠道及其历史批次快照。`);
  }
} finally {
  await db.$disconnect();
}
