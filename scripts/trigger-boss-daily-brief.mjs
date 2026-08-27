const baseUrl = (process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const secret = process.env.DAILY_JOB_SECRET;
if (!secret) throw new Error("缺少 DAILY_JOB_SECRET");

const body = {
  ...(process.env.BOSS_REPORT_DATE ? { date: process.env.BOSS_REPORT_DATE } : {}),
  ...(process.env.BOSS_REPORT_FORCE === "true" ? { force: true } : {}),
  ...(process.env.BOSS_REPORT_DRY_RUN === "true" ? { dryRun: true } : {}),
};
const response = await fetch(`${baseUrl}/api/internal/boss-daily-brief`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-daily-job-secret": secret },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(120_000),
});
const text = await response.text();
if (!response.ok) throw new Error(`老板日报任务失败（HTTP ${response.status}）：${text}`);
const contentType = response.headers.get("content-type") || "";
if (!contentType.includes("application/json")) {
  throw new Error(`老板日报任务返回了非 JSON 内容，可能被登录页拦截（${contentType || "未知类型"}）`);
}
process.stdout.write(`${text}\n`);
