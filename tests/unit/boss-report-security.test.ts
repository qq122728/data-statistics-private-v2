import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("老板日报安全边界", () => {
  it("电报只从唯一老板群环境变量读取接收人", () => {
    for (const file of ["src/lib/boss-report/telegram.ts", "scripts/send-daily-backup.mjs"]) {
      const source = read(file);
      expect(source).toContain("TELEGRAM_BOSS_CHAT_ID");
      expect(source).not.toContain("TELEGRAM_CHAT_IDS");
    }
  });

  it("备份先加密，并按电报限制切成小于50MB的分片", () => {
    const source = read("scripts/send-daily-backup.mjs");
    expect(source).toContain("aes-256-cbc");
    expect(source).toContain("pbkdf2");
    expect(source).toContain("45 * 1024 * 1024");
    expect(source.indexOf("encryptDump")).toBeLessThan(source.indexOf("sendParts(encrypted"));
  });

  it("内部任务需要独立密钥且支持防重复发送", () => {
    const route = read("src/app/api/internal/boss-daily-brief/route.ts");
    const internalAuth = read("src/lib/internal-job-auth.ts");
    const service = read("src/lib/boss-report/service.ts");
    const proxy = read("src/proxy.ts");
    const trigger = read("scripts/trigger-boss-daily-brief.mjs");
    expect(route).toContain("x-daily-job-secret");
    expect(route).toContain("hasValidDailyJobSecret");
    expect(internalAuth).toContain("timingSafeEqual");
    expect(service).toContain("bossBrief:lastSentDate");
    expect(service).toContain("bossBrief:audit:");
    expect(service).toContain('status: "prepared"');
    expect(service).toContain('status: "sent"');
    expect(proxy).toContain("api/internal/boss-daily-brief");
    expect(trigger).toContain('contentType.includes("application/json")');
  });
});
