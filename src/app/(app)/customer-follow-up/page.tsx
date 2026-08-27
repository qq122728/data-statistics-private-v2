import { redirect } from "next/navigation";
import {
  CustomerFollowUpTable,
  type AdminCustomerFollowUpRow,
} from "../../../components/admin/CustomerFollowUpTable";
import { AuthenticationError, requireUser } from "../../../lib/auth";
import {
  customerStagnationDays,
  deriveCustomerFollowUpStage,
  isFollowUpPlanOverdue,
  suggestedCustomerNextPlan,
} from "../../../lib/customer-follow-up";
import { localDateYYYYMMDD } from "../../../lib/dates";
import { db } from "../../../lib/db";
import { getSystemSettings } from "../../../lib/settings";

const activityLabels: Record<string, string> = {
  DEVICE_ASSIGNED: "填写设备号",
  REPLIED: "客户回复",
  FOLLOWED_UP: "回访客户",
  JOINED_GROUP: "客户入群",
  LEFT_GROUP: "客户退群",
  EXPERT_INTRODUCED: "推专家",
  REGISTERED: "完成注册",
  MARKED_INVALID: "标记无效粉",
  RESTORED_VALID: "恢复有效粉",
  GROUP_JOIN_REVOKED: "撤销入群",
  GROUP_LEAVE_REVOKED: "撤销退群",
  EXPERT_INTRO_REVOKED: "撤销推专家",
  REGISTRATION_REVOKED: "撤销注册",
  ORDER_VOIDED: "作废开单",
  FINANCE_VOIDED: "作废资金流水",
};

type ActionCandidate = {
  occurredOn: string;
  createdAt: Date;
  label: string;
  actorName: string;
};

function uniqueNames(names: Array<string | null | undefined>): string[] {
  return [...new Set(names.filter((name): name is string => Boolean(name)))];
}

export default async function CustomerFollowUpPage() {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthenticationError)
      redirect("/login?next=/customer-follow-up");
    throw error;
  }
  if (user.role !== "ADMIN") redirect("/dashboard");

  const [settings, groups, leads] = await Promise.all([
    getSystemSettings(),
    db.teamGroup.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.leadCustomer.findMany({
      select: {
        id: true,
        phone: true,
        customerName: true,
        invalid: true,
        replyStatus: true,
        groupStatus: true,
        expertIntroducedOn: true,
        registeredOn: true,
        expertOwnerId: true,
        expertDeviceAccountNumber: true,
        nextPlan: true,
        nextFollowUpOn: true,
        createdAt: true,
        owner: {
          select: {
            name: true,
            receptionistAssignments: {
              where: { groupOperator: { active: true } },
              select: {
                groupOperator: { select: { name: true } },
              },
            },
          },
        },
        expertOwner: { select: { name: true } },
        batch: {
          select: {
            sourceDate: true,
            createdAt: true,
            channel: { select: { name: true } },
            group: {
              select: {
                id: true,
                name: true,
                members: {
                  where: { role: "LEAD", active: true },
                  select: { name: true },
                },
              },
            },
          },
        },
        activities: {
          where: { kind: { not: "PLAN_UPDATED" } },
          select: {
            kind: true,
            occurredOn: true,
            createdAt: true,
            actor: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        customerOrder: {
          select: {
            openedOn: true,
            createdAt: true,
            voidedAt: true,
            enteredBy: { select: { name: true } },
            events: {
              where: { voidedAt: null },
              select: {
                kind: true,
                occurredOn: true,
                createdAt: true,
                enteredBy: { select: { name: true } },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const today = localDateYYYYMMDD(new Date(), settings.timezone);
  const rows: AdminCustomerFollowUpRow[] = leads.map((lead) => {
    const stage = deriveCustomerFollowUpStage({
      invalid: lead.invalid,
      groupStatus: lead.groupStatus,
      replyStatus: lead.replyStatus,
      expertIntroducedOn: lead.expertIntroducedOn,
      registeredOn: lead.registeredOn,
      expertOwnerId: lead.expertOwnerId,
      order: lead.customerOrder,
    });
    const groupLeadNames = lead.batch.group.members.map((member) => member.name);
    const groupOperatorNames = lead.owner.receptionistAssignments.map(
      (assignment) => assignment.groupOperator.name,
    );

    let responsibleNames: string[] = [];
    let responsibleRole = "已关闭";
    let collaboratorNames: string[] = [];
    if (stage === "NEW" || stage === "REPLIED") {
      responsibleNames = [lead.owner.name];
      responsibleRole = "前台接粉";
    } else if (stage === "IN_GROUP") {
      responsibleNames = uniqueNames(groupOperatorNames.length ? groupOperatorNames : groupLeadNames);
      responsibleRole = groupOperatorNames.length ? "前台炒群" : "组长暂代炒群";
      collaboratorNames = [lead.owner.name];
    } else if (stage === "WAITING_EXPERT_ASSIGNMENT") {
      responsibleNames = uniqueNames(groupLeadNames);
      responsibleRole = "组长分配专家";
      collaboratorNames = uniqueNames([...groupOperatorNames, lead.owner.name]);
    } else if (stage === "EXPERT_INTRODUCED" || stage === "REGISTERED" || stage === "ORDERED") {
      responsibleNames = lead.expertOwner
        ? [lead.expertOwner.name]
        : uniqueNames(groupLeadNames);
      responsibleRole = lead.expertOwner ? "前台专家" : "组长暂代专家";
      collaboratorNames = uniqueNames([
        ...groupOperatorNames,
        lead.owner.name,
        ...(lead.expertOwner ? groupLeadNames : []),
      ]);
    }

    const candidates: ActionCandidate[] = [
      {
        occurredOn: lead.batch.sourceDate,
        createdAt: lead.createdAt,
        label: "录入号码",
        actorName: lead.owner.name,
      },
    ];
    const activity = lead.activities[0];
    if (activity) {
      candidates.push({
        occurredOn: activity.occurredOn,
        createdAt: activity.createdAt,
        label: activityLabels[activity.kind] ?? activity.kind,
        actorName: activity.actor.name,
      });
    }
    if (lead.customerOrder && !lead.customerOrder.voidedAt) {
      candidates.push({
        occurredOn: lead.customerOrder.openedOn,
        createdAt: lead.customerOrder.createdAt,
        label: "客户开单",
        actorName: lead.customerOrder.enteredBy.name,
      });
      const event = lead.customerOrder.events[0];
      if (event) {
        candidates.push({
          occurredOn: event.occurredOn,
          createdAt: event.createdAt,
          label: event.kind === "WITHDRAWAL" ? "登记出金" : "登记续充",
          actorName: event.enteredBy.name,
        });
      }
    }
    candidates.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
    const latest = candidates[0];

    return {
      id: lead.id,
      phone: lead.phone,
      customerName: lead.customerName,
      groupId: lead.batch.group.id,
      groupName: lead.batch.group.name,
      sourceDate: lead.batch.sourceDate,
      channelName: lead.batch.channel.name,
      sourceOwnerName: lead.owner.name,
      stage,
      responsibleNames,
      responsibleRole,
      expertDeviceAccountNumber: lead.expertDeviceAccountNumber,
      collaboratorNames,
      stagnationDays: customerStagnationDays(latest.occurredOn, today),
      lastActionOn: latest.occurredOn,
      lastActionLabel: latest.label,
      lastActorName: latest.actorName,
      nextPlan: lead.nextPlan,
      suggestedPlan: suggestedCustomerNextPlan(stage),
      nextFollowUpOn: lead.nextFollowUpOn,
      planOverdue: isFollowUpPlanOverdue(lead.nextFollowUpOn, today),
    };
  });

  return (
    <main className="page-shell space-y-3">
      <div className="page-heading">
        <div>
          <h1 className="page-title">客户跟进</h1>
          <p className="page-description">
            一行一个手机号；来源归属始终保留，同时显示当前真正该跟进的人、停滞天数和下一步计划。
          </p>
        </div>
      </div>
      <CustomerFollowUpTable initialRows={rows} groups={groups} today={today} />
    </main>
  );
}
