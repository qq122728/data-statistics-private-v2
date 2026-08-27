import type { MemberOverviewResult } from "../../../lib/analytics/member-overview";
import { formatUsdOr } from "../../../lib/money";

const money = (cents: number | null) => formatUsdOr(cents, "—");

export function MemberOverviewSummary({
  summary,
  pendingPriceChannels,
  sourceDayCount,
}: Pick<MemberOverviewResult, "summary" | "pendingPriceChannels"> & {
  sourceDayCount: number;
}) {
  const cards = [
    {
      label: "有效数据样本",
      value: summary.effectiveFans.toLocaleString("zh-CN"),
      meta: `${sourceDayCount} 个来源日 · ${summary.matureBatchCount} 个成熟批次 · ${summary.observingBatchCount} 个观察中批次`,
    },
    {
      label: "入金",
      value: money(summary.rechargeCents),
      meta: "首充与续充合计",
    },
    { label: "数据成本", value: money(summary.costCents), meta: "免费数据自动按 $0" },
    {
      label: "团队计入业绩",
      value: money(summary.profitCents),
      meta: "入金 − 数据成本 − 出金",
    },
    {
      label: "需要关注人数",
      value: String(summary.attentionMemberCount),
      meta: `${summary.rankedMemberCount} 人进入正式评价`,
    },
  ];
  return (
    <>
      <section aria-label="组员数据摘要" className="member-overview-summary">
        {cards.map((card) => (
          <article key={card.label} className="member-overview-summary-item">
            <p className="metric-label">{card.label}</p>
            <strong className="metric-value">{card.value}</strong>
            <p className="metric-meta">{card.meta}</p>
          </article>
        ))}
      </section>
      {pendingPriceChannels.length ? (
        <section
          aria-label="待管理员定价渠道"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <strong>待管理员定价渠道</strong>
          <p className="mt-1">
            尚未生成消耗和计入业绩：
            {pendingPriceChannels.map((channel) => channel.name).join("、")}。
          </p>
        </section>
      ) : null}
    </>
  );
}
