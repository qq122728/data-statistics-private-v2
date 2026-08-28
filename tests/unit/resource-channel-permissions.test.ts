import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as auth from "../../src/lib/auth";
import { AuthorizationError, hashPassword } from "../../src/lib/auth";
import { db } from "../../src/lib/db";
import { PATCH, POST } from "../../src/app/api/admin/channels/route";
import { getVisibleAppNavigation } from "../../src/lib/app-navigation";

const prefix = "resource-channel-permission-";

afterEach(async () => {
  vi.restoreAllMocks();
  await db.auditLog.deleteMany({ where: { OR: [{ entityId: { startsWith: prefix } }, { summary: { contains: prefix } }] } });
  await db.channel.deleteMany({ where: { OR: [{ groupId: { startsWith: prefix } }, { normalizedName: { startsWith: prefix } }] } });
  await db.teamGroup.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.user.deleteMany({ where: { id: { startsWith: prefix } } });
  await db.department.deleteMany({ where: { id: { startsWith: prefix } } });
});

describe.sequential("resource department channel permissions", () => {
  it("requires a reason and current password whenever headquarters overrides resource channel management", async () => {
    const id = `${prefix}admin-${randomUUID()}`;
    const password = "Admin-override@56790";
    const actor = await db.user.create({ data: { id, username: id, name: "总公司渠道介入测试", passwordHash: hashPassword(password), role: "ADMIN" } });
    vi.spyOn(auth, "requireRole").mockResolvedValue(actor);
    const groupId = `${prefix}admin-group-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "总公司介入测试组" } });

    const rejected = await POST(new Request("http://localhost/api/admin/channels", { method: "POST", body: JSON.stringify({ name: `${prefix}总公司渠道`, groupId }) }));
    expect(rejected.status).toBe(400);
    const accepted = await POST(new Request("http://localhost/api/admin/channels", { method: "POST", body: JSON.stringify({ name: `${prefix}总公司渠道`, groupId, highRiskReason: "资源部暂时无法处理", currentPassword: password }) }));
    expect(accepted.status).toBe(201);
    const channel = await accepted.json() as { id: string };
    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: channel.id, action: "CHANNEL_CREATED" } });
    expect(JSON.parse(audit.summary)).toMatchObject({ highRiskReason: "资源部暂时无法处理", reauthenticated: true, impact: { headquartersOverride: true } });
  });

  it("lets a resource manager create and rename channels with an audit trail", async () => {
    const id = `${prefix}user-${randomUUID()}`;
    const password = "Resource-test@56790";
    const actor = await db.user.create({ data: { id, username: id, name: "投流资源测试", passwordHash: hashPassword(password), role: "RESOURCE_MANAGER" } });
    const groupId = `${prefix}group-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "资源测试组" } });
    const permittedChannelId = `${prefix}permitted-sms-${randomUUID()}`;
    await db.channel.create({ data: { id: permittedChannelId, groupId, name: "已授权短信渠道", normalizedName: `${prefix}permitted-sms-${randomUUID()}`, channelType: "SMS" } });
    await db.resourceChannelAccess.create({ data: { userId: actor.id, channelId: permittedChannelId } });
    vi.spyOn(auth, "requireRole").mockResolvedValue({ ...actor, resourceChannelAccess: [{ channelId: permittedChannelId }] });

    const created = await POST(new Request("http://localhost/api/admin/channels", { method: "POST", body: JSON.stringify({ name: `${prefix}短信`, groupId }) }));
    expect(created.status).toBe(201);
    const channel = await created.json() as { id: string };
    vi.mocked(auth.requireRole).mockResolvedValue({ ...actor, resourceChannelAccess: [{ channelId: permittedChannelId }, { channelId: channel.id }] });

    const updated = await PATCH(new Request("http://localhost/api/admin/channels", { method: "PATCH", body: JSON.stringify({ id: channel.id, groupId, name: `${prefix}短信-改名` }) }));
    expect(updated.status).toBe(200);

    expect(await db.channel.findUniqueOrThrow({ where: { id_groupId: { id: channel.id, groupId } } })).toMatchObject({ name: `${prefix}短信-改名` });
    expect(await db.auditLog.count({ where: { actorId: actor.id, entityId: channel.id } })).toBe(2);
  });

  it("keeps ordinary frontline accounts out of the channel management API", async () => {
    vi.spyOn(auth, "requireRole").mockRejectedValue(new AuthorizationError(undefined, { id: "denied-user", groupId: "denied-team" } as never));
    const response = await POST(new Request("http://localhost/api/admin/channels", { method: "POST", body: JSON.stringify({ name: "越权渠道", groupId: "group-a" }) }));
    expect(response.status).toBe(403);
  });

  it("rejects a resource manager that tries to modify an unassigned channel", async () => {
    const actorId = `${prefix}scoped-user-${randomUUID()}`;
    const actor = await db.user.create({ data: { id: actorId, username: actorId, name: "短信资源管理员", passwordHash: hashPassword("Scoped-resource@56790"), role: "RESOURCE_MANAGER" } });
    vi.spyOn(auth, "requireRole").mockResolvedValue(actor);
    const groupId = `${prefix}scoped-group-${randomUUID()}`;
    await db.teamGroup.create({ data: { id: groupId, name: "渠道隔离测试组" } });
    const channel = await db.channel.create({ data: { id: `${prefix}unassigned-${randomUUID()}`, groupId, name: "未分配投流", normalizedName: `${prefix}unassigned-${randomUUID()}` } });

    const response = await PATCH(new Request("http://localhost/api/admin/channels", {
      method: "PATCH",
      body: JSON.stringify({ id: channel.id, groupId, active: false }),
    }));

    expect(response.status).toBe(403);
    await expect(db.channel.findUniqueOrThrow({ where: { id_groupId: { id: channel.id, groupId } } })).resolves.toMatchObject({ active: true });
  });

  it("adds a dedicated global channel and price entry for resource managers", () => {
    expect(getVisibleAppNavigation("RESOURCE_MANAGER")).toContainEqual({ href: "/resource-channels", label: "渠道与单价" });
  });

  it("creates one catalog channel for every group and updates every copy together", async () => {
    const id = `${prefix}global-user-${randomUUID()}`;
    const actor = await db.user.create({ data: { id, username: id, name: "全局渠道资源部", passwordHash: hashPassword("global-resource-password"), role: "RESOURCE_MANAGER" } });
    const groupIds = [`${prefix}global-a-${randomUUID()}`, `${prefix}global-b-${randomUUID()}`];
    await db.teamGroup.createMany({ data: groupIds.map((groupId, index) => ({ id: groupId, name: `全局渠道组${index}-${randomUUID()}` })) });
    const permittedChannelId = `${prefix}global-permitted-sms-${randomUUID()}`;
    await db.channel.create({ data: { id: permittedChannelId, groupId: groupIds[0], name: "全局资源部已授权短信", normalizedName: `${prefix}global-permitted-sms-${randomUUID()}`, channelType: "SMS" } });
    await db.resourceChannelAccess.create({ data: { userId: actor.id, channelId: permittedChannelId } });
    vi.spyOn(auth, "requireRole").mockResolvedValue({ ...actor, resourceChannelAccess: [{ channelId: permittedChannelId }] });
    const totalGroups = await db.teamGroup.count();
    const name = `${prefix}全局投流-${randomUUID()}`;

    const created = await POST(new Request("http://localhost/api/admin/channels", { method: "POST", body: JSON.stringify({ global: true, name }) }));
    expect(created.status).toBe(201);
    const channel = await created.json() as { id: string; groupCount: number };
    expect(channel.groupCount).toBe(totalGroups);
    await expect(db.channel.count({ where: { id: channel.id } })).resolves.toBe(totalGroups);
    vi.mocked(auth.requireRole).mockResolvedValue({ ...actor, resourceChannelAccess: [{ channelId: permittedChannelId }, { channelId: channel.id }] });

    const renamed = `${name}-改名`;
    const updated = await PATCH(new Request("http://localhost/api/admin/channels", { method: "PATCH", body: JSON.stringify({ global: true, id: channel.id, name: renamed }) }));
    expect(updated.status).toBe(200);
    const copies = await db.channel.findMany({ where: { id: channel.id }, select: { name: true } });
    expect(new Set(copies.map((copy) => copy.name))).toEqual(new Set([renamed]));
  });

  it("lets a company manager manage only its own company channel catalog", async () => {
    const departmentId = `${prefix}company-${randomUUID()}`;
    const otherDepartmentId = `${prefix}other-company-${randomUUID()}`;
    await db.department.createMany({ data: [
      { id: departmentId, name: `${prefix}本公司-${randomUUID()}` },
      { id: otherDepartmentId, name: `${prefix}其他公司-${randomUUID()}` },
    ] });
    const ownGroupIds = [`${prefix}company-a-${randomUUID()}`, `${prefix}company-b-${randomUUID()}`];
    const otherGroupId = `${prefix}other-group-${randomUUID()}`;
    await db.teamGroup.createMany({ data: [
      ...ownGroupIds.map((id, index) => ({ id, name: `本公司渠道组${index}-${randomUUID()}`, departmentId })),
      { id: otherGroupId, name: `其他公司渠道组-${randomUUID()}`, departmentId: otherDepartmentId },
    ] });
    const password = "Company-channel@56790";
    const actor = await db.user.create({
      data: { id: `${prefix}company-manager-${randomUUID()}`, username: `${prefix}company-manager-${randomUUID()}`, name: "公司渠道管理员", passwordHash: hashPassword(password), role: "COMPANY_MANAGER", departmentId },
    });
    vi.spyOn(auth, "requireRole").mockResolvedValue(actor);
    const name = `${prefix}公司短信-${randomUUID()}`;

    const rejectedGlobal = await POST(new Request("http://localhost/api/admin/channels", { method: "POST", body: JSON.stringify({ global: true, name }) }));
    expect(rejectedGlobal.status).toBe(403);
    const created = await POST(new Request("http://localhost/api/admin/channels", { method: "POST", body: JSON.stringify({ company: true, name }) }));
    expect(created.status).toBe(201);
    const channel = await created.json() as { id: string; groupCount: number };
    expect(channel.groupCount).toBe(ownGroupIds.length);
    expect(await db.channel.count({ where: { id: channel.id } })).toBe(ownGroupIds.length);
    expect(await db.channel.count({ where: { id: channel.id, groupId: otherGroupId } })).toBe(0);

    const renamed = `${name}-改名`;
    const updated = await PATCH(new Request("http://localhost/api/admin/channels", { method: "PATCH", body: JSON.stringify({ company: true, id: channel.id, name: renamed }) }));
    expect(updated.status).toBe(200);
    const copies = await db.channel.findMany({ where: { id: channel.id }, select: { groupId: true, name: true } });
    expect(copies).toHaveLength(ownGroupIds.length);
    expect(new Set(copies.map((copy) => copy.name))).toEqual(new Set([renamed]));
    expect(getVisibleAppNavigation("COMPANY_MANAGER")).toContainEqual({ href: "/resource-channels", label: "渠道与单价" });
  });

  it("removes the group selector from the global channel manager", () => {
    const source = readFileSync("src/components/admin/ChannelManager.tsx", "utf8");
    expect(source).toContain("全局渠道：保存后所有公司和小组都可以选择");
    expect(source).not.toContain("所属小组");
    expect(source).toContain("global: true");
  });
});
