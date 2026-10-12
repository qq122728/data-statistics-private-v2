import { describe, expect, it } from 'vitest';
import { groupBuyerEffects, normalizeResourceMonth, sumEffects } from '../../apps/frontline/components/resource-buyer-groups';
import { buyerUnitCost, type EffectRow } from '../../apps/frontline/components/resource-buyer-format';
const row = (overrides: Partial<EffectRow>): EffectRow => ({ ...sumEffects([]), buyerId: 'qq', buyer: 'QQ', channelId: 'fbq', channel: 'FB-Q', ...overrides });
describe('buyer country rollup', () => {
  it('sums each country once, retaining every metric and leaving inputs intact', () => {
    const data = [row({country:'DE', imported:100, matched:80, pending:19, ambiguous:1, valid:60, opened:4, firstCents:40000, netCents:40000, spend:[{currency:'USD',amountCents:10000}]}), row({country:'SG', imported:20, matched:10, pending:10, valid:8, opened:2, rechargeCents:15000, legacyCents:1000, netCents:16000, spend:[{currency:'USD',amountCents:2000}]})];
    const before = structuredClone(data);
    const groups = groupBuyerEffects(data);
    expect(groups).toHaveLength(1);
    expect(groups[0].total).toMatchObject({imported:120, matched:90, pending:29, ambiguous:1, valid:68, opened:6, firstCents:40000, rechargeCents:15000, legacyCents:1000, netCents:56000, spend:[{currency:'USD',amountCents:12000}]});
    expect((groups[0].total.opened / groups[0].total.matched * 100).toFixed(1)).toBe('6.7');
    expect(buyerUnitCost(groups[0].total,120)).toBe('USD 1.00');
    expect(data).toEqual(before);
  });
  it('keeps distinct channels and distinct buyer IDs separate even when names match', () => {
    expect(groupBuyerEffects([row({country:'DE'}),row({country:'SG', channelId:'fbm'}),row({country:'DE',buyerId:'qq2'})])).toHaveLength(3);
  });
  it('does not mix currencies or invent costs when no denominators or spending exist', () => {
    const total = sumEffects([row({spend:[{currency:'USD',amountCents:1000}]}),row({spend:[{currency:'EUR',amountCents:500}]})]);
    expect(total.spend).toEqual([{currency:'EUR',amountCents:500},{currency:'USD',amountCents:1000}]);
    expect(buyerUnitCost(total,10)).toBe('多币种，暂不计算');
    expect(buyerUnitCost(total,0)).toBe('—');
    expect(buyerUnitCost(sumEffects([]),10)).toBe('—');
  });
  it('keeps material-level rows in the correct buyer group', () => {
    const groups = groupBuyerEffects([row({country:'DE',materialId:'a',imported:5}),row({country:'DE',materialId:'b',imported:3}),row({country:'SG',materialId:'a',imported:2})]);
    expect(groups[0].children).toHaveLength(3);
    expect(groups[0].total.imported).toBe(10);
  });
});
describe('resource month', () => {
  it('normalizes a one-digit month and rejects incomplete or invalid dates', () => {
    expect(normalizeResourceMonth('2026-9')).toBe('2026-09');
    expect(normalizeResourceMonth('2026-10')).toBe('2026-10');
    for (const value of ['', '2026-', '2026-00', '2026-13', '26-10', '2026-10-01']) expect(normalizeResourceMonth(value)).toBeNull();
  });
});
