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

async function sendTelegramAttachment(input: {
  method: "sendPhoto" | "sendDocument";
  field: "photo" | "document";
  bytes: Buffer;
  fileName: string;
  contentType: string;
  caption?: string;
}) {
  const { token, chatId } = telegramConfig();
  const form = new FormData();
  form.set("chat_id", chatId);
  if (input.caption) form.set("caption", input.caption);
  form.set(input.field, new Blob([new Uint8Array(input.bytes)], { type: input.contentType }), input.fileName);
  const response = await fetch(`https://api.telegram.org/bot${token}/${input.method}`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json() as TelegramResponse;
  if (!response.ok || !payload.ok) {
    throw new TelegramMessageRejectedError(payload.description || `电报附件发送失败（HTTP ${response.status}）`);
  }
}

export async function sendBossTelegramPhoto(bytes: Buffer, caption?: string) {
  await sendTelegramAttachment({ method: "sendPhoto", field: "photo", bytes, fileName: "group-daily-report.png", contentType: "image/png", caption });
}

export async function sendBossTelegramDocument(bytes: Buffer, fileName: string, caption?: string) {
  await sendTelegramAttachment({ method: "sendDocument", field: "document", bytes, fileName, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", caption });
}
