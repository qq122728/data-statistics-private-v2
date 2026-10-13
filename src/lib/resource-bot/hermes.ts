import { createServer, type Server } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { statisticsDate } from "../statistics-date";
import { readBotConfig, type BotConfig } from "./config";
import { loadResourceBotCatalog, loadResourceBotData } from "./data";
import {
  wantsExcel,
  queryBounds,
  querySchema,
  type QueryCatalog,
  type ResourceQuery,
} from "./query";
import { exportResourceReport, exportResourceWorkbook, renderResourceReport, type ResourceReportSnapshot } from "./render";
import { COUNTRIES, isCountry } from "../../../packages/resource-buyer/options";
import { RESOURCE_MENU_QUERIES } from "./commands";
import { db } from "../db";
import { mentionsQueryName } from "./query-names";

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
  reports: Map<string, ResourceReportSnapshot>;
  privateUserId?: string;
  native?: boolean;
  sessionKey?: string;
};
const runs = new Map<string, Run>();
const nativeTurns = new Map<string, string>();
const nativePrevious = new Map<string, { query: ResourceQuery; expires: number }>();
export const nativeContextSchema = z.object({
  platform: z.literal("telegram"), chatId: z.string().regex(/^-?\d{1,20}$/),
  userId: z.string().regex(/^[1-9]\d{0,19}$/), chatType: z.enum(["dm", "private", "group", "supergroup", "forum"]),
  sessionId: z.string().min(1).max(250), messageId: z.string().regex(/^\d{1,30}$/),
  text: z.string().min(1).max(6000),
}).strict();
export function authorizeNativeContext(input: unknown, config: BotConfig) {
  const c = nativeContextSchema.parse(input);
  if (!config.enabled || ((c.chatType === "dm" || c.chatType === "private")
    ? c.chatId !== c.userId || !config.privateUserIds?.includes(c.userId)
    : c.chatId !== config.chatId)) throw Error("当前对话未授权资源查询");
  return c;
}
async function publishNativeDocument(run: Run, bytes: Uint8Array) {
  if (!run.native) return {};
  const dir = process.env.RESOURCE_REPORT_DIR;
  if (!dir || !dir.startsWith("/")) throw Error("报表输出目录未配置");
  const path = resolve(dir, `resource-${randomBytes(24).toString("hex")}.xlsx`);
  await writeFile(path, bytes, { mode: 0o640, flag: "wx" });
  // The service umask is 0077; explicitly grant only the Hermes report-reader group.
  await chmod(path, 0o640);
  return { media: `MEDIA:${path}`, delivery: "将 media 原样放到最终回复中，由 Hermes 发至当前对话" };
}
const envelope = z
  .object({
    runId: z.string().regex(/^[a-f0-9]{48}$/),
    query: z.unknown().optional(),
    workbook: z.unknown().optional(),
  })
  .strict();
export const workbookSchema = z.object({
  reportIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1).max(4),
}).strict();
export function resolveWorkbookReports(input: unknown, reports: Map<string, ResourceReportSnapshot>) {
  const { reportIds } = workbookSchema.parse(input);
  if (new Set(reportIds).size !== reportIds.length) throw Error("请不要重复加入同一份报表");
  return reportIds.map(id => {
    const report = reports.get(id);
    if (!report) throw Error("报表已过期或不属于本次查询，请重新查询后制表");
    return report;
  });
}
export function hermesEnabled() {
  return process.env.RESOURCE_HERMES_ENABLED === "1";
}
export async function assertResourceReadOnlyDatabase(): Promise<void> {
  // This service must never run with the website's write-capable database account.
  if (!/^postgres(?:ql)?:/.test(process.env.DATABASE_URL || ""))
    throw Error("资源机器人必须使用独立的只读业务数据库连接");
  const [access] = await db.$queryRaw<Array<{ elevated: boolean; writes: number; schema_create: boolean; database_create: boolean }>>`
    SELECT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls) AS elevated,
      (SELECT COUNT(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
       AND has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER')) AS writes,
      has_schema_privilege(current_user,'public','CREATE') AS schema_create,
      has_database_privilege(current_user,current_database(),'CREATE') AS database_create
    FROM pg_roles r WHERE r.rolname=current_user`;
  if (!access || access.elevated || access.writes || access.schema_create || access.database_create)
    throw Error("资源机器人数据库权限不是只读，已拒绝启动查询服务");
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
  const menu = Object.values(RESOURCE_MENU_QUERIES).find((entry) => entry.text === text);
  if (menu) return querySchema.parse({ view: menu.view, type: menu.type });
  const q = querySchema.parse(query);
  if (/日报|预警|业绩分析/.test(text) && !/单个号码|开单号码|号码详情/.test(text)) q.view = "analysis";
  // Missing attribution must not make the agent silently replace an effects report
  // with orders. Mixed requests can still explicitly ask for both report types.
  if (/效果/.test(text) && !/日报|预警|分析|成熟|续充周期|收款/.test(text) &&
      !/开单(?:号码|明细|客户)|号码(?:明细|详情)|待核对|异常|\d{6,20}/.test(text))
    q.view = "effects";
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
      (v) => mentionsQueryName(text, v),
    );
    matches = matches.filter(
      (v) => !matches.some((other) => other !== v && other.includes(v)),
    );
    if (matches.length === 1) q[field] = matches[0];
    else if (matches.length > 1 && !matches.includes(q[field]))
      throw Error("请一次指定一个对比对象查询，不能忽略已指定的范围");
    if (q[field] && !mentionsQueryName(text, q[field]) && previous?.[field] !== q[field])
      throw Error("不能确认指定的渠道、投手或素材名称，请使用实际名称重新查询");
  }
  const country = COUNTRIES.filter((c) => text.includes(c.name));
  if (country.length === 1) q.country = country[0].code;
  if (country.length > 1 && !country.some((c) => c.code === q.country))
    throw Error("请按已指定国家分别查询");
  if (q.country && !isCountry(q.country)) throw Error("国家名称未识别");
  const positiveText = text.replace(/(?:不看|不查|不要|不包含|排除)\s*(?:投流|短信)/g, "");
  if (/短信/.test(positiveText) && !/投流|FB/i.test(positiveText)) q.type = "SMS";
  if (/投流/.test(positiveText) && !/短信/.test(positiveText)) q.type = "ADS";
  if (previous && previous.type !== q.type) {
    for (const field of ["channel", "buyer", "material"] as const)
      if (q[field] && !mentionsQueryName(text, q[field])) q[field] = "";
  }
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
  await assertResourceReadOnlyDatabase();
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
      !["/query", "/catalog", "/workbook", "/native/begin"].includes(req.url || "")
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
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (req.url === "/native/begin") {
        if (process.env.RESOURCE_NATIVE_GATEWAY !== "1") return send(404, { error: "接口未启用" });
        const config = await readBotConfig();
        if (!config) return send(403, { error: "机器人未配置" });
        const c = authorizeNativeContext(input, config);
        const now = Date.now();
        for (const [id, item] of runs) if (item.expires < now) runs.delete(id);
        for (const [key, id] of nativeTurns) if (!runs.has(id)) nativeTurns.delete(key);
        for (const [key, item] of nativePrevious) if (item.expires < now) nativePrevious.delete(key);
        const sessionKey = createHash("sha256").update(JSON.stringify([c.chatId, c.userId, c.sessionId])).digest("hex");
        const turnKey = sessionKey + ":" + c.messageId;
        const existing = nativeTurns.get(turnKey);
        if (existing && runs.has(existing)) return send(200, { runId: existing });
        if (runs.size >= 100 || nativePrevious.size >= 1000) return send(429, { error: "查询繁忙，请稍后再试" });
        const runId = randomBytes(24).toString("hex");
        runs.set(runId, { text: c.text, config, today: statisticsDate(new Date()),
          previous: nativePrevious.get(sessionKey)?.query, expires: now + 300000,
          calls: 0, documents: [], reports: new Map(), native: true, sessionKey,
          privateUserId: c.chatType === "dm" || c.chatType === "private" ? c.userId : undefined });
        nativeTurns.set(turnKey, runId);
        return send(200, { runId });
      }
      const body = envelope.parse(input);
      const run = runs.get(body.runId);
      if (!run || run.expires < Date.now())
        return send(403, { error: "本次查询已结束，请重新提问" });
      const latest = await readBotConfig();
      if (
        !latest?.enabled ||
        latest.revision !== run.config.revision ||
        latest.chatId !== run.config.chatId ||
        (run.privateUserId && !latest.privateUserIds?.includes(run.privateUserId))
      )
        return send(403, { error: "机器人配置已变更" });
      if (++run.calls > 12)
        return send(429, { error: "单次问题最多调用12次工具，请缩小范围" });
      if (req.url === "/workbook") {
        if (!wantsExcel(run.text)) return send(400, { error: "请先明确要求生成或导出 Excel" });
        const reports = resolveWorkbookReports(body.workbook, run.reports);
        const bytes = await exportResourceWorkbook(reports);
        // A combined workbook replaces interim single-report exports in this request.
        run.documents = [{ bytes, filename: `resource-comparison-${run.today}.xlsx` }];
        return send(200, { ...await publishNativeDocument(run, bytes), excelPrepared: true, reportCount: reports.length, destination: "原对话", message: "综合 Excel 已生成，将由系统随回复发送" });
      }
      const catalog = await loadResourceBotCatalog();
      if (req.url === "/catalog")
        return send(200, {
          ...catalog,
          today: run.today,
          scope:
            "仅投流与短信渠道；客户号码为业务记录，投手及素材归属需要资源部登记。",
        });
      const q = enforceHermesScope(body.query, run.text, catalog, run.previous);
      // Explicit tool choice lets Hermes query several reports before building one workbook.
      q.excel = wantsExcel(run.text) && (body.query as { excel?: unknown })?.excel === true;
      queryBounds(q, run.today);
      if (q.view === "help")
        return send(400, {
          error: "请使用范围查询了解可查渠道，或选择业务查询类型",
        });
      const data = await loadResourceBotData(q, run.today);
      let reportId: string | undefined;
      if (data.details.length <= 5000 && data.summary.length <= 5000 && data.spends.length <= 5000 && (!data.analysis || data.analysis.details.length + data.analysis.trends.length + data.analysis.maturity.length <= 10000)) {
        reportId = randomBytes(12).toString("hex");
        if (run.reports.size >= 4) run.reports.delete(run.reports.keys().next().value!);
        run.reports.set(reportId, { query: q, data });
      }
      let nativeDocument = {};
      if (q.excel) {
        if (run.documents.length >= 2)
          return send(400, { error: "一次最多导出两份，请收窄查询" });
        const bytes = await exportResourceReport(q, data);
        nativeDocument = await publishNativeDocument(run, bytes);
        run.documents.push({
          bytes,
          filename: `resource-${q.view}-${data.range?.from || "all"}.xlsx`,
        });
      }
      run.lastQuery = q;
      if (run.sessionKey) nativePrevious.set(run.sessionKey, { query: q, expires: Date.now() + 3600000 });
      return send(200, {
        ...nativeDocument,
        query: q,
        text: renderResourceReport(q, data),
        excelPrepared: q.excel,
        analysis: data.analysis ? { ...data.analysis, coverage: undefined, attribution: undefined,
          sources: data.analysis.sources.slice((q.page-1)*8,q.page*8), sourceTotal:data.analysis.sources.length,
          details: data.analysis.details.slice((q.page - 1) * 5, q.page * 5),
          detailTotal: data.analysis.details.length,
          trends: data.analysis.trends.filter(t => t.comparable).slice(0, 30),
          trendTotal: data.analysis.trends.length,
          comparableTrendTotal: data.analysis.trends.filter(t => t.comparable).length,
          warnings: data.analysis.warnings.slice(0, 30), warningTotal: data.analysis.warnings.length,
        } : undefined,
        recordCount: data.analysis?.details.length ?? data.details.length,
        summaryCount: data.analysis?.cohorts.length ?? data.summary.length,
        reportId,
        structuredRows: (data.analysis ? data.analysis.details : q.view === "phone" || q.view === "orders" ? data.details : data.summary).slice((q.page - 1) * 5, q.page * 5),
        workbookHint: reportId ? "可将最近4份报表的 reportId 交给 create_resource_workbook 合成一份Excel；无需逐页导出" : "结果过大，请缩小范围后制表",
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
    server.listen(Number(process.env.RESOURCE_QUERY_PORT || 4187), "127.0.0.1", () => resolve());
  });
  return server;
}
export async function converseWithHermes(
  text: string,
  session: string,
  config: BotConfig,
  today: string,
  previous?: ResourceQuery,
  chatType: "group" | "private" = "group",
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
    reports: new Map(),
    privateUserId: chatType === "private" ? session.split(":").at(-1) : undefined,
  };
  runs.set(id, run);
  try {
    const response = await fetch("http://127.0.0.1:4188/converse", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + process.env.RESOURCE_HERMES_TOKEN,
      },
      body: JSON.stringify({ text, session, runId: id, today, chatType, previousQuery: previous ? JSON.stringify(previous) : "" }),
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
    if (run.lastQuery && wantsExcel(text) && !run.documents.length)
      throw Error("本次查询已取得数据，但 Excel 尚未生成。请重试导出，或缩小查询范围。");
    return {
      text: result.data.text,
      lastQuery: run.lastQuery,
      documents: run.documents,
    };
  } finally {
    runs.delete(id);
  }
}

export async function resetHermesSession(session: string): Promise<void> {
  try {
    const response = await fetch("http://127.0.0.1:4188/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + process.env.RESOURCE_HERMES_TOKEN,
      },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || result?.reset !== true) throw Error("RESET_FAILED");
  } catch {
    throw Error("未能确认新建对话成功，请稍后重试 /new。");
  }
}

export async function resourceHermesStatus(): Promise<string> {
  const response = await fetch("http://127.0.0.1:4188/capabilities", {
    method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + process.env.RESOURCE_HERMES_TOKEN },
    body: "{}", signal: AbortSignal.timeout(10000),
  });
  const status = z.object({ engine: z.literal("Hermes AIAgent"), allowedTools: z.array(z.string()),
    verifiedTools: z.array(z.string()), businessWrite: z.literal(false), arbitraryCode: z.literal(false) }).strict().parse(await response.json());
  const expected = ["create_resource_workbook", "describe_resource_scope", "query_resource_report"].sort();
  if (!response.ok || JSON.stringify([...status.allowedTools].sort()) !== JSON.stringify(expected) ||
      (status.verifiedTools.length && JSON.stringify([...status.verifiedTools].sort()) !== JSON.stringify(expected)))
    throw Error("机器人权限检查未通过，请联系管理员");
  return `资源参谋｜Hermes 业务助手\n连接正常；${status.verifiedTools.length ? "运行时工具白名单已核对" : "等待首次业务查询核对运行工具"}。\n\n可以：自主分步查询、投流/短信对比、号码与金额查询、生成含多份报表的 Excel。\n权限：业务数据库只读；不提供改数据、改账号、执行代码或修改服务器的工具。\n\n群聊和私聊条件独立；/new 清空当前条件，/help 查看示例。`;
}
