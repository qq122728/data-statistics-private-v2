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
      distinctPhones: ["138000", "1", "212", "550100"],
      invalidPhones: ["abc"],
      duplicatePhones: ["138000"],
      duplicateCount: 1,
    });
    expect(parsePhoneImport("381002\n381003", { customerCodePrefix: "TL", channelName: "美国投流 A" }).distinctPhones).toEqual([
      "381002",
      "381003",
    ]);
  });

  it("检查格式、重复和总公司撞粉，但不写入任何新客户", async () => {
    const actor = await db.user.findUniqueOrThrow({ where: { id: "member-1" } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);
    const suffix = String(Math.floor(Math.random() * 900_000) + 100_000);
    const nextSuffix = String((Number(suffix) + 1) % 1_000_000).padStart(6, "0");
    const existingPhone = suffix;
    const existingInput = `49160${suffix}`;
    const newPhone = `49160${nextSuffix}`;
    const lead = await db.leadCustomer.create({ data: { phone: existingPhone, batchId: "base-batch-a", ownerId: actor.id } });
    createdLeadIds.push(lead.id);
    const before = await db.leadCustomer.count();

    const response = await POST(new Request("http://localhost/api/leads/check", {
      method: "POST",
      body: JSON.stringify({ phones: `${existingInput}\n${newPhone}\n${newPhone}\n错误号码` }),
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
});
