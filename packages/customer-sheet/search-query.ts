/** Accept the same number formatting as import; keep action codes intact. */
export function normalizeCustomerQuery(raw: string): string {
  const query = raw.trim();
  return /^[\d\s()+-]+$/.test(query) ? query.replace(/[\s()+-]/g, "") : query.toUpperCase();
}
