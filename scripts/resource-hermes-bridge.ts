import { startHermesQueryServer } from "../src/lib/resource-bot/hermes";
import { db } from "../src/lib/db";
import { readdir, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
async function main() {
  const server = await startHermesQueryServer();
  if (!server) throw Error("Readonly bridge disabled");
  // Expire generated exports; never touch business or user-uploaded files.
  const cleanup = async () => {
    const dir = process.env.RESOURCE_REPORT_DIR!;
    for (const name of await readdir(dir)) {
      if (!/^resource-[a-f0-9]{48}\.xlsx$/.test(name)) continue;
      const path = resolve(dir, name);
      if ((await stat(path)).mtimeMs < Date.now() - 86400000) await unlink(path);
    }
  };
  const timer = setInterval(() => { cleanup().catch(() => {}); }, 3600000);
  await cleanup();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    clearInterval(timer);
    server.close(() => { db.$disconnect().then(() => process.exit(0)); });
  });
  console.log("Resource read-only bridge ready; Telegram is handled by Hermes gateway.");
}
main().catch(() => { console.error("Resource read-only bridge failed; check service configuration."); process.exit(1); });
