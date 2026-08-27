import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import { normalizeChannelName } from "../../../lib/channel-names";
import { ChannelResolutionError, resolveOrCreateChannel } from "../../../lib/channels";
import { db } from "../../../lib/db";
import { hasAssignedRole } from "../../../lib/role-access";
import { authorizationDenied } from "../../../lib/security-events";

const createSchema = z.object({
  name: z.string().trim().min(1, "请输入新渠道名称").max(100, "渠道名称不能超过100个字"),
  channelType: z.enum(["SMS", "ADS", "REBATE"], { message: "请选择短信粉、投流粉或底料返点" }).optional().default("SMS"),
}).strict();

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!["ADMIN", "RESOURCE_MANAGER", "COMPANY_MANAGER"].some((role) => hasAssignedRole(user, role as typeof user.role)))
    return authorizationDenied(user, "只有公司管理员、资源部管理员或超级管理员可以新增渠道");

  try {
    const input = createSchema.parse(await request.json());
    const result = await db.$transaction(async (transaction) => {
      const groupId = user.groupId;
      if (!groupId) throw new ChannelResolutionError("当前账号没有所属小组");
      const existing = await transaction.channel.findFirst({
        where: { groupId, normalizedName: normalizeChannelName(input.name) },
        select: { id: true },
      });
      const channel = await resolveOrCreateChannel(transaction, {
        actor: user,
        channelName: input.name,
        channelType: input.channelType,
        auditSource: "channel_setup",
      });
      return { channel, created: !existing };
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "渠道名称不正确" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    if (error instanceof ChannelResolutionError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
