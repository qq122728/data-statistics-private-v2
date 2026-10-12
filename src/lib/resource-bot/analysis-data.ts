import { db } from "../db";
import { parseSheetData } from "../resource-buyer-phones";
import { analyzeResources, type AnalysisRow } from "./analysis";
import { queryBounds, type ResourceQuery } from "./query";

export async function loadResourceAnalysis(q: ResourceQuery, today: string) {
  const range = queryBounds(q, today);
  if (!range) throw Error("资源分析需要指定日期范围");
  if (q.phone) throw Error("资源分析不支持单号筛选，请用号码详情查询");
  return db.$transaction(async tx => {
    // Production bot credentials are independently verified read-only on startup.
    const channels = await tx.channel.findMany({ where: { active: true, channelType: q.type === "ALL" ? { in: ["ADS", "SMS"] } : q.type, group: { active: true } }, select: { id: true, name: true, channelType: true, groupId: true, group: { select: { name: true } } } });
    const selected = channels.filter(c => !q.channel || c.name.toUpperCase() === q.channel.toUpperCase() || c.id === q.channel || c.id.endsWith(q.channel));
    if (q.channel && !selected.length) throw Error("找不到指定渠道，未扩大查询范围");
    if (q.channel && new Set(selected.map(c => c.id)).size > 1) throw Error("同名渠道有多个，请改用渠道编号查询");
    const ids = [...new Set(selected.map(c => c.id))], groups = [...new Set(selected.map(c => c.groupId))];
    const attrs = await tx.resourceBuyerPhone.findMany({ where: { channelId: { in: ids } }, include: { buyer: { select: { name: true } }, material: { select: { name: true } } }, take: 50001 });
    const raw = await tx.customerSheetRow.findMany({ where: { groupId: { in: groups } }, select: { id: true, phone: true, groupId: true, data: true }, take: 50001 });
    if ([attrs, raw].some(a => a.length > 50000)) throw Error("分析范围太大，请指定渠道后重试");
    const copies = new Map(selected.map(c => [c.id + "|" + c.groupId, c]));
    const live = raw.flatMap(r => { const data = parseSheetData(r.data); const channel = data && copies.get(data.channelId + "|" + r.groupId); return data && channel ? [{ ...r, data, channel }] : []; });
    const byPhone = new Map<string, typeof live>();
    for (const r of live) { const k = r.data.channelId + "|" + r.phone; byPhone.set(k, [...(byPhone.get(k) || []), r]); }
    const assignments = new Map<string, typeof attrs[number]>();
    const filter = (buyer: string, country: string, material: string) => (!q.buyer || q.buyer === buyer) && (!q.country || q.country === country) && (!q.material || q.material === material);
    let pending = 0, ambiguous = 0, importCount = 0;
    for (const a of attrs) {
      const matches = (byPhone.get(a.channelId + "|" + a.phone) || []).filter(r => !a.groupId || r.groupId === a.groupId);
      if (matches.length === 1) assignments.set(matches[0].id, a);
      if (a.sourceDate >= range.from && a.sourceDate <= range.to && filter(a.buyer.name, a.country, a.material?.name || "")) {
        importCount++; if (!matches.length) pending++; else if (matches.length > 1) ambiguous++;
      }
    }
    const rows: AnalysisRow[] = live.flatMap(r => {
      const a = assignments.get(r.id);
      if (!a) return [];
      if (!filter(a?.buyer.name || "", a?.country || "", a?.material?.name || "")) return [];
      return [{ id: r.id, phone: r.phone, group: r.channel.group.name, channel: r.channel.name, channelId: r.channel.id, type: r.channel.channelType, buyer: a?.buyer.name || "", country: a?.country || "", material: a?.material?.name || "", attributed: !!a, data: r.data }];
    });
    const completedThrough = range.to === today ? new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10) : range.to;
    const result = analyzeResources(rows, range, { pending, ambiguous, importCount, spendRecords: 0 }, completedThrough);
    return { ...result, scopeNote: "仅分析已按渠道和完整号码唯一匹配到投手或短信供应方的现有业务记录。" };
  }, { isolationLevel: "Serializable", timeout: 60000 });
}
