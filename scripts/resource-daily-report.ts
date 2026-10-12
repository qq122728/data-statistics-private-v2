import { readFile, mkdir, open, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { db } from "../src/lib/db";
import { readBotConfig } from "../src/lib/resource-bot/config";
import { loadResourceAnalysis } from "../src/lib/resource-bot/analysis-data";
import { dispatchResourceDaily, type DeliveryState } from "../src/lib/resource-bot/daily";
import { querySchema } from "../src/lib/resource-bot/query";
import { telegram } from "../src/lib/resource-bot/telegram";
import { assertResourceReadOnlyDatabase } from "../src/lib/resource-bot/hermes";
import { statisticsDate } from "../src/lib/statistics-date";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const token = process.env.BOSS_QUERY_TOKEN;
  if (!token || token.length < 32) throw Error("日报时间源未配置");
  const config = await readBotConfig();
  if (!config?.enabled || !config.chatId) { console.log("Resource daily: bot disabled or unbound"); return; }
  await assertResourceReadOnlyDatabase();
  // Reuse the SAME readiness source as the analysis bot. Never call its delivery endpoint.
  const response = await fetch("http://127.0.0.1:4179/daily-report-ready", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: "{}", signal: AbortSignal.timeout(90000),
  });
  if (!response.ok) throw Error("无法读取现有日报时间，本轮稍后重试");
  const source = z.object({ generatedAt: z.string().datetime(), results: z.array(z.object({ groupId: z.string().min(1), groupName: z.string(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ready: z.boolean() })).max(100) }).parse(await response.json());
  if (Math.abs(Date.now() - Date.parse(source.generatedAt)) > 180000) throw Error("日报时间源已过期");
  const directory = process.env.RESOURCE_DAILY_STATE_DIR || "/opt/data-statistics-resource-bot/shared/daily";
  const file = resolve(directory, "deliveries.json");
  let state: DeliveryState = { sent: {} };
  try {
    state = z.object({ sent: z.record(z.string(), z.object({ status: z.enum(["sending", "sent", "uncertain"]), at: z.string(), messageId: z.number().optional() })) }).parse(JSON.parse(await readFile(file, "utf8")));
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw Error("日报发送记录无法读取，已停止避免重复发送"); }
  const outputs = await dispatchResourceDaily({ config, due: source.results, state, dryRun,
    analyze: (date, groupIds) => loadResourceAnalysis(querySchema.parse({ view: "analysis", type: "ALL", period: "custom", from: date.slice(0, 7) + "-01", to: date }), statisticsDate(), { groupIds, completedThrough: date }),
    save: async value => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temp = resolve(directory, `deliveries.${process.pid}.tmp`);
      const handle = await open(temp, "w", 0o600);
      try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, file);
      const parent = await open(directory, "r"); try { await parent.sync(); } finally { await parent.close(); }
    },
    send: (chatId, text) => telegram<{ message_id: number }>(config.token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }),
  });
  console.log(JSON.stringify({ mode: dryRun ? "preview" : "scheduled", dueGroups: source.results.length, reports: outputs.map(r => dryRun ? r : ({ date: r.date, groups: r.groups, status: r.status })) }));
}
main().catch(e => { console.error(e instanceof Error && /^[\u4e00-\u9fff]/.test(e.message) ? e.message : "资源日报任务失败，请检查服务日志"); process.exitCode = 1; }).finally(() => db.$disconnect());
