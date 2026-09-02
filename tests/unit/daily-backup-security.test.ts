import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("每日加密备份安全边界", () => {
  it("Telegram 只从唯一接收群环境变量读取接收人", () => {
    for (const file of ["src/lib/telegram-delivery.ts", "scripts/send-daily-backup.mjs"]) {
      const source = read(file);
      expect(source).toContain("TELEGRAM_BOSS_CHAT_ID");
      expect(source).not.toContain("TELEGRAM_CHAT_IDS");
    }
  });

  it("备份先加密，并按 Telegram 限制切成小于 50MB 的分片", () => {
    const source = read("scripts/send-daily-backup.mjs");
    expect(source).toContain("aes-256-cbc");
    expect(source).toContain("pbkdf2");
    expect(source).toContain("45 * 1024 * 1024");
    expect(source.indexOf("encryptDump")).toBeLessThan(source.indexOf("sendParts(encrypted"));
  });

  it("仓库不再保留自动老板日报接口和触发脚本", () => {
    expect(read("src/proxy.ts")).not.toContain("boss-daily-brief");
    expect(read("package.json")).not.toContain("boss:brief");
    expect(read("package.json")).not.toContain("boss:daily");
  });
});
