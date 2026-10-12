export type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  date: number;
  text?: string;
  chat: { id: number; type: string; title?: string };
  from?: { id: number; is_bot?: boolean };
  sender_chat?: unknown;
  forward_origin?: unknown;
  entities?: Array<{ type: string; offset: number; length: number }>;
};
export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  my_chat_member?: { chat: TelegramMessage["chat"] };
};
export async function telegram<T>(
  token: string,
  method: string,
  body: Record<string, unknown> | FormData = {},
  timeout = 35000,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      ...(body instanceof FormData
        ? { body }
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new Error("电报连接失败，请稍后重试");
  }
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    result: T;
    error_code?: number;
  } | null;
  if (!response.ok || !data?.ok)
    throw new Error(
      `电报请求失败（${data?.error_code || response.status}），请检查 Token、群及机器人权限`,
    );
  return data.result;
}
export function addressedQuestion(
  message: TelegramMessage,
  username: string,
  chatId: string,
  activatedAt: number,
): string | null {
  if (
    String(message.chat.id) !== chatId ||
    !["group", "supergroup"].includes(message.chat.type) ||
    !message.from ||
    message.from.is_bot ||
    message.sender_chat ||
    message.forward_origin ||
    message.date * 1000 < activatedAt - 5000
  )
    return null;
  const text = message.text || "";
  if (text.length > 1500) return null;
  const spans = (message.entities || []).filter((e) => {
    const value = text.slice(e.offset, e.offset + e.length).toLowerCase();
    return (
      (e.type === "mention" && value === "@" + username.toLowerCase()) ||
      (e.type === "bot_command" && value.endsWith("@" + username.toLowerCase()))
    );
  });
  if (!spans.length) return null;
  let question = text;
  for (const e of spans.sort((a, b) => b.offset - a.offset)) {
    const value = text.slice(e.offset, e.offset + e.length);
    question =
      question.slice(0, e.offset) +
      (e.type === "bot_command"
        ? value.split("@")[0].replace(/^\/(?:query|ask)$/, "")
        : "") +
      question.slice(e.offset + e.length);
  }
  return question.trim() || "帮助";
}
