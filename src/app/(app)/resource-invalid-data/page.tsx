import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

/** 保留旧地址，统一回到渠道表现，避免旧书签报错。 */
export default async function ResourceInvalidDataPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "tail" || key === "kind") continue;
    const values = Array.isArray(value) ? value : value ? [value] : [];
    for (const item of values) params.append(key, item);
  }
  redirect(`/channel-analysis${params.size ? `?${params.toString()}` : ""}`);
}
