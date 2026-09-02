import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareDueRegionalBossBriefs, sendDueRegionalBossBriefs } from "../../../../lib/boss-report/service";
import { autoMarkExpiredGroupMemberships } from "../../../../lib/group-lifecycle";
import { hasValidDailyJobSecret } from "../../../../lib/internal-job-auth";
import { statisticsDate } from "../../../../lib/statistics-date";
import { getSystemSettings } from "../../../../lib/settings";

const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
}).strict();

async function sendDueGroupDailyReports(options: { reportDate?: string }) {
  // 小组日报永久改为组长确认后手动发送。内部定时任务只保留地区老板简报，
  // 即使服务器残留旧环境变量，也不能重新开启小组自动推送。
  return {
    enabled: false,
    requestedReportDate: options.reportDate ?? null,
    sentCount: 0,
    results: [],
  };
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
        sendDueGroupDailyReports({ reportDate: body.date }),
      ]);
      return NextResponse.json({ dryRun: true, lifecycle, reports, groupReports });
    }
    const now = new Date();
    const groupReports = await sendDueGroupDailyReports({ reportDate: body.date });
    const regionalReports = await sendDueRegionalBossBriefs({ reportDate: body.date, force: body.force, now });
    return NextResponse.json({ lifecycle, regionalReports, groupReports });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "日报参数不正确" }, { status: 400 });
    console.error("Boss daily brief failed", error);
    return NextResponse.json({ error: "老板日报生成或发送失败" }, { status: 500 });
  }
}
