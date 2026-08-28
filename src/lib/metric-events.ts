import type { Prisma, PrismaClient, Position } from "@prisma/client";

type MetricEventClient = Pick<PrismaClient, "userPosition" | "metricEvent"> | Prisma.TransactionClient;

/**
 * 查 userId 当下持有的 UserPosition 有效行（effectiveTo 为空的那一条），不查
 * User.role 这种活字段。UserPosition 目前只有 transferUserPosition 一个写入方，
 * 大多数账号还没有任何记录，这时返回 null 属正常，不是错误。
 */
export async function currentActingPosition(client: MetricEventClient, userId: string): Promise<Position | null> {
  const row = await client.userPosition.findFirst({
    where: { userId, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
    select: { position: true },
  });
  return row?.position ?? null;
}

/**
 * 所有 MetricEvent 写入必须经过这个函数，禁止直接 metricEvent.create（需求文档1.6）。
 * actingPosition 冻结的是 enteredById 这个人写入当下持有的岗位，不是"事件发生时"
 * 的岗位——历史修正/补录这类事件的 occurredOn 可能早于今天，但落笔动作发生在现在。
 */
export async function recordMetricEvent(
  client: MetricEventClient,
  data: Omit<Prisma.MetricEventUncheckedCreateInput, "actingPosition">,
) {
  const actingPosition = await currentActingPosition(client, data.enteredById);
  return client.metricEvent.create({ data: { ...data, actingPosition } });
}

/** createMany 版本：批内多笔事件常见于同一个人一次操作产生的多条 kind，逐个 enteredById 去重查一次岗位即可。 */
export async function recordMetricEvents(
  client: MetricEventClient,
  data: Omit<Prisma.MetricEventUncheckedCreateInput, "actingPosition">[],
) {
  if (data.length === 0) return { count: 0 };
  const actorIds = [...new Set(data.map((row) => row.enteredById))];
  const positions = new Map(await Promise.all(
    actorIds.map(async (id) => [id, await currentActingPosition(client, id)] as const),
  ));
  return client.metricEvent.createMany({
    data: data.map((row) => ({ ...row, actingPosition: positions.get(row.enteredById) ?? null })),
  });
}
