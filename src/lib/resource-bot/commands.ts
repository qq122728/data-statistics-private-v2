import type { BotConfig } from "./config";
import { telegram } from "./telegram";

export const RESOURCE_BOT_COMMANDS = [
  { command: "new", description: "新建对话 · 清空当前查询条件" },
  { command: "help", description: "使用说明与查询示例" },
  { command: "effects", description: "本月投手效果" },
  { command: "sms", description: "本月短信粉效果" },
  { command: "orders", description: "本月开单号码" },
  { command: "next", description: "当前查询的下一页" },
  { command: "export", description: "导出当前查询为 Excel" },
];

// Commands never go to the model as text that merely *claims* an action happened.
export function resourceCommand(text: string, username: string) {
  const match = text.match(/^\/([a-z_]+)(?:@([a-z0-9_]+))?(?:\s+(.*))?$/i);
  if (!match) return null;
  if (match[2] && match[2].toLowerCase() !== username.toLowerCase())
    return { kind: "ignore" } as const;
  const command = match[1].toLowerCase();
  if (match[3]?.trim()) return { kind: "invalid" } as const;
  if (command === "new") return { kind: "reset" } as const;
  if (command === "help" || command === "start") return { kind: "help" } as const;
  const questions: Record<string, string> = {
    effects: "本月全部投流渠道的投手效果，不限定投手、国家和素材",
    sms: "本月全部短信渠道的供应方效果，不限定供应方、国家和素材",
    orders: "本月全部渠道的开单号码，不限定投手和国家",
    next: "下一页",
    export: "导出 Excel",
  };
  return questions[command]
    ? { kind: "query" as const, text: questions[command], fresh: !["next", "export"].includes(command) }
    : { kind: "invalid" } as const;
}

export async function syncResourceBotMenu(config: BotConfig, send = telegram) {
  if (!config.enabled || !config.chatId) throw Error("机器人未绑定");
  // Scoped menus do not grant access; the handler still validates every message.
  for (const chatId of [config.chatId, ...(config.privateUserIds || [])]) {
    for (const language_code of ["", "zh"]) {
      const scope = { type: "chat", chat_id: chatId };
      await send(config.token, "setMyCommands", { scope, language_code, commands: RESOURCE_BOT_COMMANDS });
      const actual = await send(config.token, "getMyCommands", { scope, language_code });
      if (JSON.stringify(actual) !== JSON.stringify(RESOURCE_BOT_COMMANDS))
        throw Error("菜单核对失败");
    }
    if (chatId !== config.chatId) {
      await send(config.token, "setChatMenuButton", { chat_id: chatId, menu_button: { type: "commands" } });
      const button = await send<{ type: string }>(config.token, "getChatMenuButton", { chat_id: chatId });
      if (button.type !== "commands") throw Error("菜单按钮核对失败");
    }
  }
}
