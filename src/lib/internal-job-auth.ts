import { createHash, timingSafeEqual } from "node:crypto";

/** 只允许服务器定时任务进入的内部通道；浏览器账号不能借此扩大权限。 */
export function hasValidDailyJobSecret(request: Request) {
  const expected = process.env.DAILY_JOB_SECRET;
  const received = request.headers.get("x-daily-job-secret");
  if (!expected || !received) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256").update(received).digest();
  return timingSafeEqual(expectedHash, receivedHash);
}
