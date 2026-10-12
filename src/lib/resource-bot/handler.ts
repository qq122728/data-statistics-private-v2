import { readBotConfig, type BotConfig } from "./config";
import { addressedQuestion, authorizedConversation, telegram, type TelegramMessage } from "./telegram";
import {
  parseResourceQuestion,
  RESOURCE_BOT_HELP,
  type ResourceQuery,
} from "./query";
import {
  loadResourceBotData,
  loadResourceBotCatalog,
  type ResourceBotData,
} from "./data";
import { exportResourceReport, renderResourceReport } from "./render";
import { statisticsDate } from "../statistics-date";
import { converseWithHermes, hermesEnabled } from "./hermes";

type Dependencies = {
  readConfig: typeof readBotConfig;
  parse: typeof parseResourceQuestion;
  load: (q: ResourceQuery, today: string) => Promise<ResourceBotData>;
  catalog: typeof loadResourceBotCatalog;
  send: (
    token: string,
    method: string,
    body: Record<string, unknown> | FormData,
  ) => Promise<unknown>;
  now: () => number;
  useHermes: typeof hermesEnabled;
  converse: typeof converseWithHermes;
};
export function createResourceBotHandler(
  overrides: Partial<Dependencies> = {},
) {
  const deps: Dependencies = {
    readConfig: readBotConfig,
    parse: parseResourceQuestion,
    load: loadResourceBotData,
    catalog: loadResourceBotCatalog,
    send: telegram,
    now: Date.now,
    useHermes: hermesEnabled,
    converse: converseWithHermes,
    ...overrides,
  };
  const history = new Map<string, { at: number; query: ResourceQuery }>();
  const rates = new Map<string, number[]>();
  let lastSendAt = 0;
  function allow(key: string, limit: number) {
    const now = deps.now();
    for (const [k, list] of rates)
      if (!list.some((t) => t > now - 60000)) rates.delete(k);
    const active = (rates.get(key) || []).filter((t) => t > now - 60000);
    if (active.length >= limit) return false;
    rates.set(key, [...active, now]);
    return true;
  }
  return async (
    message: TelegramMessage,
    config: BotConfig,
  ): Promise<boolean> => {
    if (!config.enabled || !config.chatId) return false;
    const text = addressedQuestion(
      message,
      config.username,
      config.chatId,
      config.activatedAt,
      config.privateUserIds,
    );
    if (text === null) return false;
    const destination = String(message.chat.id);
    const key = `${config.revision}:${destination}:${message.from!.id}`;
    if (!allow(key, 5) || !allow("chat:" + destination, 20)) return false;
    const guard = async () => {
      const latest = await deps.readConfig();
      if (
        !latest?.enabled ||
        latest.revision !== config.revision ||
        !authorizedConversation(message, latest.chatId, latest.privateUserIds)
      )
        throw Error("CONFIG_CHANGED");
    };
    const reply = async (body: string) => {
      // Plain text avoids Telegram HTML/Markdown injection from imported names.
      const chunks = body.match(/[\s\S]{1,3400}/gu) || ["未找到结果"];
      for (const text of chunks) {
        if (!overrides.send) {
          await new Promise((r) =>
            setTimeout(r, Math.max(0, 3100 - (Date.now() - lastSendAt))),
          );
          lastSendAt = Date.now();
        }
        await guard();
        await deps.send(config.token, "sendMessage", {
          chat_id: destination,
          text,
          ...(message.message_thread_id
            ? { message_thread_id: message.message_thread_id }
            : {}),
          reply_parameters: {
            message_id: message.message_id,
            allow_sending_without_reply: false,
          },
          link_preview_options: { is_disabled: true },
        });
      }
    };
    const sendFile = async (document: Uint8Array, filename: string) => {
      const form = new FormData();
      form.set("chat_id", destination);
      form.set(
        "document",
        new Blob([document as BlobPart], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        filename,
      );
      form.set("caption", "资源查询结果｜完整号码与金额口径见查询说明");
      form.set(
        "reply_parameters",
        JSON.stringify({
          message_id: message.message_id,
          allow_sending_without_reply: false,
        }),
      );
      if (message.message_thread_id)
        form.set("message_thread_id", String(message.message_thread_id));
      if (!overrides.send) {
        await new Promise((r) =>
          setTimeout(r, Math.max(0, 3100 - (Date.now() - lastSendAt))),
        );
        lastSendAt = Date.now();
      }
      await guard();
      await deps.send(config.token, "sendDocument", form);
    };
    try {
      await guard();
      for (const [k, v] of history)
        if (v.at < deps.now() - 600000) history.delete(k);
      const previous = history.get(key);
      if (
        deps.useHermes() &&
        !/^(下一页|导出\s*(?:Excel|表格)?|Excel)$/i.test(text)
      ) {
        const result = await deps.converse(
          text,
          key,
          config,
          statisticsDate(new Date(deps.now())),
          previous?.query,
          message.chat.type === "private" ? "private" : "group",
        );
        await reply(result.text);
        for (const document of result.documents)
          await sendFile(document.bytes, document.filename);
        if (result.lastQuery)
          history.set(key, {
            at: deps.now(),
            query: { ...result.lastQuery, excel: false },
          });
        return true;
      }
      let q: ResourceQuery;
      if (/^(下一页|导出\s*(?:Excel|表格)?|Excel)$/i.test(text)) {
        if (!previous) {
          await reply(
            "请先问一条查询，例如“本月投手效果”，再说下一页或导出 Excel。",
          );
          return true;
        }
        q = {
          ...previous.query,
          page:
            text === "下一页" ? previous.query.page + 1 : previous.query.page,
          excel: text !== "下一页",
        };
      } else
        q = await deps.parse(
          text,
          statisticsDate(new Date(deps.now())),
          /^(帮助|菜单|\/start|\/help)$/.test(text)
            ? undefined
            : await deps.catalog(),
        );
      if (q.view === "help") {
        await reply(RESOURCE_BOT_HELP);
        return true;
      }
      const data = await deps.load(q, statisticsDate(new Date(deps.now())));
      const document = q.excel ? await exportResourceReport(q, data) : null;
      await reply(renderResourceReport(q, data));
      if (document)
        await sendFile(
          document,
          `resource-${q.view}-${data.range?.from || "all"}.xlsx`,
        );
      history.set(key, { at: deps.now(), query: { ...q, excel: false } });
      return true;
    } catch (e) {
      if (e instanceof Error && e.message === "CONFIG_CHANGED") return false;
      const reason =
        e instanceof Error &&
        /^[\u4e00-\u9fff]/.test(e.message) &&
        e.message.length <= 220
          ? e.message
          : "查询暂时未完成，请稍后重试；不会修改业务数据。";
      try {
        await reply(reason);
      } catch {
        /* A send failure is not retried automatically, to avoid duplicate files/messages. */
      }
      return false;
    }
  };
}
