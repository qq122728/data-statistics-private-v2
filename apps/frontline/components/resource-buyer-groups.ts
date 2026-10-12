import type { EffectRow } from './resource-buyer-format';

const metrics = ['imported', 'matched', 'pending', 'ambiguous', 'valid', 'replied', 'joined', 'expert', 'registered', 'opened', 'firstCents', 'rechargeCents', 'withdrawalCents', 'legacyCents', 'netCents'] as const;
export const buyerGroupKey = (row: EffectRow) => JSON.stringify([row.channelId, row.buyerId]);

export function sumEffects(rows: EffectRow[]): EffectRow {
  const total: EffectRow = { buyerId: rows[0]?.buyerId ?? '', buyer: rows[0]?.buyer ?? '', channelId: rows[0]?.channelId ?? '', channel: rows[0]?.channel ?? '', country: '', materialId: null, material: '', imported: 0, matched: 0, pending: 0, ambiguous: 0, valid: 0, replied: 0, joined: 0, expert: 0, registered: 0, opened: 0, firstCents: 0, rechargeCents: 0, withdrawalCents: 0, legacyCents: 0, netCents: 0, spend: [] };
  const spend = new Map<string, number>();
  for (const row of rows) {
    for (const metric of metrics) total[metric] += row[metric];
    for (const item of row.spend) spend.set(item.currency, (spend.get(item.currency) ?? 0) + item.amountCents);
  }
  total.spend = [...spend].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountCents]) => ({ currency, amountCents }));
  return total;
}

export function groupBuyerEffects(rows: EffectRow[]) {
  const groups = new Map<string, EffectRow[]>();
  for (const row of rows) {
    const key = buyerGroupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups].map(([key, children]) => ({ key, total: sumEffects(children), children: children.sort((a, b) => b.imported - a.imported || a.country.localeCompare(b.country)) }))
    .sort((a, b) => b.total.imported - a.total.imported || a.total.buyer.localeCompare(b.total.buyer, 'zh-CN'));
}

export function normalizeResourceMonth(value: string) {
  const match = /^(\d{4})-(\d{1,2})$/.exec(value.trim());
  return match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? `${match[1]}-${match[2].padStart(2, '0')}` : null;
}
