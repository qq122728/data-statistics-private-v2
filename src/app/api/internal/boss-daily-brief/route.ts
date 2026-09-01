import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareDueRegionalBossBriefs, sendDueRegionalBossBriefs } from "../../../../lib/boss-report/service";
import { autoMarkExpiredGroupMemberships } from "../../../../lib/group-lifecycle";
import { statisticsDate } from "../../../../lib/statistics-date";
import { getSystemSettings } from "../../../../lib/settings";

const inputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
}).strict();

function validSecret(request: Request) {
  const expected = process.env.DAILY_JOB_SECRET;
  const received = request.headers.get("x-daily-job-secret");
  if (!expected || !received) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256").update(received).digest();
  return timingSafeEqual(expectedHash, receivedHash);
}

export async function POST(request: Request) {
  if (!validSecret(request)) return NextResponse.json({ error: "定时任务密钥不正确" }, { status: 401 });
  try {
    const body = inputSchema.parse(await request.json().catch(() => ({})));
    const settings = await getSystemSettings();
    const lifecycleDate = body.date ?? statisticsDate();
    const lifecycle = await autoMarkExpiredGroupMemberships({ today: lifecycleDate });
    if (body.dryRun) {
      const reports = await prepareDueRegionalBossBriefs({ reportDate: body.date, force: body.force });
      return NextResponse.json({ dryRun: true, lifecycle, reports });
    }
    return NextResponse.json({ lifecycle, ...(await sendDueRegionalBossBriefs({ reportDate: body.date, force: body.force })) });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "日报参数不正确" }, { status: 400 });
    console.error("Boss daily brief failed", error);
    return NextResponse.json({ error: "老板日报生成或发送失败" }, { status: 500 });
  }
}
