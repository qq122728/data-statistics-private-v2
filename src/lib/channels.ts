import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, User } from "@prisma/client";
import { recordAudit } from "./audit";
import { normalizeChannelName } from "./channel-names";
import { hasAssignedRole } from "./role-access";

type ChannelClient = Prisma.TransactionClient | Pick<PrismaClient, "user" | "teamGroup" | "channel" | "auditLog">;
type ChannelActor = Pick<User, "id" | "role" | "active" | "groupId"> & { roleAssignments?: Array<{ role: User["role"] }> };
export type ChannelType = "SMS" | "ADS" | "REBATE";

export class ChannelResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelResolutionError";
  }
}

export type ChannelResolutionInput = {
  actor: ChannelActor;
  groupId?: string;
  channelId?: string;
  channelName?: string;
  channelType?: ChannelType;
  auditSource?: "new_fans_entry" | "channel_setup";
};

export function isConcurrentChannelCreateError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  const meta = "meta" in error && error.meta && typeof error.meta === "object" ? error.meta : undefined;
  const modelName = meta && "modelName" in meta && typeof meta.modelName === "string" ? meta.modelName : "";
  const target = meta && "target" in meta ? meta.target : undefined;
  const targetFields = Array.isArray(target) ? target.filter((field): field is string => typeof field === "string") : [];
  const isChannelNameTarget = targetFields.length === 2
    && targetFields.includes("groupId")
    && targetFields.includes("normalizedName");

  return (code === "P2002" && modelName === "Channel" && isChannelNameTarget)
    || /UNIQUE constraint failed:\s*"?Channel"?\."?groupId"?\s*,\s*"?Channel"?\."?normalizedName"?/i.test(message)
    || /Channel_groupId_normalizedName_key/i.test(message);
}

export function isRetryableSqliteTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return code === "P1008"
    || code === "P2034"
    || /SQLITE_BUSY|database (?:table )?(?:is )?(?:locked|busy)/i.test(message);
}

/** Resolve an existing group channel or create one while saving a new-fans row. */
export async function resolveOrCreateChannel(client: ChannelClient, input: ChannelResolutionInput) {
  const actor = await client.user.findUnique({
    where: { id: input.actor.id },
    select: { id: true, role: true, active: true, groupId: true, roleAssignments: { select: { role: true } } },
  });
  if (!actor?.active) throw new ChannelResolutionError("当前成员已停用，不能录入数据");

  const groupId = hasAssignedRole(actor, "ADMIN") ? input.groupId : actor.groupId;
  if (!groupId) throw new ChannelResolutionError("管理员必须指定渠道所属小组");
  const group = await client.teamGroup.findUnique({ where: { id: groupId }, select: { id: true, active: true } });
  if (!group?.active) throw new ChannelResolutionError("小组不存在或已停用");

  if (input.channelId) {
    const channel = await client.channel.findUnique({ where: { id_groupId: { id: input.channelId, groupId } } });
    if (!channel) throw new ChannelResolutionError("渠道不存在或不属于当前小组");
    if (!channel.active) throw new ChannelResolutionError("渠道或小组已停用");
    return channel;
  }

  const name = input.channelName?.trim();
  if (!name) throw new ChannelResolutionError("请选择已有渠道，或输入一个新渠道名称");
  const normalizedName = normalizeChannelName(name);
  const existing = await client.channel.findUnique({ where: { groupId_normalizedName: { groupId, normalizedName } } });
  if (existing) {
    if (!existing.active) throw new ChannelResolutionError("该渠道已停用，请联系管理员重新启用");
    return existing;
  }

  if (!["ADMIN", "RESOURCE_MANAGER", "COMPANY_MANAGER"].some((role) => hasAssignedRole(actor, role as User["role"]))) {
    throw new ChannelResolutionError("只能选择已有渠道；新增渠道请联系公司管理员、资源部管理员或超级管理员");
  }

  let channel;
  try {
    const id = randomUUID();
    const channelType = input.channelType ?? "SMS";
    channel = await client.channel.create({
      data: {
        id,
        name,
        normalizedName,
        groupId,
        createdById: actor.id,
        // 前台新建的渠道只属于本组；跨公司的公共渠道只能由资源部显式发布。
        fanCostMode: channelType === "REBATE" ? "FREE" : "PAID",
        effectiveFanPriceCents: null,
        channelType,
        rebateRateBps: channelType === "REBATE" ? 3000 : null,
      },
    });
  } catch (error) {
    if (!isConcurrentChannelCreateError(error)) throw error;
    const winner = await client.channel.findUnique({ where: { groupId_normalizedName: { groupId, normalizedName } } });
    if (winner) {
      if (!winner.active) throw new ChannelResolutionError("该渠道已停用，请联系管理员重新启用");
      return winner;
    }
    throw error;
  }
  await recordAudit(client, {
    actorId: actor.id,
    action: "CHANNEL_CREATED",
    entityType: "Channel",
    entityId: channel.id,
    summary: { scope: "GROUP", groupId, name: channel.name, channelType: channel.channelType, source: input.auditSource ?? "new_fans_entry" },
  });
  return channel;
}
