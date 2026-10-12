import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export const configSchema = z.object({
  revision: z.string(),
  token: z.string(),
  botId: z.number(),
  username: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  chatId: z.string().nullable(),
  chatTitle: z.string(),
  activatedAt: z.number(),
  updatedBy: z.string(),
});
export type BotConfig = z.infer<typeof configSchema>;
export const botDirectory = () =>
  resolve(process.env.RESOURCE_BOT_DIR || "storage/resource-bot");
export async function readBotConfig(): Promise<BotConfig | null> {
  try {
    return configSchema.parse(
      JSON.parse(
        await readFile(resolve(botDirectory(), "config.json"), "utf8"),
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("机器人配置无法读取，请联系管理员");
  }
}
export async function privateJson(name: string, value: unknown) {
  const dir = botDirectory();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = resolve(dir, `${name}.${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
  await rename(temp, resolve(dir, name));
}
export async function saveBotConfig(config: BotConfig) {
  await privateJson(
    "config.json",
    configSchema.parse({ ...config, revision: randomUUID() }),
  );
}
export async function readStatus() {
  try {
    return JSON.parse(
      await readFile(resolve(botDirectory(), "status.json"), "utf8"),
    ) as {
      heartbeat: number;
      state: string;
      lastReplyAt?: number;
      error?: string;
    };
  } catch {
    return null;
  }
}
export function publicConfig(config: BotConfig | null) {
  return config
    ? {
        configured: true,
        revision: config.revision,
        username: config.username,
        name: config.name,
        enabled: config.enabled,
        chatId: config.chatId,
        chatTitle: config.chatTitle,
      }
    : {
        configured: false,
        enabled: false,
        chatId: null,
        chatTitle: "",
        username: "",
        name: "",
        revision: "",
      };
}
