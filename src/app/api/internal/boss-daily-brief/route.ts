import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareDueRegionalBossBriefs, sendDueRegionalBossBriefs } from "../../../../lib/boss-report/service";
import { resolveGroupBusinessTime } from "../../../../lib/business-time-config";
import { db } from "../../../../lib/db";
import { dueGroupDailySchedules, groupDailyReportDate } from "../../../../lib/group-daily-schedule";
import { autoMarkExpiredGroupMemberships } from "../../../../lib/group-lifecycle";
import { hasValidDailyJobSecret } from "../../../../lib/internal-job-auth";
import { statisticsDate } from "../../../../lib/statistics-date";
import { getSystemSettings } from "../../../../lib/settings";
import { POST as sendGroupDailyReport } from "../../lead/daily-business-report/route";

const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
}).strict();

async function groupDailyTargets(now: Date, all = false) {
  const groups = await db.teamGroup.findMany({
    where: { active: true, department: { active: true } },
    select: {
      id: true, name: true, countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true,
      department: { select: { countryCode: true, timezone: true, workStartMinutes: true, workEndMinutes: true } },
    },
    orderBy: { name: "asc" },
  });
  const schedules = groups.map((group) => ({ id: group.id, name: group.name, ...resolveGroupBusinessTime(group) }));
  return all ? schedules : dueGroupDailySchedules(schedules, now);
}

async function sendDueGroupDailyReports(request: Request, options: { now: Date; reportDate?: string; force?: boolean; dryRun?: boolean }) {
  const targets = await groupDailyTargets(options.now, Boolean(options.reportDate || options.force));
  if (options.dryRun) return {
    requestedReportDate: options.reportDate ?? null,
    targets: targets.map((group) => ({
      id: group.id,
      name: group.name,
      timezone: group.timezone,
      workEndMinutes: group.workEndMinutes,
      reportDate: options.reportDate ?? groupDailyReportDate(group, options.now),
    })),
  };
  const secret = request.headers.get("x-daily-job-secret")!;
  const results: Array<{ groupId: string; groupName: string; reportDate: string; ok: boolean; message: string }> = [];
  for (const group of targets) {
    const reportDate = options.reportDate ?? groupDailyReportDate(group, options.now);
    const url = new URL("/api/lead/daily-business-report", request.url);
    const response = await sendGroupDailyReport(new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-daily-job-secret": secret },
      body: JSON.stringify({ date: reportDate, groupId: group.id }),
    }));
    const payload = await response.json() as { message?: string; error?: string };
    results.push({ groupId: group.id, groupName: group.name, reportDate, ok: response.ok, message: payload.message ?? payload.error ?? "未知结果" });
  }
  return { requestedReportDate: options.reportDate ?? null, sentCount: results.filter((row) => row.ok && row.message.startsWith("已推送")).length, results };
}

export async function POST(request: Request) {
  if (!hasValidDailyJobSecret(request)) return NextResponse.json({ error: "定时任务密钥不正确" }, { status: 401 });
  try {
    const body = inputSchema.parse(await request.json().catch(() => ({})));
    const settings = await getSystemSettings();
    const lifecycleDate = body.date ?? statisticsDate();
    const lifecycle = await autoMarkExpiredGroupMemberships({ today: lifecycleDate });
    if (body.dryRun) {
      const now = new Date();
      const [reports, groupReports] = await Promise.all([
        prepareDueRegionalBossBriefs({ reportDate: body.date, force: body.force, now }),
        sendDueGroupDailyReports(request, { now, reportDate: body.date, force: body.force, dryRun: true }),
      ]);
      return NextResponse.json({ dryRun: true, lifecycle, reports, groupReports });
    }
    const now = new Date();
    const groupReports = await sendDueGroupDailyReports(request, { now, reportDate: body.date, force: body.force });
    const regionalReports = await sendDueRegionalBossBriefs({ reportDate: body.date, force: body.force, now });
    return NextResponse.json({ lifecycle, regionalReports, groupReports });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "日报参数不正确" }, { status: 400 });
    console.error("Boss daily brief failed", error);
    return NextResponse.json({ error: "老板日报生成或发送失败" }, { status: 500 });
  }
}
