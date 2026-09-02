import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { customerCodePrefixForChannel, parsePhoneImport } from "../../../../lib/phone-import";
import { normalizeCustomerPhone } from "../../../../lib/entry-ledger";
import { getAssignedRoles, hasAssignedRole } from "../../../../lib/role-access";
import { API_LIMITS } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";
import { leadCurrentGroupId } from "../../../../lib/customer-current-group";
import { isCustomerCollaborator } from "../../../../lib/customer-collaboration-visibility";

const inputSchema = z.object({
  phones: z.string().trim().min(1, "请粘贴至少一个手机号").max(API_LIMITS.customerImportTextCharacters, "一次粘贴的号码过多，请分批检查"),
  channelId: z.string().min(1).max(API_LIMITS.identifierCharacters).optional(),
}).strict();

/** 单个号码安全查重：无配合关系时只回答“已存在”，不泄露客户资料。 */
export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
    throw error;
  }
  if (!getAssignedRoles(user).some((role) => ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"].includes(role)))
    return authorizationDenied(user, "当前岗位不能查询客户号码");
  if (!user.groupId) return authorizationDenied(user, "当前账号未绑定小组");
  let phone: string;
  try {
    phone = normalizeCustomerPhone(new URL(request.url).searchParams.get("phone") ?? "");
  } catch {
    return NextResponse.json({ error: "请输入正确的客户号码" }, { status: 400 });
  }
  const existing = await db.leadCustomer.findFirst({
    where: { phone, trackingArchivedAt: null },
    select: {
      ownerId: true, attributionOwnerId: true, groupOperatorOwnerId: true, expertOwnerId: true, currentGroupId: true,
      batch: { select: { groupId: true } },
    },
  });
  if (!existing) return NextResponse.json({ exists: false, phone });
  if (leadCurrentGroupId(existing) !== user.groupId)
    return NextResponse.json({ exists: true, sameGroup: false, message: "该号码已存在" });
  if (!getAssignedRoles(user).includes("LEAD") && !isCustomerCollaborator(user.id, existing))
    return NextResponse.json({ exists: true, sameGroup: true, canAccess: false, message: "该号码已存在" });
  return NextResponse.json({ exists: true, sameGroup: true, canAccess: true, phone });
}

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
        ownerId: true,
        attributionOwnerId: true,
        groupOperatorOwnerId: true,
        expertOwnerId: true,
        currentGroupId: true,
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
        ownerName:
          leadCurrentGroupId(lead) === user.groupId &&
          isCustomerCollaborator(user.id, lead)
            ? lead.owner.name
            : "已存在客户",
      })),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "请检查号码内容" }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容不是有效 JSON" }, { status: 400 });
    throw error;
  }
}
