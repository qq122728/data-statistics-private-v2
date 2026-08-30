export function customerNumberTail6(value: unknown): string;

export function inspectCustomerNumberRows(rows: Array<{ id: string; phone: unknown }>): {
  total: number;
  invalidCount: number;
  changedCount: number;
  collisionGroupCount: number;
  collisionCustomerCount: number;
};
