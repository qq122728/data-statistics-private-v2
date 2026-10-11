import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { bossOrderGroups, bossOrderQuerySchema, renderBossOrderQuery } from "../../../../lib/boss-order-query";
import { db } from "../../../../lib/db";
import { readLimitedJson, RequestBodyTooLargeError, tooLargeResponse } from "../../../../lib/request-limits";
import { statisticsDate } from "../../../../lib/statistics-date";

export const runtime = "nodejs";
let requestWindow = { startedAt: 0, count: 0 };

function authorized(request: Request) {
  const secret = process.env.BOSS_ORDER_QUERY_TOKEN;
  if (!secret || secret.length < 32) return false;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** The Telegram boss tool uses this read-only route. It never accepts browser sessions. */
export async function POST(request: Request) {
  if (!process.env.BOSS_ORDER_QUERY_TOKEN || process.env.BOSS_ORDER_QUERY_TOKEN.length < 32)
    return NextResponse.json({ error: "机器人查询未配置" }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "未授权" }, { status: 401 });
  const now = Date.now();
  if (now - requestWindow.startedAt >= 60_000) requestWindow = { startedAt: now, count: 0 };
  if (++requestWindow.count > 30)
    return NextResponse.json({ error: "查询太频繁，请一分钟后再试" }, { status: 429, headers: { "Retry-After": "60" } });
  try {
    const query = bossOrderQuerySchema.parse(await readLimitedJson(request, 4 * 1024));
    const phoneDigits = query.phone?.replace(/\D/g, "") ?? "";
    if ((query.view === "phone" || query.phone) && (phoneDigits.length < 6 || phoneDigits.length > 15))
      return NextResponse.json({ error: "请提供至少 6 位、最多 15 位的客户号码或尾号" }, { status: 400 });
    const groups = await db.teamGroup.findMany({
      select: { id: true, name: true, active: true, groupType: true, countryCode: true,
        department: { select: { name: true, countryCode: true } } },
    });
    const selected = bossOrderGroups(groups, query.group);
    const [channels, sheetRows, legacyOrders] = await Promise.all([
      db.channel.findMany({ select: { id: true, groupId: true, name: true } }),
      db.customerSheetRow.findMany({
        where: query.view === "phone"
          ? { phone: { endsWith: phoneDigits } }
          : { data: { contains: '"firstDepositOn"' } },
        select: { id: true, groupId: true, phone: true, data: true },
      }),
      db.customerOrder.findMany({
        where: { voidedAt: null, ...(query.view === "phone" ? { phone: { endsWith: phoneDigits } } : {}) },
        select: { id: true, phone: true, openedOn: true, initialDepositCents: true,
          batch: { select: { groupId: true, channelId: true, sourceDate: true } } },
      }),
    ]);
    const result = renderBossOrderQuery({ query, today: statisticsDate(), groups: selected, channels, sheetRows, legacyOrders });
    console.info("boss-order-query", { view: query.view, groupCount: selected.length, resultCount: result.count, page: result.page });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
    if (error instanceof z.ZodError) return NextResponse.json({ error: "查询参数不正确" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "查询内容不是有效 JSON" }, { status: 400 });
    if (error instanceof Error && /^(请|开始日期|查询日期|未找到|名称对应)/.test(error.message))
      return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("boss-order-query-failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "查询失败，请稍后再试" }, { status: 500 });
  }
}
