type TelegramResponse = { ok: boolean; description?: string };

/** Telegram 已明确返回失败，因此可以安全重试，不会把一次成功发送变成两次。 */
export class TelegramMessageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramMessageRejectedError";
  }
}

function telegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_BOSS_CHAT_ID?.trim();
  if (!token || !chatId) throw new Error("未配置电报机器人或老板群");
  return { token, chatId };
}

export function splitTelegramText(text: string, maxLength = 3900): string[] {
  if (text.length <= maxLength) return [text];
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > maxLength) {
      parts.push(current);
      current = "";
    }
    if (line.length > maxLength) {
      if (current) parts.push(current);
      for (let offset = 0; offset < line.length; offset += maxLength) parts.push(line.slice(offset, offset + maxLength));
    } else current += `${current ? "\n" : ""}${line}`;
  }
  if (current) parts.push(current);
  return parts;
}

export async function sendBossTelegramChunk(text: string): Promise<void> {
  const { token, chatId } = telegramConfig();
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as TelegramResponse;
  if (!response.ok || !payload.ok) {
    throw new TelegramMessageRejectedError(payload.description || `电报发送失败（HTTP ${response.status}）`);
  }
}

export async function sendBossTelegramMessage(text: string): Promise<void> {
  for (const part of splitTelegramText(text)) {
    await sendBossTelegramChunk(part);
  }
}
