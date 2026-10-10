import { normalizeCustomerQuery } from "../../packages/customer-sheet/search-query";
import { db } from "./db";
import { publicPhone, sheetAccess, SheetError } from "./customer-sheet";
import { actionNumbers, fieldActionNumber } from "../../packages/customer-sheet/action-numbers";
import { compareDatedRows, rowDate } from "../../packages/customer-sheet/date-groups";
import { customerStage, inCustomerView, customerPageSize, finderPageSize, type CustomerFinderPayload } from "../../packages/customer-sheet/navigation";
import { customerExpertStatus, customerGroupStatus, type SheetData } from "../../packages/customer-sheet/schema";

export async function findSheetCustomers(actorId: string, params: URLSearchParams): Promise<CustomerFinderPayload> {
  const groupId = params.get("groupId") || "";
  return db.$transaction(async tx => {
    const access = await sheetAccess(tx, actorId, groupId);
    const raw = (params.get("q") || "").trim();
    const query = normalizeCustomerQuery(raw);
    if (!/^(?:\d{4}|\d{6,20}|[GHJTYZRSXC]-\d{1,2}-\d{1,2}-\d+)$/.test(query)) {
      throw new SheetError("请输入尾号四位、完整号码，或客户编号（例如 G-9-2-003）");
    }
    const stored = await tx.customerSheetRow.findMany({ where: { groupId }, select: { id: true, phone: true, ownerId: true, data: true }, orderBy: { id: "asc" } });
    const all = stored.map(row => ({ ...row, data: JSON.parse(row.data) as SheetData }));
    const matched = all.filter(row => /^\d{4}$/.test(query) ? row.phone.endsWith(query)
      : /^\d+$/.test(query) ? access.canViewFullPhone && row.phone === query
      : actionNumbers(row.data).some(number => number.code.toUpperCase() === query));
    const pages = Math.max(1, Math.ceil(matched.length / finderPageSize));
    const requested = Number(params.get("page")) || 1;
    const page = Math.max(1, Math.min(Math.floor(requested), pages));
    const visible = matched.slice((page - 1) * finderPageSize, page * finderPageSize);
    const owners = await tx.user.findMany({ where: { id: { in: [...new Set(visible.map(row => row.ownerId))] } }, select: { id: true, name: true } });
    const positions = new Map<string, Map<string, number>>();
    return { total: matched.length, page, pages, matches: visible.map(row => {
      const stage = customerStage(row.data), deleted = Boolean(row.data.__deletedAt);
      const key = JSON.stringify([row.ownerId, stage, deleted]);
      if (!positions.has(key)) {
        const bucket = all.filter(other => other.ownerId === row.ownerId && inCustomerView(other.data, stage, deleted));
        bucket.sort((a, b) => compareDatedRows(a, b, deleted ? null : stage));
        positions.set(key, new Map(bucket.map((other, index) => [other.id, index])));
      }
      const location = positions.get(key)!;
      return { id: row.id, ownerId: row.ownerId, ownerName: owners.find(owner => owner.id === row.ownerId)?.name || "原接粉负责人",
        phone: publicPhone(row.phone, access.canViewFullPhone), code: fieldActionNumber(row.data, "intakeOn") || "未生成编号",
        stage, deleted, date: rowDate(row.data, deleted ? null : stage), status: stage === "expert" ? customerExpertStatus(row.data) : customerGroupStatus(row.data),
        page: Math.floor(location.get(row.id)! / customerPageSize) + 1, pages: Math.max(1, Math.ceil(location.size / customerPageSize)), total: location.size };
    }) };
  });
}
