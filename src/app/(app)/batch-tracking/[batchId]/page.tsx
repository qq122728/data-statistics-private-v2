import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BatchDetail } from "../../../../components/analytics/batch/BatchDetail";
import { AnalysisFilterNotice } from "../../../../components/analytics/AnalysisState";
import { loadBatchDetail } from "../../../../lib/analytics/batch-tracking";
import { buildAnalysisHref, parseAnalysisFilters, resolveAnalysisScope } from "../../../../lib/analytics/scope";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { localDateYYYYMMDD } from "../../../../lib/dates";
import { db } from "../../../../lib/db";
import { resolveReadableReportGroups } from "../../../../lib/report-scope";
import { getSystemSettings } from "../../../../lib/settings";

export default async function BatchDetailPage({ params, searchParams }: { params: Promise<{ batchId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let user;
  try { user = await requireUser(); }
  catch (error) { if (error instanceof AuthenticationError) redirect("/login?next=/batch-tracking"); throw error; }
  if (user.role !== "ADMIN" && user.role !== "LEAD") redirect("/dashboard");
  const [{ batchId }, raw, settings, groups] = await Promise.all([params, searchParams, getSystemSettings(), db.teamGroup.findMany({ select: { id: true, name: true, active: true, departmentId: true, department: { select: { companyId: true } } } })]);
  const rawValues = Object.fromEntries(Object.entries(raw).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
  const contextFilters = parseAnalysisFilters(new URLSearchParams(rawValues));
  const memberId = contextFilters.memberId;
  const today = localDateYYYYMMDD(new Date(), settings.timezone);
  const readableGroups = resolveReadableReportGroups(user, groups);
  const permissionScope = resolveAnalysisScope(user, { includeInactive: contextFilters.includeInactive }, today, readableGroups.map((group) => group.id));
  const detail = await loadBatchDetail(permissionScope, batchId, memberId, today);
  if (!detail) notFound();
  return <main className="page-shell space-y-4"><div className="page-heading"><div><Link href={buildAnalysisHref("/batch-tracking", contextFilters, { batchId: undefined })} className="text-sm font-semibold text-[#0b66ff]">返回批次追踪</Link><h1 className="mt-2 page-title">批次详情</h1><p className="page-description">详情严格限定到该批次和所选粉的归属成员；实际录入人仍可在客户流程里追溯。</p></div></div><AnalysisFilterNotice message={contextFilters.filterWarning} /><BatchDetail detail={detail} filters={contextFilters} /></main>;
}
