import { describe, expect, it } from 'vitest';
import { buyerReport } from '../../src/lib/resource-buyer-report';
import { buyerPhoneMetrics } from '../../src/lib/resource-buyer-phones';
import { isCountry, parseSpendCents } from '../../packages/resource-buyer/options';
const dimensions = {buyerId:'buyer',buyer:'QQ',channelId:'fb',channel:'FB-M',country:'DE',materialId:'m',material:'素材 A'};
const detail = {...dimensions,status:'matched',metrics:buyerPhoneMetrics({quality:'有效',firstDeposit:500})};
describe('country and expense attribution',()=>{
 it('keeps countries and legacy unknown separate without duplicating spend across phones',()=>{
  const rows=buyerReport([detail,detail,{...detail,country:'SG'},{...detail,country:''}], [{...dimensions,currency:'USD',amountCents:10000}]);
  expect(rows).toHaveLength(3);
  expect(rows.find(r=>r.country==='DE')).toMatchObject({imported:2,valid:2,opened:2,firstCents:100000,spend:[{currency:'USD',amountCents:10000}]});
  expect(rows.find(r=>r.country==='SG')?.spend).toEqual([]);
 });
 it('adds same currency only and keeps spend with no imported customers visible',()=>{
  const rows=buyerReport([], [{...dimensions,currency:'USD',amountCents:10000},{...dimensions,currency:'EUR',amountCents:2000},{...dimensions,currency:'USD',amountCents:5000}]);
  expect(rows[0]).toMatchObject({imported:0,opened:0,spend:[{currency:'USD',amountCents:15000},{currency:'EUR',amountCents:2000}]});
 });
 it('only attributes material-specific expenses to material; country remains separate',()=>{
  const rows=buyerReport([detail,{...detail,country:'SG'}], [{...dimensions,materialId:null,material:'',currency:'USD',amountCents:10000},{...dimensions,currency:'USD',amountCents:3000}],true);
  expect(rows).toHaveLength(2); expect(rows.find(r=>r.country==='DE')?.spend).toEqual([{currency:'USD',amountCents:3000}]);
  expect(rows.find(r=>r.country==='SG')?.spend).toEqual([]);
 });
 it('does not count unmatched or ambiguous customers as successful conversions',()=>{
  const rows=buyerReport([{...detail,status:'ambiguous',metrics:null},{...detail,status:'pending',metrics:null}],[]);
  expect(rows[0]).toMatchObject({imported:2,matched:0,valid:0,opened:0,ambiguous:1,pending:1});
 });
 it('validates money precisely without silent rounding, negative values or unsafe integers',()=>{
  expect(parseSpendCents('0')).toBe(0);expect(parseSpendCents('100.01')).toBe(10001);expect(parseSpendCents('1.1')).toBe(110);
  for (const amount of ['-1','1.001','1e3','NaN','20000000.01','',100]) expect(parseSpendCents(amount)).toBeNull();
  expect(isCountry('DE')).toBe(true);expect(isCountry('SG')).toBe(true);expect(isCountry('ZZ')).toBe(false);
 });
});
