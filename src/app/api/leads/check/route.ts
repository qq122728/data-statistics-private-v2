import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { customerCodePrefixForChannel, parsePhoneImport } from "../../../../lib/phone-import";
import { hasAssignedRole } from "../../../../lib/role-access";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

const inputSchema = z.object({
  phones: z.string().trim().min(1, "请粘贴至少一个手机号").max(API_LIMITS.customerImportTextCharacters, "一次粘贴的号码过多，请分批检查"),
  channelId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
}).strict();

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!hasAssignedRole(user, "RECEPTION")) return authorizationDenied(user, "只有前台接粉可以检查导入号码");

  try {
    const input = inputSchema.parse(await request.json());
    const channel = input.channelId ? await db.channel.findFirst({
      where: { id: input.channelId, groupId: user.groupId ?? "__none__", active: true },
      select: { name: true, channelType: true },
    }) : null;
    if (input.channelId && !channel) return NextResponse.json({ error: "渠道不存在或已停用，请重新选择" }, { status: 400 });
    const parsed = parsePhoneImport(input.phones, channel ? {
      customerCodePrefix: customerCodePrefixForChannel(channel.channelType),
      channelName: channel.name,
    } : undefined);
    const collisions = parsed.distinctPhones.length ? await db.leadCustomer.findMany({
      where: { phone: { in: parsed.distinctPhones } },
      select: {
        phone: true,
        owner: { select: { name: true } },
        batch: { select: { groupId: true } },
      },
      orderBy: { createdAt: "asc" },
    }) : [];
    return NextResponse.json({
      submitted: parsed.rawPhones.length,
      validUniqueCount: parsed.distinctPhones.length,
      importableCount: parsed.distinctPhones.length - collisions.length,
      invalidCount: parsed.invalidPhones.length,
      invalidPhones: parsed.invalidPhones,
      duplicateCount: parsed.duplicateCount,
      duplicatePhones: parsed.duplicatePhones,
      collisionCount: collisions.length,
      collisions: collisions.map((lead) => ({
        phone: lead.phone,
        ownerName: lead.batch.groupId === user.groupId ? lead.owner.name : "其他公司或小组",
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查号码内容" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
