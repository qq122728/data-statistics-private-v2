import type { SpendTotal } from '../../../packages/resource-buyer/options';
export type EffectRow = { buyerId: string; buyer: string; channelId: string; channel: string; country: string; materialId?: string | null; material?: string; imported: number; matched: number; pending: number; ambiguous: number; valid: number; replied: number; joined: number; expert: number; registered: number; opened: number; firstCents: number; rechargeCents: number; withdrawalCents: number; legacyCents: number; netCents: number; spend: SpendTotal[] };
export const spendMoney = (cents: number, currency: string) => `${currency} ${new Intl.NumberFormat('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}).format(cents/100)}`;

export function buyerUnitCost(row: Pick<EffectRow, 'spend'>, count: number) {
  if (!count || !row.spend.length) return '—';
  if (row.spend.length > 1) return '多币种，暂不计算';
  return spendMoney(row.spend[0].amountCents / count, row.spend[0].currency);
}
