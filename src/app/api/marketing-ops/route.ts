import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAudit } from "../../../lib/audit";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { db } from "../../../lib/db";
import { isCalendarDate } from "../../../lib/dates";
import { hasAssignedRole } from "../../../lib/role-access";
import { API_LIMITS, readLimitedJson, RequestBodyTooLargeError, tooLargeResponse } from "../../../lib/request-limits";
import { authorizationDenied } from "../../../lib/security-events";

// 在数据库迁移获准并执行前，Prisma Client 不会生成这些模型的方法。
// 这里的窄适配层让新接口可以先和数据模型一起完成代码审查；迁移后运行 prisma generate 即可接通。
type MarketingStore = Record<string, any>;
const marketingDb = db as unknown as MarketingStore;

const sourceType = z.enum(["ADS", "SMS"]);
const text = (label: string, maximum = 100) => z.string().trim().min(1, `请填写${label}`).max(maximum, `${label}不能超过${maximum}个字`);
const optionalText = (maximum = 100) => z.string().trim().max(maximum, `内容不能超过${maximum}个字`).optional().transform((value) => value || null);
const id = z.string().trim().min(1, "请选择关联项").max(API_LIMITS.identifierCharacters, "关联项不正确");
const count = z.number().int().min(0, "数量不能小于 0").max(1_000_000_000, "数量过大");
const moneyCents = z.number().int().min(0, "金额不能小于 0").max(1_000_000_000_000, "金额过大");

const createSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("buyer"), channelId: id, name: text("投手姓名"), employeeCode: optionalText(50) }),
  z.object({ kind: z.literal("adAccount"), channelId: id, name: text("广告账户名称"), platform: text("投放平台", 50), externalCode: optionalText(100), buyerId: id.optional() }),
  z.object({ kind: z.literal("campaign"), channelId: id, name: text("广告计划名称"), externalCode: optionalText(100), adAccountId: id }),
  z.object({ kind: z.literal("creative"), channelId: id, name: text("素材名称"), externalCode: optionalText(100), campaignId: id }),
  z.object({ kind: z.literal("vendor"), channelId: id, name: text("粉商名称"), contactName: optionalText(100) }),
  z.object({ kind: z.literal("smsBatch"), channelId: id, name: text("短信批次名称"), externalCode: optionalText(100), vendorId: id, sentOn: z.string().refine(isCalendarDate, "发送日期必须是实际存在的 YYYY-MM-DD").optional().transform((value) => value || null) }),
  z.object({ kind: z.literal("attribution"), channelId: id, sourceType, name: text("归因名称"), trafficBuyerId: id.optional(), adAccountId: id.optional(), adCampaignId: id.optional(), creativeAssetId: id.optional(), smsVendorId: id.optional(), smsBatchId: id.optional() }),
  z.object({ kind: z.literal("daily"), businessDate: z.string().refine(isCalendarDate, "日期必须是实际存在的 YYYY-MM-DD"), attributionId: id, spendCents: moneyCents, sentCount: count, deliveredCount: count, fansCount: count, validFansCount: count, conversionCount: count, note: optionalText(300) }),
  z.object({ kind: z.literal("dailyImport"), rows: z.array(z.object({ businessDate: z.string().refine(isCalendarDate, "日期必须是实际存在的 YYYY-MM-DD"), attributionId: id, spendCents: moneyCents, sentCount: count, deliveredCount: count, fansCount: count, validFansCount: count, conversionCount: count, note: optionalText(300) })).min(1, "请至少填写一行").max(API_LIMITS.batchRows, `一次最多导入 ${API_LIMITS.batchRows} 行`) }),
]);

const patchSchema = z.object({
  kind: z.enum(["buyer", "adAccount", "campaign", "creative", "vendor", "smsBatch", "attribution"]),
  id,
  active: z.boolean(),
});

type MarketingAccess = { actor: Awaited<ReturnType<typeof requireUser>>; channelIds: string[]; canWrite: boolean };

async function getAccess(): Promise<MarketingAccess | NextResponse> {
  let actor;
  try { actor = await requireUser(); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  const isHeadquarters = actor.role === "ADMIN" || actor.duty === "HQ_MANAGER";
  const isFinance = hasAssignedRole(actor, "FINANCE");
  const isResource = hasAssignedRole(actor, "RESOURCE_MANAGER");
  if (!actor.active || (!isHeadquarters && !isFinance && !isResource))
    return authorizationDenied(actor, "只有总公司管理员、资源部或财务账号可以查看投流与短信粉运营账");
  // 运营账现在按渠道目录存放，而同一渠道可在多个小组复用；不能可靠地排除某一小组。
  // 因此受小组限制的财务账号在运营账完成按小组归属前不开放此入口，避免越权泄露。
  if (isFinance && actor.financeScopeConfigured)
    return authorizationDenied(actor, "该财务账号受小组范围限制，暂不能查看未按小组拆分的投流与短信运营账");

  const rows = await db.channel.findMany({
    where: isHeadquarters || isFinance ? { active: true } : { active: true, id: { in: actor.resourceChannelAccess?.map((item) => item.channelId) ?? [] } },
    select: { id: true },
  });
  return { actor, channelIds: [...new Set(rows.map((row) => row.id))], canWrite: isHeadquarters || isResource };
}

function isResponse(value: MarketingAccess | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

async function assertScopedEntity(store: MarketingStore, entity: string, entityId: string, channelId: string) {
  const row = await store[entity].findUnique({ where: { id: entityId }, select: { id: true, channelId: true } });
  if (!row || row.channelId !== channelId) throw new Error("关联项不存在，或不属于当前渠道");
  return row;
}

function errorResponse(error: unknown, actor: Awaited<ReturnType<typeof requireUser>> | null = null) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "填写内容不正确" }, { status: 400 });
  if (error instanceof RequestBodyTooLargeError) return tooLargeResponse(error);
  if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
  if (error instanceof Error && error.message.includes("关联项")) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ error: "同一渠道下已有同名记录" }, { status: 409 });
  if (actor && error instanceof Error && error.message === "没有写入权限") return authorizationDenied(actor, "财务账号只能查看，不能修改运营账");
  throw error;
}

export async function GET(request: Request) {
  const access = await getAccess();
  if (isResponse(access)) return access;
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || "0000-01-01";
  const to = params.get("to") || "9999-12-31";
  if ((params.get("from") && !isCalendarDate(from)) || (params.get("to") && !isCalendarDate(to))) return NextResponse.json({ error: "日期必须是实际存在的 YYYY-MM-DD" }, { status: 400 });
  const requestedChannel = params.get("channelId");
  const channelIds = requestedChannel ? access.channelIds.filter((item) => item === requestedChannel) : access.channelIds;
  if (requestedChannel && !channelIds.length) return authorizationDenied(access.actor, "该渠道不在你的授权范围内");

  const channelCopies = await db.channel.findMany({ where: { id: { in: channelIds }, active: true }, select: { id: true, name: true, channelType: true } });
  const channelMap = new Map<string, { id: string; name: string; channelType: string }>();
  for (const channel of channelCopies) if (!channelMap.has(channel.id)) channelMap.set(channel.id, channel);
  const scope = { channelId: { in: channelIds } };
  const [buyers, adAccounts, campaigns, creatives, vendors, smsBatches, attributions, entries] = await Promise.all([
    marketingDb.trafficBuyer.findMany({ where: scope, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    marketingDb.adAccount.findMany({ where: scope, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    marketingDb.adCampaign.findMany({ where: scope, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    marketingDb.creativeAsset.findMany({ where: scope, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    marketingDb.smsVendor.findMany({ where: scope, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    marketingDb.smsBatch.findMany({ where: scope, orderBy: [{ sentOn: "desc" }, { name: "asc" }] }),
    marketingDb.marketingAttribution.findMany({ where: scope, include: { trafficBuyer: true, adAccount: true, adCampaign: true, creativeAsset: true, smsVendor: true, smsBatch: true }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    marketingDb.marketingDailyEntry.findMany({ where: { businessDate: { gte: from, lte: to }, attribution: scope }, include: { attribution: { include: { trafficBuyer: true, creativeAsset: true, smsVendor: true } } }, orderBy: [{ businessDate: "desc" }, { updatedAt: "desc" }] }),
  ]);

  const totals = entries.reduce((sum: Record<string, number>, row: any) => {
    for (const key of ["spendCents", "sentCount", "deliveredCount", "fansCount", "validFansCount", "conversionCount"]) sum[key] += Number(row[key] ?? 0);
    return sum;
  }, { spendCents: 0, sentCount: 0, deliveredCount: 0, fansCount: 0, validFansCount: 0, conversionCount: 0 });
  const rank = (type: "creative" | "vendor") => {
    const grouped = new Map<string, Record<string, any>>();
    for (const row of entries) {
      const item = type === "creative" ? row.attribution.creativeAsset : row.attribution.smsVendor;
      if (!item) continue;
      const current = grouped.get(item.id) ?? { id: item.id, name: item.name, channelId: row.attribution.channelId, spendCents: 0, sentCount: 0, deliveredCount: 0, fansCount: 0, validFansCount: 0, conversionCount: 0 };
      for (const key of ["spendCents", "sentCount", "deliveredCount", "fansCount", "validFansCount", "conversionCount"]) current[key] += Number(row[key] ?? 0);
      grouped.set(item.id, current);
    }
    return ([...grouped.values()].map((item) => ({ ...item, validRate: item.fansCount ? item.validFansCount / item.fansCount : 0, deliveryRate: item.sentCount ? item.deliveredCount / item.sentCount : 0 })) as Array<Record<string, number | string>>)
      .sort((left, right) => Number(right.validRate) - Number(left.validRate) || Number(right.validFansCount) - Number(left.validFansCount));
  };

  return NextResponse.json({
    canWrite: access.canWrite,
    channels: [...channelMap.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    buyers, adAccounts, campaigns, creatives, vendors, smsBatches, attributions, entries,
    dashboard: { totals, creativeRanking: rank("creative"), vendorRanking: rank("vendor") },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const access = await getAccess();
  if (isResponse(access)) return access;
  if (!access.canWrite) return authorizationDenied(access.actor, "财务账号只能查看，不能修改运营账");
  try {
    const input = createSchema.parse(await readLimitedJson(request, API_LIMITS.batchBodyBytes));
    const client = db as unknown as MarketingStore;
    const assertChannel = (channelId: string) => {
      if (!access.channelIds.includes(channelId)) throw new Error("关联项不存在，或不属于当前渠道");
    };
    let result: any;
    if (input.kind === "buyer") { assertChannel(input.channelId); const { kind: _kind, ...data } = input; result = await client.trafficBuyer.create({ data }); }
    if (input.kind === "adAccount") { assertChannel(input.channelId); if (input.buyerId) await assertScopedEntity(client, "trafficBuyer", input.buyerId, input.channelId); const { kind: _kind, ...data } = input; result = await client.adAccount.create({ data }); }
    if (input.kind === "campaign") { assertChannel(input.channelId); await assertScopedEntity(client, "adAccount", input.adAccountId, input.channelId); const { kind: _kind, ...data } = input; result = await client.adCampaign.create({ data }); }
    if (input.kind === "creative") { assertChannel(input.channelId); await assertScopedEntity(client, "adCampaign", input.campaignId, input.channelId); const { kind: _kind, ...data } = input; result = await client.creativeAsset.create({ data }); }
    if (input.kind === "vendor") { assertChannel(input.channelId); const { kind: _kind, ...data } = input; result = await client.smsVendor.create({ data }); }
    if (input.kind === "smsBatch") { assertChannel(input.channelId); await assertScopedEntity(client, "smsVendor", input.vendorId, input.channelId); const { kind: _kind, ...data } = input; result = await client.smsBatch.create({ data }); }
    if (input.kind === "attribution") {
      assertChannel(input.channelId);
      const links = [["trafficBuyer", input.trafficBuyerId], ["adAccount", input.adAccountId], ["adCampaign", input.adCampaignId], ["creativeAsset", input.creativeAssetId], ["smsVendor", input.smsVendorId], ["smsBatch", input.smsBatchId]] as const;
      for (const [entity, entityId] of links) if (entityId) await assertScopedEntity(client, entity, entityId, input.channelId);
      if (input.sourceType === "ADS" && !input.creativeAssetId) return NextResponse.json({ error: "投流归因至少要关联一个素材" }, { status: 400 });
      if (input.sourceType === "SMS" && !input.smsBatchId) return NextResponse.json({ error: "短信归因至少要关联一个短信批次" }, { status: 400 });
      const { kind: _kind, ...data } = input;
      result = await client.marketingAttribution.create({ data });
    }
    if (input.kind === "daily") {
      const attribution = await client.marketingAttribution.findUnique({ where: { id: input.attributionId }, select: { channelId: true } });
      if (!attribution || !access.channelIds.includes(attribution.channelId)) throw new Error("关联项不存在，或不属于当前渠道");
      const { kind: _kind, ...data } = input;
      result = await client.marketingDailyEntry.upsert({ where: { businessDate_attributionId: { businessDate: input.businessDate, attributionId: input.attributionId } }, create: { ...data, createdById: access.actor.id }, update: { spendCents: input.spendCents, sentCount: input.sentCount, deliveredCount: input.deliveredCount, fansCount: input.fansCount, validFansCount: input.validFansCount, conversionCount: input.conversionCount, note: input.note, createdById: access.actor.id } });
    }
    if (input.kind === "dailyImport") {
      const duplicateRows = new Set<string>();
      for (const row of input.rows) {
        const key = `${row.businessDate}\u0000${row.attributionId}`;
        if (duplicateRows.has(key)) return NextResponse.json({ error: "导入文件里同一天、同一归因只能有一行" }, { status: 400 });
        duplicateRows.add(key);
      }
      const attributionIds = [...new Set(input.rows.map((row) => row.attributionId))];
      const attributions = await client.marketingAttribution.findMany({ where: { id: { in: attributionIds } }, select: { id: true, channelId: true } });
      if (attributions.length !== attributionIds.length || attributions.some((item: any) => !access.channelIds.includes(item.channelId))) throw new Error("关联项不存在，或不属于当前渠道");
      result = await Promise.all(input.rows.map((row) => client.marketingDailyEntry.upsert({ where: { businessDate_attributionId: { businessDate: row.businessDate, attributionId: row.attributionId } }, create: { ...row, createdById: access.actor.id }, update: { spendCents: row.spendCents, sentCount: row.sentCount, deliveredCount: row.deliveredCount, fansCount: row.fansCount, validFansCount: row.validFansCount, conversionCount: row.conversionCount, note: row.note, createdById: access.actor.id } })));
    }
    await recordAudit(db, { actorId: access.actor.id, action: input.kind === "dailyImport" ? "MARKETING_DAILY_IMPORTED" : "MARKETING_OPS_CREATED", entityType: input.kind, entityId: Array.isArray(result) ? `import:${result.length}` : result.id, summary: { kind: input.kind, rowCount: Array.isArray(result) ? result.length : 1 } });
    return NextResponse.json({ result }, { status: input.kind === "dailyImport" ? 200 : 201 });
  } catch (error) { return errorResponse(error, access.actor); }
}

export async function PATCH(request: Request) {
  const access = await getAccess();
  if (isResponse(access)) return access;
  if (!access.canWrite) return authorizationDenied(access.actor, "财务账号只能查看，不能修改运营账");
  try {
    const input = patchSchema.parse(await readLimitedJson(request, API_LIMITS.batchBodyBytes));
    const entity = ({ buyer: "trafficBuyer", adAccount: "adAccount", campaign: "adCampaign", creative: "creativeAsset", vendor: "smsVendor", smsBatch: "smsBatch", attribution: "marketingAttribution" } as const)[input.kind];
    const current = await marketingDb[entity].findUnique({ where: { id: input.id }, select: { channelId: true } });
    if (!current || !access.channelIds.includes(current.channelId)) return authorizationDenied(access.actor, "该记录不在你的授权范围内");
    const result = await marketingDb[entity].update({ where: { id: input.id }, data: { active: input.active } });
    await recordAudit(db, { actorId: access.actor.id, action: "MARKETING_OPS_STATUS_CHANGED", entityType: input.kind, entityId: input.id, summary: { active: input.active } });
    return NextResponse.json({ result });
  } catch (error) { return errorResponse(error, access.actor); }
}
