import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import {
  botDirectory,
  privateJson,
  readBotConfig,
} from "../src/lib/resource-bot/config";
import {
  telegram,
  type TelegramUpdate,
} from "../src/lib/resource-bot/telegram";
import { createResourceBotHandler } from "../src/lib/resource-bot/handler";
import { db } from "../src/lib/db";
import { startHermesQueryServer } from "../src/lib/resource-bot/hermes";

async function main() {
  await mkdir(botDirectory(), { recursive: true, mode: 0o700 });
  const lockPath = resolve(botDirectory(), "worker.lock");
  async function lock() {
    try {
      const f = await open(lockPath, "wx", 0o600);
      await f.writeFile(String(process.pid));
      await f.close();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(await readFile(lockPath, "utf8"));
      if (!Number.isInteger(pid) || pid <= 0)
        throw Error("Worker lock needs inspection");
      try {
        process.kill(pid, 0);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") {
          await unlink(lockPath);
          return lock();
        }
      }
      throw Error("Worker already running");
    }
  }
  await lock();
  await privateJson("status.json", {
    heartbeat: Date.now(),
    state: "starting",
  });
  let running = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      running = false;
    });
  const handle = createResourceBotHandler();
  const hermesQueryServer = await startHermesQueryServer();
  let offset = 0,
    botId = 0,
    lastReplyAt: number | undefined;
  try {
    const s = JSON.parse(
      await readFile(resolve(botDirectory(), "offset.json"), "utf8"),
    );
    offset = Number.isSafeInteger(s.offset) ? s.offset : 0;
    botId = s.botId;
  } catch {
    /* First start. */
  }
  const status = (state: string) =>
    privateJson("status.json", { heartbeat: Date.now(), state, lastReplyAt });
  try {
    while (running) {
      try {
        const config = await readBotConfig();
        if (!config?.enabled || !config.chatId) {
          await status("paused");
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        if (botId !== config.botId) {
          botId = config.botId;
          offset = 0;
        }
        await status("listening");
        const updates = await telegram<TelegramUpdate[]>(
          config.token,
          "getUpdates",
          {
            offset,
            timeout: 25,
            limit: 50,
            allowed_updates: ["message", "my_chat_member"],
          },
        );
        for (const u of updates) {
          if (!running) break;
          if (u.update_id < offset) continue;
          // Acknowledge before responding: restart cannot resend an export. Failed queries can be requested again.
          offset = u.update_id + 1;
          await privateJson("offset.json", { botId, offset });
          if (u.message) {
            await status("processing");
            if (await handle(u.message, config)) lastReplyAt = Date.now();
          }
        }
      } catch {
        await status("connection_error");
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  } finally {
    hermesQueryServer?.close();
    await status("stopped");
    await db.$disconnect();
    await unlink(lockPath);
  }
}
main().catch(() => {
  console.error(
    "Resource bot stopped; inspect configuration and worker lock. Secrets and customer data are not logged.",
  );
  process.exitCode = 1;
});
