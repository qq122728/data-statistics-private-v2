import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { buyerAccess } from '../../../../lib/resource-buyer-access';
import { db } from '../../../../lib/db';
import { isCalendarDate } from '../../../../lib/dates';
import { recordAudit } from '../../../../lib/audit';
import { CURRENCIES, isCountry, parseSpendCents } from '../../../../../packages/resource-buyer/options';
const headers = { 'Cache-Control': 'private, no-store' };
const bad = (error: string, status = 400) => NextResponse.json({error}, {status, headers});
export async function POST(request: Request) {
  const scope = await buyerAccess();
  if (scope instanceof NextResponse) return scope;
  if (!scope.canWrite) return bad('只有对应资源负责人可以登记消耗', 403);
  let input;
  try { input = await request.json(); } catch { return bad('请提交有效的消耗资料'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('请提交有效的消耗资料');
  const { channelId, country, spendDate, currency } = input;
  const buyerName = typeof input.buyer === 'string' ? input.buyer.trim() : '';
  const materialId = typeof input.materialId === 'string' ? input.materialId : '';
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  const amountCents = parseSpendCents(input.amount);
  if (typeof channelId !== 'string' || !scope.channelIds.includes(channelId)) return bad('请选择有权限的渠道', 403);
  if (!buyerName || buyerName.length > 100) return bad('投手或供粉方需要填写，最多 100 个字');
  if (!isCountry(country)) return bad('请选择国家');
  if (typeof spendDate !== 'string' || !isCalendarDate(spendDate)) return bad('消耗日期不正确');
  if (!CURRENCIES.includes(currency)) return bad('请选择支持的币种');
  if (amountCents === null) return bad('金额需为非负数，最多两位小数且不超过 20,000,000');
  if (note.length > 300) return bad('备注最多 300 个字');
  if (materialId) {
    const material = await db.resourceBuyerMaterial.findUnique({where:{id:materialId},include:{buyer:{select:{name:true}}}});
    if (!material || material.channelId !== channelId || material.buyer.name !== buyerName) return bad('素材不属于这个渠道和投手',403);
  }
  const result = await db.$transaction(async tx => {
    const buyer = await tx.trafficBuyer.upsert({where:{channelId_name:{channelId,name:buyerName}},update:{active:true},create:{channelId,name:buyerName}});
    const entryKey = createHash('sha256').update(JSON.stringify([channelId,buyer.id,country,spendDate,materialId,currency])).digest('hex');
    const prior = await tx.resourceBuyerSpend.findUnique({where:{entryKey}});
    const entry = await tx.resourceBuyerSpend.upsert({where:{entryKey},update:{amountCents,note},create:{entryKey,channelId,buyerId:buyer.id,country,spendDate,materialId:materialId || null,currency,amountCents,note,createdById:scope.actorId}});
    await recordAudit(tx,{actorId:scope.actorId,action:'RESOURCE_BUYER_SPEND_SAVED',entityType:'ResourceBuyerSpend',entityId:entry.id,summary:{channelId,country,spendDate,currency,buyer:buyerName,materialId:materialId || null,amountCents,previousAmountCents:prior?.amountCents ?? null}});
    return {entry,updated:!!prior};
  });
  return NextResponse.json(result,{headers});
}
