import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationError, requireUser } from "../../../../lib/auth";
import { recordAudit } from "../../../../lib/audit";
import { db } from "../../../../lib/db";
import { API_LIMITS } from "../../../../lib/request-limits";
import { hasAssignedRole } from "../../../../lib/role-access";
import { authorizationDenied } from "../../../../lib/security-events";
import { allocateCustomerStageNumber } from "../../../../lib/customer-stage-number";

const reviewSchema = z.object({
  leadId: z.string().min(1).max(API_LIMITS.identifierCharacters),
  decision: z.enum(["APPROVE", "RETURN"]),
  reason: z.string().trim().max(500, "退回原因不能超过 500 个字").optional(),
}).superRefine((value, context) => {
  if (value.decision === "RETURN" && !value.reason)
    context.addIssue({ code: "custom", path: ["reason"], message: "退回时必须填写原因" });
});

async function leadActor() {
  try {
    const actor = await requireUser();
    if (!hasAssignedRole(actor, "LEAD")) return { actor, error: authorizationDenied(actor, "只有组长可以审核历史客户") } as const;
    if (!actor.groupId) return { actor, error: authorizationDenied(actor, "当前组长未绑定小组") } as const;
    return { actor, error: null } as const;
  } catch (error) {
    if (error instanceof AuthenticationError)
      return { actor: null, error: NextResponse.json({ error: "请先登录" }, { status: 401 }) } as const;
    throw error;
  }
}

export async function GET() {
  const session = await leadActor();
  if (session.error) return session.error;
  const rows = await db.leadCustomer.findMany({
    where: { isHistoricalRecord: true, historicalReviewStatus: "PENDING", batch: { groupId: session.actor.groupId! } },
    select: {
      id: true, phone: true, customerName: true, historicalSourceName: true, historicalBaselineStage: true,
      notes: true, createdAt: true,
      owner: { select: { id: true, name: true } },
      groupOperatorOwner: { select: { id: true, name: true } },
      expertOwner: { select: { id: true, name: true } },
      batch: { select: { sourceDate: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ claims: rows });
}

export async function POST(request: Request) {
  const session = await leadActor();
  if (session.error) return session.error;
  const sessionUser = session.actor;
  try {
    const input = reviewSchema.parse(await request.json());
    const result = await db.$transaction(async (tx) => {
      const actor = await tx.user.findUnique({
        where: { id: sessionUser.id },
        select: { id: true, active: true, groupId: true, role: true, roleAssignments: { select: { role: true } } },
      });
      if (!actor?.active || !actor.groupId || !hasAssignedRole(actor, "LEAD"))
        return { status: 403 as const, error: "只有组长可以审核历史客户" };
      const lead = await tx.leadCustomer.findUnique({
        where: { id: input.leadId },
        select: { id: true, groupQueueNumber: true, expertQueueNumber: true, registrationQueueNumber: true, historicalBaselineStage: true, historicalReviewStatus: true, batch: { select: { groupId: true, sourceDate: true } } },
      });
      if (!lead || lead.batch.groupId !== actor.groupId)
        return { status: 404 as const, error: "未找到本组待审核历史客户" };
      if (lead.historicalReviewStatus !== "PENDING")
        return { status: 409 as const, error: "这条认领已经处理，请刷新列表" };

      const reviewedAt = new Date();
      if (input.decision === "RETURN") {
        await tx.leadCustomer.update({
          where: { id: lead.id },
          data: { historicalReviewStatus: "RETURNED", historicalReviewedById: actor.id, historicalReviewedAt: reviewedAt, invalidReason: `历史客户认领已退回：${input.reason}` },
        });
        await recordAudit(tx, { actorId: actor.id, action: "HISTORICAL_CUSTOMER_CLAIM_RETURNED", entityType: "LeadCustomer", entityId: lead.id, summary: { reason: input.reason } });
        return { status: 200 as const, reviewStatus: "RETURNED" as const };
      }

      const stage = lead.historicalBaselineStage;
      const stages = ["NOT_REPLIED", "REPLIED", "JOINED", "INTRODUCED", "CONTACTED", "TRACKING", "REGISTERED"];
      if (!stage || !stages.includes(stage))
        return { status: 400 as const, error: "历史阶段无效，请退回后重新认领" };
      const sourceDate = lead.batch.sourceDate;
      const rank = stages.indexOf(stage);
      const groupQueueNumber = rank >= 2 && !lead.groupQueueNumber
        ? await allocateCustomerStageNumber(tx, actor.groupId, "GROUP", sourceDate)
        : lead.groupQueueNumber;
      const expertQueueNumber = rank >= 3 && !lead.expertQueueNumber
        ? await allocateCustomerStageNumber(tx, actor.groupId, "EXPERT", sourceDate)
        : lead.expertQueueNumber;
      const registrationQueueNumber = stage === "REGISTERED" && !lead.registrationQueueNumber
        ? await allocateCustomerStageNumber(tx, actor.groupId, "REGISTRATION", sourceDate)
        : lead.registrationQueueNumber;
      await tx.leadCustomer.update({ where: { id: lead.id }, data: {
        invalid: false,
        invalidReason: null,
        historicalReviewStatus: "APPROVED",
        historicalReviewedById: actor.id,
        historicalReviewedAt: reviewedAt,
        groupQueueNumber,
        groupQueueGroupId: groupQueueNumber ? actor.groupId : null,
        expertQueueNumber,
        expertQueueGroupId: expertQueueNumber ? actor.groupId : null,
        registrationQueueNumber,
        registrationQueueGroupId: registrationQueueNumber ? actor.groupId : null,
        replyStatus: rank >= 1 ? "REPLIED" : "NOT_REPLIED",
        repliedOn: rank >= 1 ? sourceDate : null,
        groupStatus: rank >= 2 ? "JOINED" : "NOT_JOINED",
        joinedOn: rank >= 2 ? sourceDate : null,
        expertIntroducedOn: rank >= 3 ? sourceDate : null,
        expertContactedOn: rank >= 4 ? sourceDate : null,
        registeredOn: stage === "REGISTERED" ? sourceDate : null,
        expertWorkflowStage: stage === "REGISTERED" ? "PENDING_ORDER" : stage === "TRACKING" ? "TRACKING" : stage === "CONTACTED" ? "MATERIALS" : rank >= 3 ? "QUEUED" : null,
        expertStageChangedAt: rank >= 3 ? new Date(`${sourceDate}T12:00:00.000Z`) : null,
        // 历史底账全部保持 false；只有审核通过后通过正常工作流发生的新动作才会改为 true。
        historicalReplyCounted: false,
        historicalJoinCounted: false,
        historicalExpertIntroCounted: false,
        historicalRegistrationCounted: false,
      } });
      await recordAudit(tx, { actorId: actor.id, action: "HISTORICAL_CUSTOMER_CLAIM_APPROVED", entityType: "LeadCustomer", entityId: lead.id, summary: { baselineStage: stage } });
      return { status: 200 as const, reviewStatus: "APPROVED" as const };
    }, { isolationLevel: "Serializable" });

    if (result.status === 403) return authorizationDenied(sessionUser, result.error);
    if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.issues[0]?.message ?? "请检查审核内容" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "审核失败" }, { status: 400 });
  }
}
