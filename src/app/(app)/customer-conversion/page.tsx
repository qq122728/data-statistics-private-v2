import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

// 保留旧地址，避免员工收藏的链接打开后报错；页面入口已合并到炒群明细。
export default async function CustomerConversionPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const query = new URLSearchParams(
    Object.entries(raw).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
  ).toString();

  redirect(query ? `/group-customers?${query}` : "/group-customers");
}
