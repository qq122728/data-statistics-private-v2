const usdFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(cents: number): string {
  return usdFormatter.format(cents / 100);
}

export function formatUsdOr(cents: number | null | undefined, emptyLabel: string): string {
  return cents == null ? emptyLabel : formatUsd(cents);
}
