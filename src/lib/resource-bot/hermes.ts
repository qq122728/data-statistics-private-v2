import { createServer, type Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readBotConfig, type BotConfig } from "./config";
import { loadResourceBotCatalog, loadResourceBotData } from "./data";
import {
  wantsExcel,
  queryBounds,
  querySchema,
  type QueryCatalog,
  type ResourceQuery,
} from "./query";
import { exportResourceReport, renderResourceReport } from "./render";
import { COUNTRIES, isCountry } from "../../../packages/resource-buyer/options";

type Export = { bytes: Uint8Array; filename: string };
type Run = {
  text: string;
  config: BotConfig;
  today: string;
  previous?: ResourceQuery;
  expires: number;
  calls: number;
  lastQuery?: ResourceQuery;
  documents: Export[];
};
const runs = new Map<string, Run>();
const envelope = z
  .object({
    runId: z.string().regex(/^[a-f0-9]{48}$/),
    query: z.unknown().optional(),
  })
  .strict();
export function hermesEnabled() {
  return process.env.RESOURCE_HERMES_ENABLED === "1";
}
export function authorizeHermesRequest(
  value: string | undefined,
  secret: string,
) {
  const expected = Buffer.from("Bearer " + secret),
    actual = Buffer.from(value || "");
  return (
    secret.length >= 32 &&
    expected.length === actual.length &&
    timingSafeEqual(expected, actual)
  );
}
export function enforceHermesScope(
  query: unknown,
  text: string,
  catalog: QueryCatalog,
  previous?: ResourceQuery,
) {
  const q = querySchema.parse(query);
  const upper = text.toUpperCase();
  for (const [field, values] of [
    [
      "channel",
      [
        ...catalog.channels,
        ...(text.match(/\bFB-[A-Z0-9]+\b/gi) || []).map((v) => v.toUpperCase()),
      ],
    ],
    ["buyer", catalog.buyers],
    ["material", catalog.materials],
  ] as const) {
    let matches = [...new Set(values)].filter(
      (v) => v && upper.includes(v.toUpperCase()),
    );
    matches = matches.filter(
      (v) => !matches.some((other) => other !== v && other.includes(v)),
    );
    if (matches.length === 1) q[field] = matches[0];
    else if (matches.length > 1 && !matches.includes(q[field]))
      throw Error("请一次指定一个对比对象查询，不能忽略已指定的范围");
  }
  const country = COUNTRIES.filter((c) => text.includes(c.name));
  if (country.length === 1) q.country = country[0].code;
  if (country.length > 1 && !country.some((c) => c.code === q.country))
    throw Error("请按已指定国家分别查询");
  if (q.country && !isCountry(q.country)) throw Error("国家名称未识别");
  if (/短信/.test(text) && !/投流|FB/i.test(text)) q.type = "SMS";
  if (/投流/.test(text) && !/短信/.test(text)) q.type = "ADS";
  if (q.type === "SMS" && q.dimension === "material")
    throw Error("短信按渠道、供应方和国家分析，不使用素材统计");
  if (catalog.groups.some((g) => g && text.includes(g) && g !== q.buyer))
    throw Error(
      "小组筛选目前请在网页操作；机器人支持渠道、投手、国家、素材与号码",
    );
  if (q.view === "phone") {
    const phones: string[] = text.match(/(?<!\d)\d{6,20}(?!\d)/g) || [];
    if (
      !/^\d{6,20}$/.test(q.phone) ||
      (!phones.includes(q.phone) && previous?.phone !== q.phone)
    )
      throw Error("请提供连续的完整号码，不能猜测号码");
  }
  q.excel = wantsExcel(text);
  return q;
}
export async function startHermesQueryServer(): Promise<Server | null> {
  if (!hermesEnabled()) return null;
  const secret = process.env.RESOURCE_HERMES_TOKEN || "";
  if (secret.length < 32) throw Error("Hermes connection is not configured");
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    if (!authorizeHermesRequest(req.headers.authorization, secret))
      return send(403, { error: "查询连接未授权" });
    if (
      req.method !== "POST" ||
      !["/query", "/catalog"].includes(req.url || "")
    )
      return send(404, { error: "接口不存在" });
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) return send(413, { error: "查询过长" });
        chunks.push(chunk);
      }
      const body = envelope.parse(JSON.parse(Buffer.concat(chunks).toString()));
      const run = runs.get(body.runId);
      if (!run || run.expires < Date.now())
        return send(403, { error: "本次查询已结束，请重新提问" });
      const latest = await readBotConfig();
      if (
        !latest?.enabled ||
        latest.revision !== run.config.revision ||
        latest.chatId !== run.config.chatId
      )
        return send(403, { error: "机器人配置已变更" });
      if (++run.calls > 8)
        return send(429, { error: "单次问题最多查询8次，请缩小范围" });
      const catalog = await loadResourceBotCatalog();
      if (req.url === "/catalog")
        return send(200, {
          ...catalog,
          today: run.today,
          scope:
            "仅投流与短信渠道；客户号码为业务记录，投手及素材归属需要资源部登记。",
        });
      const q = enforceHermesScope(body.query, run.text, catalog, run.previous);
      queryBounds(q, run.today);
      if (q.view === "help")
        return send(400, {
          error: "请使用范围查询了解可查渠道，或选择业务查询类型",
        });
      const data = await loadResourceBotData(q, run.today);
      if (q.excel) {
        if (run.documents.length >= 2)
          return send(400, { error: "一次最多导出两份，请收窄查询" });
        run.documents.push({
          bytes: await exportResourceReport(q, data),
          filename: `resource-${q.view}-${data.range?.from || "all"}.xlsx`,
        });
      }
      run.lastQuery = q;
      return send(200, {
        query: q,
        text: renderResourceReport(q, data),
        excelPrepared: q.excel,
        recordCount: data.details.length,
        summaryCount: data.summary.length,
      });
    } catch (e) {
      return send(400, {
        error:
          e instanceof Error &&
          /^[\u4e00-\u9fff]/.test(e.message) &&
          e.message.length < 220
            ? e.message
            : "查询未完成，请检查筛选条件；未修改业务数据",
      });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(4187, "127.0.0.1", () => resolve());
  });
  return server;
}
export async function converseWithHermes(
  text: string,
  session: string,
  config: BotConfig,
  today: string,
  previous?: ResourceQuery,
) {
  const id = randomBytes(24).toString("hex");
  const run: Run = {
    text,
    config,
    today,
    previous,
    expires: Date.now() + 150000,
    calls: 0,
    documents: [],
  };
  runs.set(id, run);
  try {
    const response = await fetch("http://127.0.0.1:4188/converse", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + process.env.RESOURCE_HERMES_TOKEN,
      },
      body: JSON.stringify({ text, session, runId: id, today }),
      signal: AbortSignal.timeout(140000),
    });
    const result = z
      .object({ text: z.string().min(1).max(12000) })
      .strict()
      .safeParse(await response.json());
    if (!response.ok || !result.success)
      throw Error("Hermes 暂时未完成回复，请稍后再试");
    if (
      !run.lastQuery &&
      /开单|首充|续充|消耗|成本|号码|效果/.test(text) &&
      !/能做|能查|能分析|会分析|功能|帮助|怎么用|是什么意思|怎么算/.test(text)
    )
      throw Error("本次没有取得实际查询结果，请明确渠道或日期再问一次");
    return {
      text: result.data.text,
      lastQuery: run.lastQuery,
      documents: run.documents,
    };
  } finally {
    runs.delete(id);
  }
}
