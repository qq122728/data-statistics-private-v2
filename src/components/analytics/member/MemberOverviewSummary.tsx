import type { MemberOverviewResult } from "../../../lib/analytics/member-overview";
import { formatUsdOr } from "../../../lib/money";

const money = (cents: number | null) => formatUsdOr(cents, "—");

export function MemberOverviewSummary({
  summary,
  sourceDayCount,
}: Pick<MemberOverviewResult, "summary"> & {
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
    {
      label: "团队净业绩",
      value: money(summary.netPerformanceCents),
      meta: "入金 − 出金",
    },
    {
      label: "需要关注人数",
      value: String(summary.attentionMemberCount),
      meta: `${summary.rankedMemberCount} 人进入正式评价`,
    },
  ];
  return (
    <section aria-label="组员数据摘要" className="member-overview-summary">
      {cards.map((card) => (
        <article key={card.label} className="member-overview-summary-item">
          <p className="metric-label">{card.label}</p>
          <strong className="metric-value">{card.value}</strong>
          <p className="metric-meta">{card.meta}</p>
        </article>
      ))}
    </section>
  );
}
