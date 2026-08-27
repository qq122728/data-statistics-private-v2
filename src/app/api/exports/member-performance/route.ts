import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { buildMemberPerformanceWorkbook } from "../../../../lib/member-performance-xlsx";
import { loadMemberPerformanceExport } from "../../../../lib/member-performance-export";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { resolveReadableReportGroups } from "../../../../lib/report-scope";

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
export const runtime = "nodejs";

export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    return NextResponse.json({ error: error instanceof AuthenticationError ? "请先登录" : "无法确认账号" }, { status: 401 });
  }
  if (!["ADMIN", "COMPANY_MANAGER", "FINANCE", "LEAD"].includes(user.role)) {
    return authorizationDenied(user, "只有组长、公司管理员、总公司管理员和财务可以导出组员业绩");
  }
  const url = new URL(request.url);
  if (hasOversizedQueryValue(url.searchParams)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  const requestedGroupId = url.searchParams.get("groupId") ?? "";
  if (!dateOnly.test(from) || !dateOnly.test(to) || from > to) {
    return NextResponse.json({ error: "请选择正确的统计开始和结束日期" }, { status: 400 });
  }
  const days = Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > 31) return NextResponse.json({ error: "月度报表一次最多导出 31 天，请按月选择日期" }, { status: 400 });
  const allGroups = await db.teamGroup.findMany({
    select: { id: true, departmentId: true, countryCode: true, department: { select: { countryCode: true } } },
  });
  const groups = resolveReadableReportGroups(user, allGroups);
  const groupIds = requestedGroupId
    ? groups.some((group) => group.id === requestedGroupId) ? [requestedGroupId] : []
    : groups.map((group) => group.id);
  if (!groupIds.length) return NextResponse.json({ error: "没有可导出的数据范围" }, { status: 400 });
  const payload = await loadMemberPerformanceExport({ from, to, groupIds });
  const workbook = await buildMemberPerformanceWorkbook({ from, to, ...payload });
  const bytes = await workbook.xlsx.writeBuffer();
  const fileName = `小组月度业绩统计-${from}至${to}.xlsx`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
