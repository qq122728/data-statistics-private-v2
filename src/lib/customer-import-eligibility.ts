export type CustomerImportEligibilityRow = {
  phone: string;
  lossAmountCents?: number | null;
};

/**
 * 新规则下，低金额客户不生成客户资料；由接粉员在扣粉登记中手工填写数量，
 * 通过组长审核后才会进入扣粉统计。
 */
export function splitCustomerImportRows<T extends CustomerImportEligibilityRow>(rows: T[]) {
  const importable: T[] = [];
  const lowAmount: T[] = [];
  for (const row of rows) {
    if (row.lossAmountCents !== null && row.lossAmountCents !== undefined && row.lossAmountCents < 500_000) lowAmount.push(row);
    else importable.push(row);
  }
  return { importable, lowAmount };
}
