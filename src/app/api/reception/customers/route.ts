import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { hasAssignedRole } from "../../../../lib/role-access";
import { API_LIMITS, hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

const stages = ["reply", "group", "archived"] as const;
type Stage = (typeof stages)[number];
const PAGE_SIZE = 50;

function stageWhere(stage: Stage): Prisma.LeadCustomerWhereInput {
  if (stage === "group") {
    return {
      groupStatus: "NOT_JOINED",
      repliedOn: { not: null },
      receptionArchivedAt: null,
    };
  }
  if (stage === "archived") {
    return {
      groupStatus: "NOT_JOINED",
      receptionArchivedAt: { not: null },
    };
  }
  return {
    groupStatus: "NOT_JOINED",
    repliedOn: null,
    receptionArchivedAt: null,
  };
}

/** 新版接粉工作台的只读名单。每位接粉只能读取自己名下、自己当前小组的客户。 */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !actor.groupId || !hasAssignedRole(actor, "RECEPTION"))
    return authorizationDenied(actor, "只有在职接粉可以查看自己的客户");

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params))
    return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const stageParam = params.get("stage");
  const stage: Stage = stages.includes(stageParam as Stage) ? stageParam as Stage : "reply";
  const pageValue = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const query = (params.get("q") ?? "").trim().slice(0, API_LIMITS.searchCharacters);
  const baseWhere: Prisma.LeadCustomerWhereInput = {
    ownerId: actor.id,
    batch: { groupId: actor.groupId },
    // 扣粉/无效号码仍保留在客户档案，但不能混进正常回复与入群待办。
    invalid: false,
    receptionCategory: { notIn: ["INVALID", "LOW_AMOUNT", "NO_WS"] },
    ...(query ? { OR: [{ phone: { contains: query } }, { customerName: { contains: query } }] } : {}),
  };
  const where: Prisma.LeadCustomerWhereInput = { AND: [baseWhere, stageWhere(stage)] };

  // 待入群客户在真正交棒前还没有冻结 groupOperatorOwner；把当前配对
  // 单独返回给前端，既能显示将交给谁，也能在“待配对”时明确阻止误点。
  const [pairing, receptionDevices] = await Promise.all([
    db.groupOperatorReception.findUnique({
      where: { receptionistId: actor.id },
      select: { groupOperator: { select: { id: true, name: true, active: true, groupId: true } } },
    }),
    // 新版“设备账号”是唯一的用户入口。客户流程仍保留旧 Device 外键兼容
    // 线上历史数据，因此这里只把本人新版账号作为可选项返回；真正选择时
    // assignDevice 会按号码补齐兼容 Device 记录。
    db.deviceAccount.findMany({
      where: { groupId: actor.groupId, ownerId: actor.id },
      select: { id: true, accountNumber: true, accountType: true, provider: true },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    }),
  ]);
  const currentGroupOperator = pairing?.groupOperator.active && pairing.groupOperator.groupId === actor.groupId
    ? { id: pairing.groupOperator.id, name: pairing.groupOperator.name }
    : null;

  const [total, customers, ...counts] = await Promise.all([
    db.leadCustomer.count({ where }),
    db.leadCustomer.findMany({
      where,
      select: {
        id: true,
        phone: true,
        customerName: true,
        customerEmail: true,
        lossAmountCents: true,
        customerPlatform: true,
        notes: true,
        invalid: true,
        receptionCategory: true,
        replyStatus: true,
        repliedOn: true,
        followUpCount: true,
        lastFollowedUpOn: true,
        receptionChatStatus: true,
        receptionArchivedAt: true,
        receptionArchiveReason: true,
        receptionArchiveVisitCount: true,
        attributionOwner: { select: { id: true, name: true } },
        groupOperatorOwner: { select: { id: true, name: true } },
        device: { select: { id: true, code: true } },
        batch: {
          select: {
            sourceDate: true,
            channel: { select: { id: true, name: true } },
          },
        },
        activities: {
          where: { kind: { in: ["FOLLOWED_UP", "REPLIED", "REPLY_UNDONE", "RECEPTION_STATUS_UPDATED", "RECEPTION_ARCHIVED"] } },
          select: { id: true, kind: true, occurredOn: true, note: true, actor: { select: { name: true } } },
          orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
          take: 5,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    ...stages.map((value) => db.leadCustomer.count({ where: { AND: [baseWhere, stageWhere(value)] } })),
  ]);

  return NextResponse.json({
    stage,
    page,
    pageSize: PAGE_SIZE,
    total,
    currentGroupOperator,
    receptionDevices,
    counts: Object.fromEntries(stages.map((value, index) => [value, counts[index]])),
    customers,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
