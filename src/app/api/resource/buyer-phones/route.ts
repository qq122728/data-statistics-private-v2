import { isCountry } from "../../../../../packages/resource-buyer/options";
import { buyerReport } from "../../../../lib/resource-buyer-report";
import { NextResponse } from "next/server";
import { materialLink } from "../../../../lib/resource-material-link";
import ExcelJS from "exceljs";

import { buyerAccess, type BuyerAccess } from "../../../../lib/resource-buyer-access";
import { db } from "../../../../lib/db";
import { isCalendarDate } from "../../../../lib/dates";
import { recordAudit } from "../../../../lib/audit";
import { buyerPhoneMetrics, parseSheetData, phoneLines } from "../../../../lib/resource-buyer-phones";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "private, no-store" };
const MAX_PHONES = 2000;
function isResponse(value: BuyerAccess | NextResponse): value is NextResponse { return value instanceof NextResponse; }
function bad(error: string, status = 400) { return NextResponse.json({ error }, { status, headers: noStore }); }
function chunks<T>(items: T[], size = 400): T[][] { const result: T[][] = []; for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size)); return result; }

async function matchingRows(phones: string[], channels: BuyerAccess["channels"]) {
  const groups = [...new Set(channels.flatMap(channel => channel.groups.map(group => group.id)))];
  const matches = new Map<string, Array<{ id: string; groupId: string; data: NonNullable<ReturnType<typeof parseSheetData>> }>>();
  if (!groups.length) return matches;
  for (const part of chunks(phones)) {
    const rows = await db.customerSheetRow.findMany({ where: { groupId: { in: groups }, phone: { in: part } }, select: { id: true, groupId: true, phone: true, data: true } });
    for (const row of rows) {
      const data = parseSheetData(row.data);
      if (!data || typeof data.channelId !== "string" || !channels.some(channel => channel.id === data.channelId && channel.groups.some(group => group.id === row.groupId))) continue;
      const key = `${data.channelId}\u0000${row.phone}`;
      const found = matches.get(key) ?? [];
      found.push({ id: row.id, groupId: row.groupId, data });
      matches.set(key, found);
    }
  }
  return matches;
}

async function readNumbers(form: FormData) {
  const file = form.get("file");
  const pasted = String(form.get("numbers") ?? "");
  if (file instanceof File && file.size) {
    if (file.size > 2_000_000) throw new Error("文件不能超过 2 MB；请分批导入");
    if (/\.xlsx$/i.test(file.name)) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
      const sheet = workbook.worksheets[0];
      if (!sheet) throw new Error("Excel 文件没有工作表");
      const values: string[] = [];
      sheet.eachRow((row) => { values.push(String(row.getCell(1).text ?? "")); });
      return phoneLines(values.join("\n"));
    }
    if (!/\.(csv|txt)$/i.test(file.name)) throw new Error("只支持 .xlsx、.csv 或 .txt 文件");
    return phoneLines(await file.text());
  }
  return phoneLines(pasted);
}

export async function GET(request: Request) {
  const scope = await buyerAccess();
  if (isResponse(scope)) return scope;
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? new Date().toISOString().slice(0, 7);
  const channelId = params.get("channelId") ?? "";
  const detailBuyerId = params.get("detailBuyerId") ?? "";
  const detailMaterialId = params.get("detailMaterialId") ?? "";
  const country = params.get("country") ?? "";
  const detailCountry = params.get("detailCountry");
  if (country && country !== "unknown" && !isCountry(country)) return bad("国家不正确");
  if (detailCountry !== null && detailCountry !== "unknown" && !isCountry(detailCountry)) return bad("明细国家不正确");
  const countryWhere = country ? { country: country === "unknown" ? "" : country } : {};
  const detailPage = Number(params.get("detailPage") ?? "1");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return bad("月份不正确");
  if (!Number.isInteger(detailPage) || detailPage < 1 || detailPage > 100000 || detailBuyerId.length > 100 || detailMaterialId.length > 100) return bad("明细页码不正确");
  if (channelId && !scope.channelIds.includes(channelId)) return bad("该渠道不在当前账号权限内", 403);
  const channelIds = channelId ? [channelId] : scope.channelIds;
  const attributions = channelIds.length ? await db.resourceBuyerPhone.findMany({ where: { channelId: { in: channelIds }, sourceDate: { startsWith: month }, ...countryWhere }, include: { buyer: { select: { id: true, name: true } }, material: { select: { id: true, name: true, url: true } } }, orderBy: { sourceDate: "desc" } }) : [];
  const matches = await matchingRows(attributions.map(item => item.phone), scope.channels.filter(item => channelIds.includes(item.id)));
  const details = attributions.map(item => {
    const channel = scope.channels.find(c => c.id === item.channelId)!;
    const candidates = (matches.get(`${item.channelId}\u0000${item.phone}`) ?? []).filter(row => !item.groupId || row.groupId === item.groupId);
    const status = candidates.length === 0 ? "pending" : candidates.length > 1 ? "ambiguous" : "matched";
    const metrics = status === "matched" ? buyerPhoneMetrics(candidates[0].data) : null;
    return { id: item.id, phone: item.phone, country: item.country, sourceDate: item.sourceDate, buyerId: item.buyerId, buyer: item.buyer.name, materialId: item.materialId, material: item.material?.name ?? "", materialUrl: item.material?.url ?? "", channel: channel.name, groupId: item.groupId, groupName: channel.groups.find(group => group.id === item.groupId)?.name ?? "", channelId: item.channelId, status, metrics };
  });
  const expenses = channelIds.length ? await db.resourceBuyerSpend.findMany({where:{channelId:{in:channelIds},spendDate:{startsWith:month},...countryWhere},include:{buyer:{select:{name:true}},material:{select:{name:true}}},orderBy:[{spendDate:"desc"},{id:"asc"}]}) : [];
  const spends = expenses.map(item => ({...item, buyer:item.buyer.name, material:item.material?.name ?? "", channel:scope.channels.find(c=>c.id===item.channelId)!.name}));
  const summary = buyerReport(details, spends);
  const materialSummary = buyerReport(details, spends, true);
  const buyers = channelIds.length ? await db.trafficBuyer.findMany({ where: { channelId: { in: channelIds }, active: true }, select: { id: true, channelId: true, name: true }, orderBy: { name: "asc" } }) : [];
  const materials = channelIds.length ? await db.resourceBuyerMaterial.findMany({ where: { channelId: { in: channelIds } }, include: { buyer: { select: { name: true } } }, orderBy: [{ active: "desc" }, { name: "asc" }] }) : [];
  const scopedDetails = details.filter(item => (detailCountry === null || item.country === (detailCountry === "unknown" ? "" : detailCountry)) && (!detailBuyerId || item.buyerId === detailBuyerId) && (!detailMaterialId || item.materialId === detailMaterialId));
  const pageSize = 50;
  return NextResponse.json({ channels: scope.channels, buyers, materials, materialSummary, summary, spends: spends.map(({ entryKey: _key, createdById: _actor, ...item }) => item), details: scopedDetails.slice((detailPage - 1) * pageSize, detailPage * pageSize), detailTotal: scopedDetails.length, detailPage, detailPages: Math.max(1, Math.ceil(scopedDetails.length / pageSize)), month }, { headers: noStore });
}

export async function POST(request: Request) {
  const scope = await buyerAccess();
  if (isResponse(scope)) return scope;
  if (!scope.canWrite) return bad("总管理员可查看全部投手数据；导入请由对应资源负责人操作", 403);
  if (Number(request.headers.get("content-length") || 0) > 2_500_000) return bad("导入内容不能超过 2.5 MB，请分批导入", 413);
  let form: FormData;
  try { form = await request.formData(); }
  catch { return bad("请提交号码或文件"); }
  const action = String(form.get("action") ?? "preview");
  const channelId = String(form.get("channelId") ?? "");
  const buyerName = String(form.get("buyer") ?? "").trim();
  const channel = scope.channels.find(item => item.id === channelId);
  if (!channel) return bad("请选择有权限的渠道", 403);
  if (!buyerName || buyerName.length > 100) return bad("投手姓名需要填写，最多 100 个字");
  if (action === "material-create") {
    if (channel.channelType !== "ADS") return bad("素材管理仅适用于投流渠道");
    const name = String(form.get("materialName") ?? "").trim();
    if (!name || name.length > 100) return bad("素材名称需要填写，最多 100 个字");
    let url: string | null;
    try { url = materialLink(form.get("materialUrl")); }
    catch (error) { return bad(error instanceof Error ? error.message : "素材链接不正确"); }
    try {
      const material = await db.$transaction(async tx => {
        const buyer = await tx.trafficBuyer.upsert({ where: { channelId_name: { channelId, name: buyerName } }, update: { active: true }, create: { channelId, name: buyerName } });
        const created = await tx.resourceBuyerMaterial.create({ data: { channelId, buyerId: buyer.id, name, url, createdById: scope.actorId } });
        await recordAudit(tx, { actorId: scope.actorId, action: "RESOURCE_BUYER_MATERIAL_CREATED", entityType: "ResourceBuyerMaterial", entityId: created.id, summary: { channelId, buyer: buyerName, name, hasLink: Boolean(url) } });
        return created;
      });
      return NextResponse.json({ material }, { status: 201, headers: noStore });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") return bad("这个投手已有同名素材", 409);
      throw error;
    }
  }
  const country = String(form.get("country") ?? "");
  if (!isCountry(country)) return bad("请选择本批号码的国家");
  const sourceDate = String(form.get("sourceDate") ?? "");
  const groupId = String(form.get("groupId") ?? "");
  const materialId = String(form.get("materialId") ?? "");
  if (groupId && !channel.groups.some(group => group.id === groupId)) return bad("小组不属于该渠道", 403);
  if (!isCalendarDate(sourceDate)) return bad("批次日期不正确");
  if (action !== "preview" && action !== "commit") return bad("操作不正确");
  if (materialId) {
    if (channel.channelType !== "ADS") return bad("短信渠道不使用投流素材");
    const material = await db.resourceBuyerMaterial.findUnique({ where: { id: materialId }, include: { buyer: { select: { name: true } } } });
    if (!material?.active || material.channelId !== channelId || material.buyer.name !== buyerName) return bad("请选择当前渠道和投手名下的有效素材", 403);
  }
  if (String(form.get("numbers") ?? "").length > 150_000) return bad("粘贴内容过长，请分批导入", 413);
  let parsed;
  try { parsed = await readNumbers(form); }
  catch (error) { return bad(error instanceof Error ? error.message : "号码文件无法读取"); }
  if (parsed.phones.length === 0) return bad("请填写至少一个完整号码");
  if (parsed.phones.length > MAX_PHONES) return bad(`一次最多导入 ${MAX_PHONES} 个号码，请分批导入`);
  const existing = await db.resourceBuyerPhone.findMany({ where: { channelId, phone: { in: parsed.phones } }, include: { buyer: { select: { name: true } } } });
  const byPhone = new Map(existing.map(item => [item.phone, item]));
  const matches = await matchingRows(parsed.phones, [channel]);
  const rows = parsed.phones.map(phone => {
    const stored = byPhone.get(phone);
    const matched = (matches.get(`${channelId}\u0000${phone}`) ?? []).filter(row => !groupId || row.groupId === groupId);
    const status = stored
      ? stored.buyer.name !== buyerName || (stored.country && stored.country !== country) || (stored.groupId && groupId && stored.groupId !== groupId) || (stored.materialId && materialId && stored.materialId !== materialId)
        ? "conflict" : (groupId && !stored.groupId) || (materialId && !stored.materialId) || !stored.country ? "resolve" : "already"
      : matched.length > 1 ? "ambiguous" : matched.length ? "matched" : "pending";
    return { phone, status, existingBuyer: stored?.buyer.name ?? null };
  });
  const counts = Object.fromEntries(["matched", "pending", "ambiguous", "already", "resolve", "conflict"].map(status => [status, rows.filter(row => row.status === status).length]));
  if (action === "preview") return NextResponse.json({ counts, invalid: parsed.invalid.slice(0, 30), invalidCount: parsed.invalid.length, duplicateCount: parsed.duplicates, skippedHeaders: parsed.skippedHeaders, total: rows.length, rows: rows.slice(0, 100) }, { headers: noStore });
  if (parsed.invalid.length || counts.conflict || counts.ambiguous) return bad("包含无效、归属冲突或跨小组重号；请先处理预览提示，再保存", 409);
  const ready = rows.filter(row => row.status === "matched" || row.status === "pending");
  if (!ready.length && !counts.resolve) return NextResponse.json({ saved: 0, skipped: counts.already, resolved: 0, pending: 0 }, { headers: noStore });
  try {
    const result = await db.$transaction(async tx => {
      const buyer = await tx.trafficBuyer.upsert({ where: { channelId_name: { channelId, name: buyerName } }, update: { active: true }, create: { channelId, name: buyerName } });
      if (ready.length) await tx.resourceBuyerPhone.createMany({ data: ready.map(row => ({ channelId, buyerId: buyer.id, materialId: materialId || null, phone: row.phone, country, sourceDate, groupId: groupId || null, createdById: scope.actorId })) });
      for (const row of rows.filter(row => row.status === "resolve")) {
        const stored = byPhone.get(row.phone)!;
        await tx.resourceBuyerPhone.update({ where: { id: stored.id }, data: { ...(!stored.country ? { country } : {}), ...(groupId && !stored.groupId ? { groupId } : {}), ...(materialId && !stored.materialId ? { materialId } : {}) } });
      }
      await recordAudit(tx, { actorId: scope.actorId, action: "RESOURCE_BUYER_PHONES_IMPORT", entityType: "ResourceBuyerPhone", entityId: buyer.id, summary: { channelId, buyer: buyerName, country, materialId: materialId || null, groupId: groupId || null, sourceDate, saved: ready.length, resolved: counts.resolve, pending: counts.pending, skipped: counts.already } });
      return { saved: ready.length, skipped: counts.already, resolved: counts.resolve, pending: counts.pending };
    }, { timeout: 30000 });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return bad("其他人刚导入了相同号码，请重新预览", 409);
    throw error;
  }
}

export async function PATCH(request: Request) {
  const scope = await buyerAccess();
  if (isResponse(scope)) return scope;
  if (!scope.canWrite) return bad("只有对应资源负责人可以修改素材", 403);
  let input: { materialId?: unknown; name?: unknown; url?: unknown; active?: unknown };
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("请提交有效的素材资料");
    input = parsed;
  }
  catch { return bad("请提交有效的素材资料"); }
  const materialId = String(input.materialId ?? "");
  const material = await db.resourceBuyerMaterial.findUnique({ where: { id: materialId } });
  if (!material || !scope.channelIds.includes(material.channelId)) return bad("素材不在当前账号授权范围内", 403);
  const name = String(input.name ?? material.name).trim();
  if (!name || name.length > 100) return bad("素材名称需要填写，最多 100 个字");
  let url: string | null;
  try { url = materialLink(input.url === undefined ? material.url : input.url); }
  catch (error) { return bad(error instanceof Error ? error.message : "素材链接不正确"); }
  if (input.active !== undefined && typeof input.active !== "boolean") return bad("素材状态不正确");
  try {
    const updated = await db.$transaction(async tx => {
      const saved = await tx.resourceBuyerMaterial.update({ where: { id: material.id }, data: { name, url, active: typeof input.active === "boolean" ? input.active : material.active } });
      await recordAudit(tx, { actorId: scope.actorId, action: "RESOURCE_BUYER_MATERIAL_UPDATED", entityType: "ResourceBuyerMaterial", entityId: material.id, summary: { channelId: material.channelId, name, active: saved.active, hasLink: Boolean(url) } });
      return saved;
    });
    return NextResponse.json({ material: updated }, { headers: noStore });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return bad("这个投手已有同名素材", 409);
    throw error;
  }
}
