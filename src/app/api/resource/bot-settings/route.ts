import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { readLimitedJson } from "../../../../lib/request-limits";
import {
  readBotConfig,
  saveBotConfig,
  publicConfig,
  readStatus,
} from "../../../../lib/resource-bot/config";
import {
  telegram,
  type TelegramUpdate,
} from "../../../../lib/resource-bot/telegram";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
async function admin() {
  try {
    const user = await requireUser();
    if (user.role !== "ADMIN" && user.duty !== "HQ_MANAGER")
      return NextResponse.json(
        { error: "只有总公司管理员可以设置机器人" },
        { status: 403, headers },
      );
    return user;
  } catch (e) {
    if (e instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401, headers });
    throw e;
  }
}
export async function GET() {
  const actor = await admin();
  if (actor instanceof NextResponse) return actor;
  return NextResponse.json(
    {
      config: publicConfig(await readBotConfig()),
      status: await readStatus(),
      aiReady: Boolean(process.env.DEEPSEEK_API_KEY),
    },
    { headers },
  );
}
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("token"),
      token: z
        .string()
        .trim()
        .regex(/^\d{5,16}:[A-Za-z0-9_-]{25,100}$/),
    })
    .strict(),
  z.object({ action: z.literal("discover") }).strict(),
  z
    .object({
      action: z.literal("bind"),
      chatId: z.string().regex(/^-\d{1,16}$/),
    })
    .strict(),
  z.object({ action: z.enum(["enable", "pause"]) }).strict(),
]);
let queue = Promise.resolve();
export async function POST(request: Request) {
  const actor = await admin();
  if (actor instanceof NextResponse) return actor;
  let raw: unknown;
  try {
    raw = input.parse(await readLimitedJson(request, 2048));
  } catch {
    return NextResponse.json(
      { error: "请检查 Token 或群信息的填写格式" },
      { status: 400, headers },
    );
  }
  const operation = async () => {
    const body = input.parse(raw);
    const config = await readBotConfig();
    if (body.action === "token") {
      if (config?.enabled) throw new Error("请先暂停机器人，再更换 Token");
      if (body.token === process.env.TELEGRAM_BOT_TOKEN)
        throw new Error("请使用这次新建机器人的 Token");
      const me = await telegram<{
        id: number;
        username: string;
        first_name: string;
        is_bot: boolean;
      }>(body.token, "getMe");
      const webhook = await telegram<{ url: string }>(
        body.token,
        "getWebhookInfo",
      );
      if (webhook.url)
        throw new Error(
          "这个机器人已连接其他服务，请先核实，不会自动覆盖原连接",
        );
      await saveBotConfig({
        revision: randomUUID(),
        token: body.token,
        botId: me.id,
        username: me.username,
        name: me.first_name,
        enabled: false,
        chatId: null,
        chatTitle: "",
        activatedAt: 0,
        updatedBy: actor.id,
      });
    } else {
      if (!config) throw new Error("请先填写并验证 Token");
      if (body.action === "discover") {
        if (config.enabled) throw new Error("请先暂停机器人再读取待绑定群");
        const updates = await telegram<TelegramUpdate[]>(
          config.token,
          "getUpdates",
          {
            timeout: 0,
            limit: 100,
            allowed_updates: ["message", "my_chat_member"],
          },
        );
        const groups = new Map<string, { id: string; title: string }>();
        for (const item of updates) {
          const chat = item.message?.chat || item.my_chat_member?.chat;
          if (chat && ["group", "supergroup"].includes(chat.type))
            groups.set(String(chat.id), {
              id: String(chat.id),
              title: chat.title || String(chat.id),
            });
        }
        return { groups: [...groups.values()] };
      }
      if (body.action === "bind") {
        if (config.enabled) throw new Error("请先暂停机器人再更换群");
        const chat = await telegram<{
          id: number;
          type: string;
          title: string;
        }>(config.token, "getChat", { chat_id: body.chatId });
        if (!["group", "supergroup"].includes(chat.type))
          throw new Error("只能绑定电报群");
        const member = await telegram<{
          status: string;
          can_send_messages?: boolean;
          can_send_documents?: boolean;
        }>(config.token, "getChatMember", {
          chat_id: chat.id,
          user_id: config.botId,
        });
        if (
          ["left", "kicked"].includes(member.status) ||
          member.can_send_messages === false ||
          member.can_send_documents === false
        )
          throw new Error("请先将机器人加入群，并允许发消息和文件");
        await saveBotConfig({
          ...config,
          chatId: String(chat.id),
          chatTitle: chat.title,
          updatedBy: actor.id,
        });
      } else if (body.action === "enable") {
        if (!config.chatId) throw new Error("请先绑定群");
        await saveBotConfig({
          ...config,
          enabled: true,
          activatedAt: Date.now(),
          updatedBy: actor.id,
        });
      } else
        await saveBotConfig({ ...config, enabled: false, updatedBy: actor.id });
    }
    return {
      config: publicConfig(await readBotConfig()),
      status: await readStatus(),
      aiReady: Boolean(process.env.DEEPSEEK_API_KEY),
    };
  };
  const pending = queue.then(operation);
  queue = pending.then(
    () => undefined,
    () => undefined,
  );
  try {
    return NextResponse.json(await pending, { headers });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "设置失败，请重试" },
      { status: 400, headers },
    );
  }
}
