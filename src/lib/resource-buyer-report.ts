import type { buyerPhoneMetrics } from './resource-buyer-phones';
import type { SpendTotal } from '../../packages/resource-buyer/options';
type Dimensions = { buyerId: string; buyer: string; channelId: string; channel: string; country: string; materialId: string | null; material: string };
type Detail = Dimensions & { status: string; metrics: ReturnType<typeof buyerPhoneMetrics> | null };
type Spend = Dimensions & { currency: string; amountCents: number };
export type BuyerReportRow = Dimensions & { imported: number; matched: number; pending: number; ambiguous: number; valid: number; replied: number; joined: number; expert: number; registered: number; opened: number; firstCents: number; rechargeCents: number; withdrawalCents: number; legacyCents: number; netCents: number; spend: SpendTotal[] };
export function buyerReport(details: Detail[], spends: Spend[], byMaterial = false): BuyerReportRow[] {
  const rows = new Map<string, BuyerReportRow>();
  function get(item: Dimensions) {
    const key = JSON.stringify([item.channelId, item.buyerId, item.country, byMaterial ? item.materialId : '']);
    let row = rows.get(key);
    if (!row) {
      row = { ...item, imported: 0, matched: 0, pending: 0, ambiguous: 0, valid: 0, replied: 0, joined: 0, expert: 0, registered: 0, opened: 0, firstCents: 0, rechargeCents: 0, withdrawalCents: 0, legacyCents: 0, netCents: 0, spend: [] };
      rows.set(key, row);
    }
    return row;
  }
  for (const item of details) {
    if (byMaterial && !item.materialId) continue;
    const row = get(item); row.imported++;
    if (item.status === 'pending') row.pending++;
    if (item.status === 'ambiguous') row.ambiguous++;
    if (!item.metrics) continue;
    row.matched++;
    for (const field of ['valid', 'replied', 'joined', 'expert', 'registered', 'opened'] as const) if (item.metrics[field]) row[field]++;
    for (const field of ['firstCents', 'rechargeCents', 'withdrawalCents', 'legacyCents', 'netCents'] as const) row[field] += item.metrics[field];
  }
  for (const item of spends) {
    if (byMaterial && !item.materialId) continue;
    const row = get(item);
    const amount = row.spend.find(s => s.currency === item.currency);
    if (amount) amount.amountCents += item.amountCents;
    else row.spend.push({ currency: item.currency, amountCents: item.amountCents });
  }
  return [...rows.values()].sort((a,b) => b.imported - a.imported);
}
