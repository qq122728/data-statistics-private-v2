import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { POST } from "../../src/app/api/channels/route";
import { db } from "../../src/lib/db";

const createdIds: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
  await db.channel.deleteMany({ where: { id: { in: createdIds } } });
  createdIds.length = 0;
  await db.systemSetting.deleteMany({ where: { key: "allowMemberChannelCreation" } });
});

describe.sequential("渠道创建权限", () => {
  it("接粉不能通过旧接口创建新渠道", async () => {
    const actor = await db.user.findUniqueOrThrow({ where: { id: "member-1" } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);
    const name = `单独创建-${randomUUID()}`;
    const response = await POST(new Request("http://localhost/api/channels", {
      method: "POST",
      body: JSON.stringify({ name }),
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "只有公司管理员、资源部管理员或超级管理员可以新增渠道" });
    await expect(db.channel.count({ where: { name } })).resolves.toBe(0);
  });

  it("接粉即使提交已有名称也不能调用创建接口", async () => {
    const actor = await db.user.findUniqueOrThrow({ where: { id: "member-1" } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);
    const response = await POST(new Request("http://localhost/api/channels", {
      method: "POST",
      body: JSON.stringify({ name: "底料" }),
    }));
    expect(response.status).toBe(403);
  });

  it("旧的成员创建开关不能重新放开权限", async () => {
    const actor = await db.user.findUniqueOrThrow({ where: { id: "member-1" } });
    vi.spyOn(auth, "requireUser").mockResolvedValue(actor);
    await db.systemSetting.create({ data: { key: "allowMemberChannelCreation", value: "false" } });
    const response = await POST(new Request("http://localhost/api/channels", {
      method: "POST",
      body: JSON.stringify({ name: `禁止创建-${randomUUID()}` }),
    }));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "只有公司管理员、资源部管理员或超级管理员可以新增渠道" });
  });

  it("接粉页面固定隐藏新增渠道入口", () => {
    const page = readFileSync("src/app/(app)/entry/page.tsx", "utf8");
    expect(page).toContain("allowMemberChannelCreation={false}");
  });
});
