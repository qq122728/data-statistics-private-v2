import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { POST } from "../../src/app/api/leads/check/route";
import { db } from "../../src/lib/db";
import { parsePhoneImport } from "../../src/lib/phone-import";

const createdLeadIds: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await db.leadCustomer.deleteMany({ where: { id: { in: createdLeadIds } } });
  createdLeadIds.length = 0;
});

describe.sequential("号码导入前检查", () => {
  it("在客户端和服务端使用同一套分隔、格式与本次重复规则", () => {
    expect(parsePhoneImport("13800138000, 13800138000\n+1 (212) 555-0100\nabc")).toMatchObject({
      rawPhones: ["13800138000", "13800138000", "+1", "(212)", "555-0100", "abc"],
      distinctPhones: ["13800138000", "5550100"],
      invalidPhones: ["+1", "(212)", "abc"],
      duplicatePhones: ["13800138000"],
      duplicateCount: 1,
    });
    expect(parsePhoneImport("381002\n381003", { customerCodePrefix: "TL", channelName: "美国投流 A" }).distinctPhones).toEqual([
      "TL-美国投流-A-381002",
      "TL-美国投流-A-381003",
    ]);
  });

  it("检查格式、重复和总公司撞粉，但不写入任何新客户", async () => {
    const actor = await db.user.findUniqueOrThrow({ where: { id: "member-1" } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);
    const suffix = String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0");
    const existingPhone = `151${suffix}`;
    const newPhone = `152${suffix}`;
    const lead = await db.leadCustomer.create({ data: { phone: existingPhone, batchId: "base-batch-a", ownerId: actor.id } });
    createdLeadIds.push(lead.id);
    const before = await db.leadCustomer.count();

    const response = await POST(new Request("http://localhost/api/leads/check", {
      method: "POST",
      body: JSON.stringify({ phones: `${existingPhone}\n${newPhone}\n${newPhone}\n错误号码` }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      submitted: 4,
      validUniqueCount: 2,
      importableCount: 1,
      invalidCount: 1,
      duplicateCount: 1,
      collisionCount: 1,
      collisions: [{ phone: existingPhone, ownerName: actor.name }],
    });
    await expect(db.leadCustomer.count()).resolves.toBe(before);
  });

  it("其他岗位不能调用接粉检查接口", async () => {
    const lead = await db.user.findUniqueOrThrow({ where: { id: "lead-1" } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(lead);
    const response = await POST(new Request("http://localhost/api/leads/check", {
      method: "POST",
      body: JSON.stringify({ phones: "13800138000" }),
    }));
    expect(response.status).toBe(403);
  });

  it("页面直接导入，并说明撞粉只提示、由人工登记审核", () => {
    const panel = readFileSync("src/components/entry/EntryReceptionPanels.tsx", "utf8");
    const tabs = readFileSync("src/components/entry/EntryTabs.tsx", "utf8");
    expect(panel).toContain("客户资料预览");
    expect(panel).toContain("客户平台");
    expect(panel).toContain("设备号会在“待回复”里，实际联系客户时再选择");
    expect(panel).toContain("撞粉、低金额、无 WS 号码请回“号码导入”下方单独登记数字");
    expect(panel).toContain("设备号");
    expect(panel).toContain("导入客户");
    expect(tabs).not.toContain('fetch("/api/leads/check"');
    expect(tabs).not.toContain("请先检查号码，再确认导入");
    expect(tabs).toContain("InvalidFanReportPanel");
  });
});
