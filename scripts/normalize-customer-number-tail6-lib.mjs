export function customerNumberTail6(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 6) throw new Error("客户号码少于6位数字");
  return digits.slice(-6);
}

export function inspectCustomerNumberRows(rows) {
  const counts = new Map();
  let invalidCount = 0;
  let changedCount = 0;
  for (const row of rows) {
    try {
      const normalized = customerNumberTail6(row.phone);
      if (normalized !== row.phone) changedCount += 1;
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    } catch {
      invalidCount += 1;
    }
  }
  const collisionGroups = [...counts.values()].filter((count) => count > 1);
  return {
    total: rows.length,
    invalidCount,
    changedCount,
    collisionGroupCount: collisionGroups.length,
    collisionCustomerCount: collisionGroups.reduce((total, count) => total + count, 0),
  };
}
