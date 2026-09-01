import { NextResponse } from "next/server";
import { GET as loadChannelReporting } from "../channel-reporting/route";
import { buildLeadChannelReportWorkbook, type LeadChannelReportPayload } from "../../../../lib/lead-channel-report-xlsx";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const reportResponse = await loadChannelReporting(request);
  if (!reportResponse.ok) return reportResponse;
  const payload = await reportResponse.json() as LeadChannelReportPayload;
  const workbook = await buildLeadChannelReportWorkbook(payload);
  const bytes = await workbook.xlsx.writeBuffer();
  const period = payload.range.from === payload.range.to ? payload.range.from : `${payload.range.from}至${payload.range.to}`;
  const fileName = `${payload.group.name}-业务数据报表-${period}.xlsx`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
