import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { buildAnalysisHref } from "../../../lib/analytics/scope";
import type { AnalysisFilters } from "../../../lib/analytics/types";
import type {
  BatchAlert,
  ManagementOverview,
} from "../../../lib/analytics/overview";

const alertClass =
  "flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900";

export function OverviewAlerts({
  overview,
  filters,
  customerHref = "/customer-follow-up",
  role = "LEAD",
  includeCustomerAlerts = true,
  compact = false,
}: {
  overview: ManagementOverview;
  filters: Partial<AnalysisFilters>;
  customerHref?: string;
  role?: "ADMIN" | "LEAD";
  includeCustomerAlerts?: boolean;
  compact?: boolean;
}) {
  const people = [
    ...overview.alerts.unconfirmed,
    ...overview.alerts.noRecords3Days,
  ];
  const exactBatches = [
    ...overview.alerts.replyWithoutFans,
    ...overview.alerts.excessiveLeaves,
  ];
  const channelAnomalies = overview.alerts.funnelAnomalies;
  const customerAlerts = includeCustomerAlerts ? [
    ...(overview.alerts.unassignedExperts ?? []),
    ...(overview.alerts.registrationOverdue ?? []),
    ...(overview.alerts.orderOverdue ?? []),
    ...(overview.alerts.planOverdue ?? []),
  ] : [];
  const total = people.length + exactBatches.length + channelAnomalies.length + customerAlerts.length;
  const itemClass = compact ? "lead-alert-row" : alertClass;
  const batchHref = (alert: BatchAlert) =>
    buildAnalysisHref("/batch-tracking", filters, {
      batchId: alert.batchId,
      memberId: alert.memberId,
      normalizedName: alert.normalizedName,
    });
  return (
    <section className={`panel${compact ? " lead-dashboard-section" : ""}`}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{role === "ADMIN" ? "管理待办" : "组长待办"}</h2>
          <p className="panel-subtitle">
            {total
              ? `共 ${total} 项需要跟进：组员数据、客户流程或批次异常`
              : `当前没有需要${role === "ADMIN" ? "管理员" : "组长"}跟进的问题`}
          </p>
        </div>
      </div>
      {total === 0 ? (
        <p className={compact ? "lead-dashboard-empty" : "empty-state"}>当前没有需要{role === "ADMIN" ? "管理员" : "组长"}跟进的问题</p>
      ) : (
        <div className={compact ? "lead-alert-list" : "grid gap-2 p-4 lg:grid-cols-2"}>
          {people.map((alert, index) => (
            <Link
              key={`${alert.userId}:${alert.reason}:${index}`}
              href={buildAnalysisHref("/team-performance", filters, {
                memberId: alert.userId,
              })}
              className={itemClass}
            >
              <WarningCircle
                size={19}
                className="mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                <strong>{alert.name}</strong>
                <span className="mt-1 block text-sm">
                  {alert.reason} · {alert.count}
                </span>
              </span>
            </Link>
          ))}
          {customerAlerts.map((alert, index) => (
            <Link key={`${alert.leadId}:${alert.reason}:${index}`} href={customerHref} className={itemClass}>
              <WarningCircle size={19} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>{alert.phone}{alert.customerName ? ` · ${alert.customerName}` : ""}</strong>
                <span className="mt-1 block text-sm">{alert.reason} · 归属 {alert.ownerName}</span>
              </span>
            </Link>
          ))}
          {exactBatches.map((alert, index) => (
            <Link
              key={`${alert.batchId}:${alert.memberId}:${alert.reason}:${index}`}
              href={batchHref(alert)}
              className={itemClass}
            >
              <WarningCircle
                size={19}
                className="mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                <strong>
                  {alert.channelName} · {alert.memberName}
                </strong>
                <span className="mt-1 block text-sm">
                  {alert.reason} · {alert.count}
                </span>
              </span>
            </Link>
          ))}
          {channelAnomalies.map((alert, index) => (
            <article
              key={`${alert.batchId}:${alert.memberId}:${alert.reason}:${index}`}
              className={itemClass}
            >
              <WarningCircle
                size={19}
                className="mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <div>
                <strong>
                  {alert.channelName} · {alert.memberName}
                </strong>
                <span className="mt-1 block text-sm">
                  {alert.reason} · {alert.count}
                </span>
                <div className="mt-2 flex gap-3 text-sm font-semibold">
                  <Link
                    href={buildAnalysisHref("/channel-analysis", filters, {
                      batchId: undefined,
                      normalizedName: alert.normalizedName,
                    })}
                  >
                    查看渠道
                  </Link>
                  <Link href={batchHref(alert)}>查看批次</Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
