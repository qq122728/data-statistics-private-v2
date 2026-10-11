import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressPayload } from "../../packages/customer-sheet/management-types";

const fixture = vi.hoisted(() => {
  const actor = {
    id: "resource-1", role: "RESOURCE_MANAGER", duty: "RESOURCE_MANAGER", active: true,
    groupId: null, resourceChannelAccess: [{ channelId: "allowed-channel" }],
  };
  const group = { id: "group-1", name: "1组", active: true, departmentId: "department-1", department: { name: "部门", companyId: "company-1", company: { name: "公司" } } };
  const rows = [
    { id: "allowed-row", groupId: group.id, ownerId: "owner-1", phone: "1234567890", updatedAt: new Date("2026-10-10"), data: JSON.stringify({ channelId: "allowed-channel", intakeOn: "2026-10-01", orderedOn: "2026-10-09" }) },
    { id: "other-channel-row", groupId: group.id, ownerId: "owner-1", phone: "9876543210", updatedAt: new Date("2026-10-10"), data: JSON.stringify({ channelId: "other-channel", intakeOn: "2026-10-01" }) },
  ];
  const tx = {
    channel: { findMany: vi.fn(async () => [{ id: "allowed-channel", name: "FB-M", groupId: group.id }]) },
    teamGroup: { findMany: vi.fn(async () => [group]) },
    customerSheetRow: { findMany: vi.fn(async () => rows) },
    user: { findMany: vi.fn(async () => [{ id: "owner-1", name: "接粉人" }]) },
  };
  return { actor, tx };
});

vi.mock("../../src/lib/db", () => ({ db: { $transaction: (callback: (tx: typeof fixture.tx) => Promise<unknown>) => callback(fixture.tx) } }));
vi.mock("../../src/lib/permissions", () => ({ findLivePermissionUser: async () => fixture.actor, canReadReportGroup: () => false }));
vi.mock("../../src/lib/customer-sheet", () => ({
  isSheetManager: () => false,
  publicPhone: (phone: string, full: boolean) => full ? phone : "***",
  SheetError: class SheetError extends Error { constructor(message: string, readonly status: number) { super(message); } },
  sheetColumns: vi.fn(),
}));
vi.mock("../../src/lib/statistics-date", () => ({ statisticsDate: () => "2026-10-11" }));

import { managementCustomerProgress } from "../../src/lib/management-customer-progress";

describe("资源部客户进度和号码权限", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("同一小组只返回已授权渠道客户的完整号码", async () => {
    const result = await managementCustomerProgress(fixture.actor.id, new URLSearchParams()) as ProgressPayload;
    expect(result.rows.map(row => ({ phone: row.phone, channel: row.channel, orderedOn: row.orderedOn }))).toEqual([
      { phone: "1234567890", channel: "FB-M", orderedOn: "2026-10-09" },
    ]);
    expect(result.total).toBe(1);
    expect(result.channels).toEqual([{ id: "allowed-channel", name: "FB-M" }]);
  });

  it("不能指定未授权渠道，也不能用行 ID 读取详情", async () => {
    await expect(managementCustomerProgress(fixture.actor.id, new URLSearchParams({ channelId: "other-channel" })))
      .rejects.toMatchObject({ status: 403 });
    await expect(managementCustomerProgress(fixture.actor.id, new URLSearchParams({ rowId: "other-channel-row" })))
      .rejects.toMatchObject({ status: 403 });
  });

  it("用未授权渠道的完整号码搜索也不会找到客户", async () => {
    const result = await managementCustomerProgress(fixture.actor.id, new URLSearchParams({ q: "9876543210" })) as ProgressPayload;
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("撤销全部渠道授权后，原来可见的号码也立即消失", async () => {
    fixture.tx.channel.findMany.mockResolvedValueOnce([]);
    const result = await managementCustomerProgress(fixture.actor.id, new URLSearchParams()) as ProgressPayload;
    expect(result.groups).toEqual([]);
    expect(result.channels).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});
