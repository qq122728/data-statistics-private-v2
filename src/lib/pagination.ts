export const DEFAULT_CUSTOMER_PAGE_SIZE = 50;

export function parsePage(value: string | undefined, pageSize = DEFAULT_CUSTOMER_PAGE_SIZE) {
  const parsed = Number(value);
  const page = Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function pageHref(pathname: string, values: Record<string, string>, page: number) {
  const params = new URLSearchParams(values);
  if (page <= 1) params.delete("page");
  else params.set("page", String(page));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
