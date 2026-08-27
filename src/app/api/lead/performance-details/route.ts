import { NextResponse } from "next/server";
import { requireLeadRequest } from "../../../../lib/lead-members";
import { loadExpertPendingCustomerPage } from "../../../../lib/customer-queries/expert-customers";
import { loadGroupOperatorCustomerPage } from "../../../../lib/customer-queries/group-customers";
import { hasOversizedQueryValue } from "../../../../lib/request-limits";

const validDate = (value: string | null): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

export async function GET(request: Request) {
  const access = await requireLeadRequest();
  if ("response" in access) return access.response;
  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const stage = params.get("stage");
  const kind = params.get("kind");
  const memberId = params.get("memberId");
  const from = params.get("from");
  const to = params.get("to");
  const rawQuery = params.get("q")?.trim() ?? "";
  if (rawQuery.length > 100) return NextResponse.json({ error: "搜索内容不能超过 100 个字" }, { status: 400 });
  const query = rawQuery;
  const rawPage = Number(params.get("page"));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1;
  const hasDateRange = validDate(from) && validDate(to);
  if (!memberId || ((from || to) && (!hasDateRange || from! > to!)))
    return NextResponse.json({ error: "查询范围不正确" }, { status: 400 });

  let result;
  if (stage === "group" && (kind === "pending" || kind === "introduced" || kind === "left")) {
    result = await loadGroupOperatorCustomerPage({
      groupId: access.group.id,
      operatorId: memberId,
      kind,
      from: hasDateRange ? from : undefined,
      to: hasDateRange ? to : undefined,
      query,
      page,
      pageSize: 10,
    });
  } else if (stage === "expert" && (kind === "registration" || kind === "order")) {
    result = await loadExpertPendingCustomerPage({
      groupId: access.group.id,
      expertId: memberId,
      kind,
      from: hasDateRange ? from : undefined,
      to: hasDateRange ? to : undefined,
      query,
      page,
      pageSize: 10,
    });
  } else {
    return NextResponse.json({ error: "客户明细类型不正确" }, { status: 400 });
  }
  if (!result) return NextResponse.json({ error: "成员不存在或不在本组" }, { status: 404 });
  return NextResponse.json(result, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
