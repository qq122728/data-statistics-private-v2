import { z } from "zod";
import { numberEvents } from "../../packages/customer-sheet/number-statistics";
import { sheetStatisticsGroup } from "../../packages/customer-sheet/statistics-owner";
import type { SheetData } from "../../packages/customer-sheet/schema";
import { leadDateRangeForPreset } from "./lead-date-range";

export const bossOrderQuerySchema = z.object({
  view: z.enum(["orders", "channels", "phone"]).default("orders"),
  group: z.string().trim().max(80).default("全部"),
  period: z.enum(["today", "yesterday", "month", "lastMonth", "custom"]).default("month"),
  from: z.string().optional(),
  to: z.string().optional(),
  channel: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(24).optional(),
  page: z.number().int().min(1).max(100).default(1),
}).strict();

export type BossOrderQuery = z.infer<typeof bossOrderQuerySchema>;
export type BossGroup = { id: string; name: string; active: boolean; groupType: string; countryCode: string | null; department: { name: string; countryCode: string | null } };
export type BossChannel = { id: string; groupId: string; name: string };
export type BossSheetRow = { id: string; groupId: string; phone: string; data: string };
export type BossLegacyOrder = { id: string; phone: string; openedOn: string; initialDepositCents: number; batch: { groupId: string; channelId: string; sourceDate: string } };

type Order = {
  id: string; phone: string; groupId: string; channelId: string; channelName: string;
  intakeOn: string; orderOn: string; initialDepositCents: number; source: "号码跟踪" | "旧业务账";
};

const validDate = (value: string | undefined) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const groupAlias = (name: string) => name.replace(/^(WD|WM|WX)-/i, "").replace(/小组|组|部门|部/g, "");
const channelKey = (name: string) => name.trim().toLocaleUpperCase("en-US");

export function bossOrderBounds(query: BossOrderQuery, today: string) {
  if (query.view === "phone") return null;
  if (query.period === "custom" && (!validDate(query.from) || !validDate(query.to)))
    throw new Error("请提供有效的开始和结束日期，格式为 YYYY-MM-DD");
  if (query.period === "custom" && query.from! > query.to!) throw new Error("开始日期不能晚于结束日期");
  const range = leadDateRangeForPreset(query.period, today, query.from, query.to);
  if (range.from > range.to || range.to > today || Date.parse(range.to) - Date.parse(range.from) > 366 * 86400000)
    throw new Error("查询日期不能在未来，且一次最多查询一年");
  return range;
}

export function bossOrderGroups(groups: readonly BossGroup[], requested: string): BossGroup[] {
  const available = groups.filter((group) => group.active && group.groupType === "HACKER" && !group.name.includes("测试"));
  const value = groupAlias(requested.trim());
  if (["", "全部", "所有", "全部组", "全组"].includes(value)) return available;
  const country = ({ 美国: "US", 德国: "DE", 新加坡: "SG" } as Record<string, string>)[value];
  const matched = available.filter((group) => country
    ? (group.countryCode ?? group.department.countryCode) === country
    : group.name === requested || groupAlias(group.name) === value || groupAlias(group.department.name) === value);
  if (!matched.length) throw new Error("未找到这个小组或部门，请使用网页上的完整名称");
  if (!country && matched.length > 1 && !matched.every((group) => group.department.name === requested))
    throw new Error("名称对应多个小组，请使用完整组名");
  return matched;
}

function channelMatches(name: string, requested: string | undefined): boolean {
  if (!requested) return true;
  const actual = channelKey(name);
  const target = channelKey(requested).replace(/\*$/, "");
  return actual === target || actual.startsWith(`${target}-`) || actual.startsWith(`${target}_`);
}

function safeSheetData(value: string): SheetData | null {
  try { return JSON.parse(value) as SheetData; } catch { return null; }
}

function relativeDays(from: string, to: string): string {
  if (!validDate(from) || !validDate(to)) return "日期待补";
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  return days >= 0 ? `${days}天` : "日期顺序待核对";
}

export function renderBossOrderQuery(input: {
  query: BossOrderQuery;
  today: string;
  groups: readonly BossGroup[];
  channels: readonly BossChannel[];
  sheetRows: readonly BossSheetRow[];
  legacyOrders: readonly BossLegacyOrder[];
}) {
  const { query, today } = input;
  const range = bossOrderBounds(query, today);
  const selected = bossOrderGroups(input.groups, query.group);
  const groupIds = new Set(selected.map((group) => group.id));
  const groupNames = new Map(selected.map((group) => [group.id, group.name]));
  const channelNames = new Map(input.channels.map((channel) => [JSON.stringify([channel.groupId, channel.id]), channel.name]));
  const nameFor = (groupId: string, channelId: string) => channelNames.get(JSON.stringify([groupId, channelId])) ?? "原渠道";
  const orders: Order[] = [];
  const phoneDigits = query.phone?.replace(/\D/g, "");
  if ((query.view === "phone" || query.phone) && (!phoneDigits || phoneDigits.length < 6 || phoneDigits.length > 15))
    throw new Error("请提供至少 6 位、最多 15 位的客户号码或尾号");
  for (const row of input.sheetRows) {
    const data = safeSheetData(row.data);
    if (!data || data.__deletedAt) continue;
    const groupId = sheetStatisticsGroup(row.groupId, data);
    if (!groupIds.has(groupId)) continue;
    if (phoneDigits && !row.phone.endsWith(phoneDigits)) continue;
    const orderOn = numberEvents(data).find((event) => event.field === "orderCount")?.date ?? "";
    if (range && (!orderOn || orderOn < range.from || orderOn > range.to)) continue;
    const channelId = String(data.channelId ?? "");
    const channelName = nameFor(groupId, channelId) === "原渠道" ? nameFor(row.groupId, channelId) : nameFor(groupId, channelId);
    if (!channelMatches(channelName, query.channel)) continue;
    orders.push({ id: row.id, phone: row.phone, groupId, channelId, channelName, intakeOn: String(data.intakeOn ?? "").slice(0, 10), orderOn,
      initialDepositCents: orderOn ? Math.round(Number(data.firstDeposit ?? 0) * 100) : 0, source: "号码跟踪" });
  }
  for (const order of input.legacyOrders) {
    if (!groupIds.has(order.batch.groupId)) continue;
    if (phoneDigits && !order.phone.endsWith(phoneDigits)) continue;
    if (range && (order.openedOn < range.from || order.openedOn > range.to)) continue;
    if (!channelMatches(nameFor(order.batch.groupId, order.batch.channelId), query.channel)) continue;
    orders.push({ id: order.id, phone: order.phone, groupId: order.batch.groupId, channelId: order.batch.channelId,
      channelName: nameFor(order.batch.groupId, order.batch.channelId),
      intakeOn: order.batch.sourceDate, orderOn: order.openedOn, initialDepositCents: order.initialDepositCents, source: "旧业务账" });
  }
  const unique = [...new Map(orders.map((order) => [JSON.stringify([order.groupId, order.phone, order.orderOn]), order])).values()];
  unique.sort((a, b) => b.orderOn.localeCompare(a.orderOn) || a.phone.localeCompare(b.phone));
  const filtered = query.view === "phone" ? unique : unique.filter((order) => Boolean(order.orderOn));
  const scope = query.group || "全部";
  const heading = range ? `${range.from} 至 ${range.to}` : "号码查询";
  if (query.view === "phone") {
    if (!filtered.length) return { text: `没有找到尾号 ${phoneDigits} 在「${scope}」范围内的客户记录。`, count: 0, page: 1, pages: 1 };
    const lines = [`🔎 ${heading}｜${scope}｜匹配 ${filtered.length} 条`];
    for (const order of filtered.slice(0, 10)) {
      lines.push(`${order.phone.length === 6 ? "尾号" : "号码"} ${order.phone}｜${groupNames.get(order.groupId)}｜${order.channelName}`,
        `接粉 ${order.intakeOn || "未记录"} → ${order.orderOn ? `开单 ${order.orderOn}（${relativeDays(order.intakeOn, order.orderOn)}）｜首充 ${money(order.initialDepositCents)}` : "尚未开单"}`);
    }
    if (filtered.length > 10) lines.push("匹配超过 10 条，请加上具体小组缩小范围。");
    return { text: lines.join("\n"), count: filtered.length, page: 1, pages: 1 };
  }
  const pageSize = query.view === "orders" ? 15 : 12;
  if (query.view === "orders") {
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const current = filtered.slice((query.page - 1) * pageSize, query.page * pageSize);
    const lines = [`📋 ${heading}｜${scope}${query.channel ? `｜${query.channel}` : ""}`, `开单 ${filtered.length} 个号码，首充合计 ${money(filtered.reduce((sum, order) => sum + order.initialDepositCents, 0))}；第 ${query.page}/${pages} 页。`];
    for (const [index, order] of current.entries()) {
      lines.push(`${(query.page - 1) * pageSize + index + 1}. ${order.phone.length === 6 ? "尾号" : "号码"} ${order.phone}｜${groupNames.get(order.groupId)}｜${order.channelName}`,
        `接粉 ${order.intakeOn || "未记录"} → 开单 ${order.orderOn}（${relativeDays(order.intakeOn, order.orderOn)}）｜首充 ${money(order.initialDepositCents)}${order.source === "旧业务账" ? "｜旧业务账" : ""}`);
    }
    if (!current.length) lines.push("这一页没有记录。");
    if (query.page < pages) lines.push(`还有 ${filtered.length - query.page * pageSize} 条，可查询第 ${query.page + 1} 页。`);
    return { text: lines.join("\n"), count: filtered.length, page: query.page, pages };
  }
  const buckets = new Map<string, { groupId: string; channelId: string; name: string; orders: Order[]; months: Map<string, number> }>();
  for (const order of filtered) {
    const name = order.channelName;
    const key = JSON.stringify([order.groupId, name]);
    const bucket = buckets.get(key) ?? { groupId: order.groupId, channelId: order.channelId, name, orders: [] as Order[], months: new Map<string, number>() };
    bucket.orders.push(order);
    const month = validDate(order.intakeOn) ? order.intakeOn.slice(0, 7) : "接粉日期未知";
    bucket.months.set(month, (bucket.months.get(month) ?? 0) + 1);
    buckets.set(key, bucket);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.orders.length - a.orders.length || a.name.localeCompare(b.name, "zh-CN"));
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = sorted.slice((query.page - 1) * pageSize, query.page * pageSize);
  const lines = [`📊 ${heading}｜${scope}${query.channel ? `｜${query.channel}` : ""}`, `开单 ${filtered.length} 个号码，分布在 ${sorted.length} 个小组渠道；第 ${query.page}/${pages} 页。`];
  for (const bucket of current) {
    lines.push(`${groupNames.get(bucket.groupId)}｜${bucket.name}：开单 ${bucket.orders.length}，首充 ${money(bucket.orders.reduce((sum, order) => sum + order.initialDepositCents, 0))}`,
      `接粉月份：${[...bucket.months].sort((a, b) => b[0].localeCompare(a[0])).map(([month, count]) => `${month} ${count}单`).join("、")}`);
  }
  if (!current.length) lines.push("这一页没有记录。");
  if (query.page < pages) lines.push(`还有 ${sorted.length - query.page * pageSize} 个小组渠道，可查询第 ${query.page + 1} 页。`);
  lines.push("要看某条渠道的每个开单号码，可按该渠道名称查询开单号码。");
  return { text: lines.join("\n"), count: filtered.length, page: query.page, pages };
}
