import { z } from "zod";
import { db } from "./db";
import { canReadReportGroup, findLivePermissionUser } from "./permissions";
import { isSheetManager, publicPhone, SheetError, sheetColumns } from "./customer-sheet";
import { statisticsDate } from "./statistics-date";
import { actionNumbers, fieldActionNumber } from "../../packages/customer-sheet/action-numbers";
import { customerStage, inCustomerView } from "../../packages/customer-sheet/navigation";
import { compareDatedRows } from "../../packages/customer-sheet/date-groups";
import { customerExpertStatus, customerGroupStatus, type SheetData } from "../../packages/customer-sheet/schema";
import { groupDays } from "../../packages/customer-sheet/group-days";
import { normalizeCustomerQuery } from "../../packages/customer-sheet/search-query";
import { investmentSummary } from "../../packages/customer-sheet/investment";
import { sheetStatisticsOwner, sheetStatisticsGroup } from "../../packages/customer-sheet/statistics-owner";
import type { ProgressDetail, ProgressGroup, ProgressPayload, ProgressRow } from "../../packages/customer-sheet/management-types";

const date = z.string().refine(value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "请选择有效日期");
const querySchema = z.object({
  companyId: z.string().default(""), departmentId: z.string().default(""), groupId: z.string().default(""),
  q: z.string().trim().max(100).default(""), stage: z.enum(["all", "pending", "group", "expert"]).default("all"),
  status: z.string().default(""), role: z.enum(["ownerId", "operatorId", "expertId"]).default("ownerId"), assignee: z.string().default(""),
  dateField: z.enum(["intakeOn", "joinedOn", "expertOn"]).default("intakeOn"),
  from: date.default(""), to: date.default(""), page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().refine(n => [20, 50, 100].includes(n), "每页数量无效").default(50),
  rowId: z.string().default(""),
}).refine(q => !q.from || !q.to || q.from <= q.to, "开始日期不能晚于结束日期");

/** Dedicated management read model. It neither updates customers nor recalculates reports. */
export async function managementCustomerProgress(actorId: string, params: URLSearchParams): Promise<ProgressPayload | ProgressDetail> {
  const query = querySchema.parse(Object.fromEntries(params));
  return db.$transaction(async tx => {
    const actor = await findLivePermissionUser(tx, actorId);
    if (!actor || !isSheetManager(actor) || ["FINANCE", "RESOURCE_MANAGER"].includes(actor.role)) throw new SheetError("没有权限查看客户进度总表", 403);
    const available = (await tx.teamGroup.findMany({ where: { active: true }, include: { department: { include: { company: true } } }, orderBy: { name: "asc" } }))
      .filter(group => canReadReportGroup(actor, group));
    const groups: ProgressGroup[] = available.map(group => ({ id: group.id, name: group.name,
      departmentId: group.departmentId || "", departmentName: group.department?.name || "未归属部门",
      companyId: group.department?.companyId || "", companyName: group.department?.company?.name || "未归属公司" }));
    if (query.groupId && !groups.some(group => group.id === query.groupId)) throw new SheetError("没有权限查看该小组客户", 403);
    const scopedGroups = groups.filter(group => (!query.companyId || group.companyId === query.companyId)
      && (!query.departmentId || group.departmentId === query.departmentId) && (!query.groupId || group.id === query.groupId));
    // Scope applies in the database, including direct detail requests with a guessed row ID.
    const stored = await tx.customerSheetRow.findMany({ where: { groupId: { in: scopedGroups.map(g => g.id) }, ...(query.rowId ? { id: query.rowId } : {}) },
      select: { id: true, phone: true, groupId: true, ownerId: true, data: true, updatedAt: true } });
    const all = stored.map(row => ({ ...row, data: JSON.parse(row.data) as SheetData })).filter(row => !row.data.__deletedAt);
    const memberIds = [...new Set(all.flatMap(row => [row.ownerId, row.data.operatorId, row.data.expertId, sheetStatisticsOwner(row.ownerId, row.data)]).filter((id): id is string => typeof id === "string" && Boolean(id)))];
    const channelIds = [...new Set(all.map(row => row.data.channelId).filter((id): id is string => typeof id === "string" && Boolean(id)))];
    const [members, channels] = await Promise.all([
      tx.user.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
      tx.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, name: true } }),
    ]);
    const names = new Map([...members, ...channels].map(item => [item.id, item.name]));
    const name = (id: unknown) => id ? names.get(String(id)) || "历史人员" : "未填写";
    const today = statisticsDate();
    const present = (row: typeof all[number]): ProgressRow => ({
      id: row.id, phone: publicPhone(row.phone, actor.groupId === row.groupId), code: fieldActionNumber(row.data, "intakeOn") || "未生成编号",
      groupId: row.groupId, stage: customerStage(row.data), status: customerStage(row.data) === "expert" ? customerExpertStatus(row.data) : customerGroupStatus(row.data),
      owner: name(row.ownerId), operator: name(row.data.operatorId), expert: name(row.data.expertId), originalOwner: name(sheetStatisticsOwner(row.ownerId, row.data)),
      originalGroup: groups.find(g => g.id === sheetStatisticsGroup(row.groupId, row.data))?.name || "原归属小组",
      intakeOn: String(row.data.intakeOn || ""), joinedOn: String(row.data.joinedOn || ""), expertOn: String(row.data.expertOn || ""),
      updatedAt: row.updatedAt.toISOString(), days: groupDays(row.data, today), channel: row.data.channelId ? names.get(String(row.data.channelId)) || "历史渠道" : "未填写",
    });
    if (query.rowId) {
      const row = all[0];
      if (!row) throw new SheetError("客户不存在、已删除或不在查看范围内", 404);
      const columns = await sheetColumns(tx, row.groupId);
      const summary = investmentSummary(row.data);
      const fields = columns.filter(column => !column.hidden).map(column => {
        const value = column.id === "ownerId" ? row.ownerId : column.id === "status" ? customerGroupStatus(row.data)
          : column.id === "expertStatus" ? customerExpertStatus(row.data) : column.id === "progress" ? groupDays(row.data, today)
          : column.id === "investmentTotal" ? summary.totalCents / 100 : row.data[column.id];
        return { id: column.id, label: column.name, stage: column.stage, value: column.id === "phone" ? present(row).phone
          : value == null || value === "" ? "—" : column.kind === "member" || column.kind === "channel" ? name(value)
          : column.kind === "boolean" ? value === true ? "是" : "否" : String(value) };
      });
      const funds: ProgressDetail["funds"] = [
        ...(summary.firstCents > 0 ? [{ date: String(row.data.firstDepositOn || row.data.orderedOn || ""), kind: "首充", method: String(row.data.firstDepositMethod || "未填写"), amount: summary.firstCents / 100, code: fieldActionNumber(row.data, "firstDepositOn") || "—" }] : []),
        ...summary.entries.map(entry => ({ date: entry.date, kind: entry.kind === "withdrawal" ? "出金" : "续充", method: entry.method === "crypto" ? "加密货币" : "银行卡", amount: entry.amountCents / 100, code: fieldActionNumber(row.data, entry.id) || "—" })),
      ].sort((a, b) => b.date.localeCompare(a.date));
      return { row: present(row), fields, funds, total: summary.totalCents / 100, withdrawal: summary.withdrawalCents / 100, legacyBalance: summary.baseCents / 100 };
    }
    const search = normalizeCustomerQuery(query.q);
    const filtered = all.filter(row => {
      if (query.assignee && (query.role === "ownerId" ? row.ownerId : row.data[query.role]) !== query.assignee) return false;
      const value = String(row.data[query.dateField] || "").slice(0, 10);
      if ((query.from && value < query.from) || (query.to && (!value || value > query.to))) return false;
      if (!query.q) return true;
      // Preserve the existing rule: cross-group managers can search a tail/code, never full numbers.
      if (/^\d{4}$/.test(search)) return row.phone.endsWith(search);
      if (/^\d{6,20}$/.test(search)) return actor.groupId === row.groupId && row.phone === search;
      return actionNumbers(row.data).some(number => number.code.toUpperCase().includes(search))
        || [row.data.name, row.data.note, row.data.expertNote, row.data.customerProgress].some(value => String(value || "").toLowerCase().includes(query.q.toLowerCase()));
    });
    const counts: ProgressPayload["counts"] = { all: filtered.length, pending: 0, group: 0, expert: 0 };
    for (const row of filtered) for (const stage of ["pending", "group", "expert"] as const) if (inCustomerView(row.data, stage, false)) counts[stage]++;
    const selected = filtered.filter(row => inCustomerView(row.data, query.stage, false) && (!query.status || (query.stage === "group" ? customerGroupStatus(row.data)
      : query.stage === "expert" || customerStage(row.data) === "expert" ? customerExpertStatus(row.data) : customerGroupStatus(row.data)) === query.status));
    const dateStage = query.dateField === "intakeOn" ? "pending" : query.dateField === "expertOn" ? "expert" : "group";
    selected.sort((a, b) => compareDatedRows(a, b, dateStage));
    const pages = Math.max(1, Math.ceil(selected.length / query.pageSize)), page = Math.min(query.page, pages);
    return { groups, members, today, rows: selected.slice((page - 1) * query.pageSize, page * query.pageSize).map(present), total: selected.length, page, pages, pageSize: query.pageSize, counts };
  }, { timeout: 15000 });
}
