import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAudit } from "../../../../lib/audit";
import { normalizeChannelName } from "../../../../lib/channel-names";
import { db } from "../../../../lib/db";
import { requireChannelManagerRequest } from "../_auth";
import { authorizeHighRiskOperation, HighRiskAuthorizationError } from "../_high-risk";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { collapseGlobalChannelCopies } from "../../../../lib/global-channels";

type ChannelType = "SMS" | "ADS" | "REBATE";
type ChannelRequest = {
  id?: unknown;
  name?: unknown;
  groupId?: unknown;
  global?: unknown;
  /** 公司管理员使用此范围；后端从登录账号读取公司，绝不信任前端传来的公司 ID。 */
  company?: unknown;
  companyId?: unknown;
  active?: unknown;
  channelType?: unknown;
  highRiskReason?: unknown;
  currentPassword?: unknown;
};
const duplicate = (error: unknown) =>
  Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002",
  );
class InactiveChannelParentError extends Error {}

async function authorizeHeadquartersChannelOperation(
  client: Prisma.TransactionClient,
  actorId: string,
  body: ChannelRequest,
) {
  const liveActor = await client.user.findUnique({
    where: { id: actorId },
    select: { role: true, duty: true, active: true },
  });
  if (!liveActor?.active || (liveActor.role !== "ADMIN" && liveActor.duty !== "HQ_MANAGER")) {
    throw new HighRiskAuthorizationError("当前账号已不再是总公司管理员", 403);
  }
  return authorizeHighRiskOperation(
    client,
    actorId,
    body,
    ["ADMIN", "COMPANY_MANAGER"],
    "总公司管理员",
  );
}

export async function GET() {
  const access = await requireChannelManagerRequest();
  if ("response" in access) return access.response;
  const isHeadquartersManager = access.actor.role === "ADMIN" || access.actor.duty === "HQ_MANAGER";
  const isCompanyManager = access.actor.duty === "COMPANY_MANAGER" && !isHeadquartersManager;
  const isResourceManager = access.actor.role === "RESOURCE_MANAGER";
  if (!isHeadquartersManager && !isCompanyManager && !isResourceManager) return authorizationDenied(access.actor, "当前账号没有公司级渠道管理权限");
  const allowedChannelIds = isResourceManager
    ? (await db.resourceChannelAccess.findMany({ where: { userId: access.actor.id }, select: { channelId: true } })).map((item) => item.channelId)
    : [];
  const rows = await db.channel.findMany({
    where: isCompanyManager
      ? { group: { department: { companyId: access.actor.companyId as string } } }
      : isResourceManager
        ? { id: { in: allowedChannelIds } }
        : undefined,
    include: {
      group: { select: { id: true, name: true, active: true, department: { select: { id: true, name: true } } } },
      createdBy: { select: { name: true } },
      _count: { select: { batches: true } },
    },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  const channels = collapseGlobalChannelCopies(rows).map(({ row, groupCount, batchCount }) => ({
    id: row.id,
    name: row.name,
    active: row.active,
    channelType: row.channelType,
    createdAt: row.createdAt.toISOString(),
    creator: row.createdBy,
    groupCount,
    batchCount,
  }));
  return NextResponse.json({ channels }, { headers: { "Cache-Control": "private, no-store" } });
}

function parseChannelType(input: ChannelRequest): { success: true; value: ChannelType } | { success: false; error: string } {
  if (input.channelType === undefined) return { success: true, value: "SMS" };
  if (input.channelType === "SMS" || input.channelType === "ADS" || input.channelType === "REBATE") {
    return { success: true, value: input.channelType };
  }
  return { success: false, error: "渠道类型只能选择短信粉、投流粉或底料返点" };
}

export async function POST(request: Request) {
  const access = await requireChannelManagerRequest();
  if ("response" in access) return access.response;
  const body = (await request.json()) as ChannelRequest;
  if (typeof body.currentPassword === "string" && body.currentPassword.length > API_LIMITS.loginPasswordCharacters) return NextResponse.json({ error: "当前账号密码长度超过限制" }, { status: 400 });
  if (typeof body.highRiskReason === "string" && body.highRiskReason.length > API_LIMITS.accountReasonCharacters) return NextResponse.json({ error: "操作原因不能超过 500 个字" }, { status: 400 });
  if (typeof body.companyId === "string" && body.companyId.length > API_LIMITS.identifierCharacters) return NextResponse.json({ error: "公司参数过长" }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const companyRequest = body.company === true;
  const explicitGlobalRequest = body.global === true;
  const globalRequest = explicitGlobalRequest || (!companyRequest && !Object.prototype.hasOwnProperty.call(body, "groupId"));
  const isHeadquartersManager = access.actor.role === "ADMIN" || access.actor.duty === "HQ_MANAGER";
  const isCompanyManager = access.actor.duty === "COMPANY_MANAGER" && !isHeadquartersManager;
  const isResourceManager = access.actor.role === "RESOURCE_MANAGER";
  if (!isHeadquartersManager && !isCompanyManager && !isResourceManager) return authorizationDenied(access.actor, "当前账号没有公司级渠道管理权限");
  if (isCompanyManager && (!companyRequest || explicitGlobalRequest || Boolean(groupId))) {
    return authorizationDenied(access.actor, "公司管理员只能管理本公司的渠道");
  }
  if (companyRequest && !isCompanyManager) {
    return authorizationDenied(access.actor, "公司范围渠道只能由公司管理员操作");
  }
  if (companyRequest && !access.actor.companyId) {
    return authorizationDenied(access.actor, "当前公司管理员未绑定公司，不能管理渠道");
  }
  if (companyRequest && typeof body.companyId === "string" && body.companyId !== access.actor.companyId) {
    return authorizationDenied(access.actor, "不能操作其他公司的渠道");
  }
  if (!name || (!globalRequest && !companyRequest && !groupId))
    return NextResponse.json(
      { error: "请填写渠道名称和所属小组" },
      { status: 400 },
    );
  if (name.length > 100 || groupId.length > API_LIMITS.identifierCharacters)
    return NextResponse.json({ error: "渠道名称或小组参数过长" }, { status: 400 });
  const channelType = parseChannelType(body);
  if (!channelType.success) return NextResponse.json({ error: channelType.error }, { status: 400 });
  if (access.actor.role === "RESOURCE_MANAGER") {
    const allowedChannelIds = access.actor.resourceChannelAccess?.map((item) => item.channelId) ?? [];
    const allowedType = allowedChannelIds.length ? await db.channel.findFirst({
      where: { id: { in: allowedChannelIds }, channelType: channelType.value },
      select: { id: true },
    }) : null;
    if (!allowedType) return authorizationDenied(access.actor, `当前资源部账号没有${channelType.value === "SMS" ? "短信粉" : channelType.value === "ADS" ? "投流粉" : "底料返点"}渠道权限`);
  }
  try {
    const result = await db.$transaction(async (client) => {
      if (companyRequest) {
        const companyId = access.actor.companyId as string;
        const groups = await client.teamGroup.findMany({
          where: { active: true, department: { active: true, companyId } },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });
        if (!groups.length) return { error: "本公司没有启用中的小组，暂时不能创建渠道", status: 400 as const };
        const normalizedName = normalizeChannelName(name);
        if (await client.channel.findFirst({ where: { normalizedName, group: { department: { companyId } } }, select: { id: true } })) {
          return { error: "本公司已有同名渠道", status: 409 as const };
        }
        const id = randomUUID();
        await client.channel.createMany({
          data: groups.map((group) => ({
            id,
            name,
            normalizedName,
            groupId: group.id,
            createdById: access.actor.id,
            channelType: channelType.value,
          })),
        });
        const created = await client.channel.findUniqueOrThrow({ where: { id_groupId: { id, groupId: groups[0].id } } });
        await recordAudit(client, {
          actorId: access.actor.id,
          action: "CHANNEL_CREATED",
          entityType: "Channel",
          entityId: id,
          summary: {
            changedFields: ["name", "channelType"],
            name: created.name,
            scope: "COMPANY",
            companyId,
            groupCount: groups.length,
          },
        });
        return { channel: { ...created, company: true, groupCount: groups.length } };
      }
      if (globalRequest) {
        const highRisk = isHeadquartersManager
          ? await authorizeHeadquartersChannelOperation(client, access.actor.id, body)
          : null;
        const configuredCompanyId = typeof body.companyId === "string" ? body.companyId : null;
        const groups = await client.teamGroup.findMany({ select: { id: true, departmentId: true }, orderBy: { createdAt: "asc" } });
        if (!groups.length) return { error: "请先创建至少一个小组", status: 400 as const };
        const normalizedName = normalizeChannelName(name);
        if (await client.channel.findFirst({ where: { normalizedName }, select: { id: true } })) {
          return { error: "该全局渠道已经存在", status: 409 as const };
        }
        const id = randomUUID();
        await client.channel.createMany({
          data: groups.map((group) => ({
            id,
            name,
            normalizedName,
            groupId: group.id,
            createdById: access.actor.id,
            channelType: channelType.value,
          })),
        });
        if (access.actor.role === "RESOURCE_MANAGER") {
          await client.resourceChannelAccess.create({ data: { userId: access.actor.id, channelId: id } });
        }
        const created = await client.channel.findUniqueOrThrow({ where: { id_groupId: { id, groupId: groups[0].id } } });
        await recordAudit(client, {
          actorId: access.actor.id,
          action: "CHANNEL_CREATED",
          entityType: "Channel",
          entityId: id,
          summary: {
            changedFields: ["name", "channelType"],
            name: created.name,
            scope: "GLOBAL",
            groupCount: groups.length,
            ...(highRisk ? {
              highRiskReason: highRisk.highRiskReason,
              reauthenticated: highRisk.reauthenticated,
              before: null,
              after: {
                name: created.name,
                active: created.active,
                channelType: created.channelType,
              },
              impact: { headquartersOverride: true, groups: groups.length, configuredCompanyId },
            } : {}),
          },
        });
        return { channel: { ...created, global: true, groupCount: groups.length } };
      }
      const group = await client.teamGroup.findFirst({
        where: { id: groupId, active: true, department: { active: true } },
        select: { id: true, name: true },
      });
      if (!group) return { error: "只能在启用中的小组创建渠道", status: 400 as const };
      const highRisk = isHeadquartersManager
        ? await authorizeHeadquartersChannelOperation(client, access.actor.id, body)
        : null;
      const created = await client.channel.create({
        data: {
          id: randomUUID(),
          name,
          normalizedName: normalizeChannelName(name),
          groupId,
          createdById: access.actor.id,
          channelType: channelType.value,
        },
      });
      if (access.actor.role === "RESOURCE_MANAGER") {
        await client.resourceChannelAccess.create({ data: { userId: access.actor.id, channelId: created.id } });
      }
      await recordAudit(client, {
        actorId: access.actor.id,
        action: "CHANNEL_CREATED",
        entityType: "Channel",
        entityId: created.id,
        summary: {
          changedFields: [
            "name",
            "groupId",
            "channelType",
          ],
          name: created.name,
          groupId: created.groupId,
          groupName: group.name,
          ...(highRisk ? {
            highRiskReason: highRisk.highRiskReason,
            reauthenticated: highRisk.reauthenticated,
            before: null,
            after: {
              name: created.name,
              groupId: created.groupId,
              active: created.active,
              channelType: created.channelType,
            },
            impact: { headquartersOverride: true },
          } : {}),
        },
      });
      return { channel: created };
    }, { isolationLevel: "Serializable" });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.channel, { status: 201 });
  } catch (error) {
    if (error instanceof HighRiskAuthorizationError)
      return error.status === 403 ? authorizationDenied(access.actor, error.message) : NextResponse.json({ error: error.message }, { status: error.status });
    if (duplicate(error))
      return NextResponse.json(
        { error: "该小组已有同名渠道" },
        { status: 409 },
      );
    throw error;
  }
}

export async function PATCH(request: Request) {
  const access = await requireChannelManagerRequest();
  if ("response" in access) return access.response;
  const body = (await request.json()) as ChannelRequest;
  if (typeof body.currentPassword === "string" && body.currentPassword.length > API_LIMITS.loginPasswordCharacters) return NextResponse.json({ error: "当前账号密码长度超过限制" }, { status: 400 });
  if (typeof body.highRiskReason === "string" && body.highRiskReason.length > API_LIMITS.accountReasonCharacters) return NextResponse.json({ error: "操作原因不能超过 500 个字" }, { status: 400 });
  const globalRequest = body.global === true;
  const companyRequest = body.company === true;
  const isHeadquartersManager = access.actor.role === "ADMIN" || access.actor.duty === "HQ_MANAGER";
  const isCompanyManager = access.actor.duty === "COMPANY_MANAGER" && !isHeadquartersManager;
  const isResourceManager = access.actor.role === "RESOURCE_MANAGER";
  if (!isHeadquartersManager && !isCompanyManager && !isResourceManager) return authorizationDenied(access.actor, "当前账号没有公司级渠道管理权限");
  if (isCompanyManager && (!companyRequest || globalRequest || typeof body.groupId === "string")) {
    return authorizationDenied(access.actor, "公司管理员只能管理本公司的渠道");
  }
  if (companyRequest && (!isCompanyManager || !access.actor.companyId)) {
    return authorizationDenied(access.actor, "当前账号不能管理公司范围渠道");
  }
  if (companyRequest && typeof body.companyId === "string" && body.companyId !== access.actor.companyId) {
    return authorizationDenied(access.actor, "不能操作其他公司的渠道");
  }
  const scopedCompanyId = companyRequest
    ? access.actor.companyId as string
    : typeof body.companyId === "string" ? body.companyId : undefined;
  const catalogRequest = globalRequest || companyRequest;
  if (typeof body.id !== "string" || body.id.length > API_LIMITS.identifierCharacters || (!catalogRequest && typeof body.groupId !== "string") || (typeof body.groupId === "string" && body.groupId.length > API_LIMITS.identifierCharacters) || (typeof scopedCompanyId === "string" && scopedCompanyId.length > API_LIMITS.identifierCharacters))
    return NextResponse.json({ error: "渠道参数不正确" }, { status: 400 });
  const requested: {
    name?: string;
    active?: boolean;
  } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 100)
      return NextResponse.json({ error: "渠道名称必须在 1 到 100 个字之间" }, { status: 400 });
    requested.name = name;
  }
  if (typeof body.active === "boolean") requested.active = body.active;
  if (!Object.keys(requested).length)
    return NextResponse.json(
      { error: "没有可更新的渠道信息" },
      { status: 400 },
    );
  try {
    const channel = await db.$transaction(async (client) => {
      const copies = catalogRequest
        ? await client.channel.findMany({
          where: { id: body.id as string, ...(scopedCompanyId ? { group: { department: { companyId: scopedCompanyId } } } : {}) },
          include: {
            group: {
              select: { name: true, active: true, department: { select: { active: true } } },
            },
          },
          orderBy: { createdAt: "asc" },
        })
        : [];
      const existing = catalogRequest ? copies[0] : await client.channel.findUniqueOrThrow({
        where: { id_groupId: { id: body.id as string, groupId: body.groupId as string } },
        include: {
          group: {
            select: {
              name: true,
              active: true,
              department: { select: { active: true } },
            },
          },
        },
      });
      if (!existing) return { error: "渠道不存在或已经删除", status: 404 as const };
      if (access.actor.role === "RESOURCE_MANAGER") {
        const assignedIds = new Set(access.actor.resourceChannelAccess?.map((item) => item.channelId) ?? []);
        if (!assignedIds.has(existing.id)) return { denied: true as const };
      }
      if (body.channelType !== undefined && body.channelType !== existing.channelType) {
        return { error: "已有渠道不能更改类型；请新建渠道，避免历史账目变口径", status: 400 as const };
      }
      const data: {
        name?: string;
        normalizedName?: string;
        active?: boolean;
      } = {};
      const changedFields: Array<"name" | "active"> = [];
      if (requested.name !== undefined && requested.name !== existing.name) {
        data.name = requested.name;
        data.normalizedName = normalizeChannelName(requested.name);
        changedFields.push("name");
      }
      if (
        requested.active !== undefined &&
        requested.active !== existing.active
      ) {
        data.active = requested.active;
        changedFields.push("active");
      }
      if (!changedFields.length) {
        const { group: _group, ...unchanged } = existing;
        return { ...unchanged, ...(globalRequest ? { global: true, groupCount: copies.length } : companyRequest ? { company: true, groupCount: copies.length } : {}) };
      }
      if (
        !catalogRequest &&
        data.active === true &&
        !existing.active &&
        (!existing.group.active || !existing.group.department.active)
      ) {
        throw new InactiveChannelParentError();
      }
      const highRisk = isHeadquartersManager
        ? await authorizeHeadquartersChannelOperation(client, access.actor.id, body)
        : null;
      const impact = highRisk
        ? await Promise.all([
          client.sourceBatch.count({ where: catalogRequest ? { channelId: existing.id, ...(scopedCompanyId ? { group: { department: { companyId: scopedCompanyId } } } : {}) } : { groupId: existing.groupId, channelId: existing.id } }),
          client.leadCustomer.count({ where: { batch: catalogRequest ? { channelId: existing.id, ...(scopedCompanyId ? { group: { department: { companyId: scopedCompanyId } } } : {}) } : { groupId: existing.groupId, channelId: existing.id } } }),
          client.customerOrder.count({ where: { batch: catalogRequest ? { channelId: existing.id, ...(scopedCompanyId ? { group: { department: { companyId: scopedCompanyId } } } : {}) } : { groupId: existing.groupId, channelId: existing.id } } }),
          client.metricEvent.count({ where: { batch: catalogRequest ? { channelId: existing.id, ...(scopedCompanyId ? { group: { department: { companyId: scopedCompanyId } } } : {}) } : { groupId: existing.groupId, channelId: existing.id } } }),
        ])
        : null;
      if (catalogRequest) {
        await client.channel.updateMany({ where: { id: existing.id, ...(scopedCompanyId ? { group: { department: { companyId: scopedCompanyId } } } : {}) }, data });
      }
      const updatedWithGroup = catalogRequest
        ? await client.channel.findFirstOrThrow({ where: { id: existing.id, ...(scopedCompanyId ? { group: { department: { companyId: scopedCompanyId } } } : {}) }, include: { group: { select: { name: true } } } })
        : await client.channel.update({
          where: { id_groupId: { id: body.id as string, groupId: body.groupId as string } },
          data,
          include: { group: { select: { name: true } } },
        });
      const valueFields = changedFields.filter((field) => field === "name");
      const before = Object.fromEntries(
        valueFields.map((field) => [field, existing[field]]),
      );
      const after = Object.fromEntries(
        valueFields.map((field) => [field, updatedWithGroup[field]]),
      );
      await recordAudit(client, {
        actorId: access.actor.id,
        action: changedFields.includes("active")
          ? "CHANNEL_STATUS_CHANGED"
          : "CHANNEL_UPDATED",
        entityType: "Channel",
        entityId: updatedWithGroup.id,
        summary: {
          changedFields,
          name: updatedWithGroup.name,
          ...(catalogRequest
            ? { scope: companyRequest ? "COMPANY" : "GLOBAL", groupCount: copies.length, ...(scopedCompanyId ? { companyId: scopedCompanyId } : {}) }
            : { groupId: updatedWithGroup.groupId, groupName: updatedWithGroup.group.name }),
          ...(valueFields.length ? { before, after } : {}),
          ...(highRisk && impact ? {
            highRiskReason: highRisk.highRiskReason,
            reauthenticated: highRisk.reauthenticated,
            before: {
              name: existing.name,
              active: existing.active,
            },
            after: {
              name: updatedWithGroup.name,
              active: updatedWithGroup.active,
            },
            impact: {
              sourceBatches: impact[0],
              leadCustomers: impact[1],
              customerOrders: impact[2],
              metricEvents: impact[3],
              headquartersOverride: isHeadquartersManager,
              ...(catalogRequest ? { groups: copies.length } : {}),
              ...(scopedCompanyId ? { companyId: scopedCompanyId } : {}),
            },
          } : {}),
        },
      });
      const { group: _group, ...updated } = updatedWithGroup;
      return { ...updated, ...(globalRequest ? { global: true, groupCount: copies.length } : companyRequest ? { company: true, groupCount: copies.length } : {}) };
    }, { isolationLevel: "Serializable" });
    if ("denied" in channel) return authorizationDenied(access.actor, "没有管理该渠道的权限");
    if ("error" in channel) return NextResponse.json({ error: channel.error }, { status: channel.status });
    return NextResponse.json(channel);
  } catch (error) {
    if (error instanceof HighRiskAuthorizationError)
      return error.status === 403 ? authorizationDenied(access.actor, error.message) : NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof InactiveChannelParentError)
      return NextResponse.json({ error: "所属小组或部门已停用，不能启用该渠道" }, { status: 400 });
    if (duplicate(error))
      return NextResponse.json(
        { error: globalRequest ? "该全局渠道已经存在" : companyRequest ? "本公司已有同名渠道" : "该小组已有同名渠道" },
        { status: 409 },
      );
    throw error;
  }
}
