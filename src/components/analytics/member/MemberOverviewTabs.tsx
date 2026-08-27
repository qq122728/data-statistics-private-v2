import Link from "next/link";

export type MemberOverviewTab =
  "reception" | "operator" | "expert" | "risk";
export type MemberOverviewQuery = Record<string, string | undefined>;

const memberTabs: Array<{
  id: Exclude<MemberOverviewTab, "risk">;
  label: string;
}> = [
  { id: "reception", label: "接粉成员" },
  { id: "operator", label: "炒群成员" },
  { id: "expert", label: "专家成员" },
];

export function memberOverviewHref(
  query: MemberOverviewQuery,
  overrides: MemberOverviewQuery,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...overrides })) {
    if (value) params.set(key, value);
  }
  const suffix = params.toString();
  return suffix ? `/anomaly-ranking?${suffix}` : "/anomaly-ranking";
}

export function MemberOverviewTabs({
  activeTab,
  query,
}: {
  activeTab: MemberOverviewTab;
  query: MemberOverviewQuery;
}) {
  return (
    <nav
      aria-label="组员数据视图"
      className="member-overview-tabs flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1"
    >
      {memberTabs.map((tab) => (
        <Link
          key={tab.id}
          href={memberOverviewHref(query, {
            tab: tab.id,
            // 每个岗位都有自己的一组成员。切换岗位时不能带着上一岗位的
            // memberId，否则会落到一个不存在的组合，页面看起来像是空白。
            memberId: activeTab === tab.id ? query.memberId : undefined,
          })}
          aria-current={activeTab === tab.id ? "page" : undefined}
          className={`min-h-9 shrink-0 rounded-lg px-4 py-2 text-sm font-semibold no-underline transition ${activeTab === tab.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
