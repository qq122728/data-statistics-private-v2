import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { db } from "../../../../lib/db";
import { hasAssignedRole } from "../../../../lib/role-access";
import { API_LIMITS, hasOversizedQueryValue } from "../../../../lib/request-limits";
import { authorizationDenied } from "../../../../lib/security-events";

const stages = new Set(["reception", "group", "expert"]);
const PAGE_SIZE = 50;

function stageWhere(stage: string): Prisma.LeadCustomerWhereInput {
  if (stage === "reception") return { groupStatus: "NOT_JOINED", receptionArchivedAt: null };
  if (stage === "expert") return { expertIntroducedOn: { not: null } };
  return { groupStatus: { in: ["JOINED", "LEFT"] } };
}

/** 新版组长客户进度的只读入口。写操作继续走各岗位已有的专用 workflow API。 */
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    throw error;
  }
  if (!actor.active || !actor.groupId || !hasAssignedRole(actor, "LEAD"))
    return authorizationDenied(actor, "只有在职组长可以查看本组客户进度");

  const params = new URL(request.url).searchParams;
  if (hasOversizedQueryValue(params)) return NextResponse.json({ error: "查询条件过长" }, { status: 400 });
  const stage = stages.has(params.get("stage") ?? "") ? params.get("stage")! : "reception";
  const pageValue = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const query = (params.get("q") ?? "").trim().slice(0, API_LIMITS.searchCharacters);
  const baseWhere: Prisma.LeadCustomerWhereInput = {
    batch: { groupId: actor.groupId },
    invalid: false,
    ...(query ? { OR: [{ phone: { contains: query } }, { customerName: { contains: query } }] } : {}),
  };
  const where: Prisma.LeadCustomerWhereInput = { AND: [baseWhere, stageWhere(stage)] };
  const countStages = ["reception", "group", "expert"] as const;
  const [total, customers, ...counts] = await Promise.all([
    db.leadCustomer.count({ where }),
    db.leadCustomer.findMany({
      where,
      select: {
        id: true, phone: true, customerName: true, customerEmail: true,
        lossAmountCents: true, customerPlatform: true, notes: true,
        replyStatus: true, repliedOn: true, followUpCount: true, lastFollowedUpOn: true,
        groupStatus: true, joinedOn: true, leftOn: true, leftNote: true, leftWithOrder: true,
        expertIntroducedOn: true, expertContactedOn: true, expertContactNote: true,
        expertWorkflowStage: true, registeredOn: true, nextPlan: true, nextFollowUpOn: true,
        owner: { select: { id: true, name: true } },
        groupOperatorOwner: { select: { id: true, name: true } },
        expertOwner: { select: { id: true, name: true } },
        batch: { select: { sourceDate: true, channel: { select: { name: true } }, group: { select: { name: true } } } },
        customerOrder: {
          select: {
            id: true, openedOn: true, initialDepositCents: true, voidedAt: true,
            events: { where: { voidedAt: null, kind: { in: ["RECHARGE", "WITHDRAWAL"] } }, select: { kind: true, amountCents: true } },
          },
        },
        activities: {
          where: { kind: { in: ["REPLIED", "JOINED_GROUP", "GROUP_PROGRESS_UPDATED", "EXPERT_CONTACTED", "REGISTERED", "PLAN_UPDATED"] } },
          select: { id: true, kind: true, occurredOn: true, note: true, actor: { select: { name: true } } },
          orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }],
          take: 3,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    ...countStages.map((value) => db.leadCustomer.count({ where: { AND: [baseWhere, stageWhere(value)] } })),
  ]);

  return NextResponse.json({
    stage, page, pageSize: PAGE_SIZE, total,
    counts: Object.fromEntries(countStages.map((value, index) => [value, counts[index]])),
    customers: customers.map((customer) => {
      const activeOrder = customer.customerOrder && !customer.customerOrder.voidedAt ? customer.customerOrder : null;
      return {
        ...customer,
        order: activeOrder ? {
          id: activeOrder.id,
          openedOn: activeOrder.openedOn,
          initialDepositCents: activeOrder.initialDepositCents,
          rechargeCents: activeOrder.events.filter((event) => event.kind === "RECHARGE").reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
          withdrawalCents: activeOrder.events.filter((event) => event.kind === "WITHDRAWAL").reduce((sum, event) => sum + (event.amountCents ?? 0), 0),
        } : null,
        customerOrder: undefined,
      };
    }),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
