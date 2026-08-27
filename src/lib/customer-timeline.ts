import { formatUsd as money } from "./money";

export type CustomerTimelineEvent = {
  key: string;
  occurredOn: string;
  createdAt: Date;
  label: string;
  actorName: string;
  detail: string;
  voided: boolean;
};

export const customerTimelineActivityLabels: Record<string, string> = {
  DEVICE_ASSIGNED: "填写设备号",
  REPLIED: "客户已回复",
  FOLLOWED_UP: "回访客户",
  JOINED_GROUP: "客户入群",
  LEFT_GROUP: "客户退群",
  EXPERT_INTRODUCED: "推专家",
  EXPERT_CONTACTED: "专家确认已联系",
  REGISTERED: "完成注册",
  MARKED_INVALID: "标记无效粉",
  RESTORED_VALID: "恢复有效粉",
  GROUP_JOIN_REVOKED: "撤销入群",
  GROUP_LEAVE_REVOKED: "撤销退群",
  EXPERT_INTRO_REVOKED: "撤销推专家",
  EXPERT_CONTACT_REVOKED: "撤销专家联系",
  REGISTRATION_REVOKED: "撤销注册",
  ORDER_VOIDED: "作废开单",
  FINANCE_VOIDED: "作废资金流水",
  PLAN_UPDATED: "更新下一步计划",
  GROUP_PROGRESS_UPDATED: "填写群内每日进度",
};

export function buildCustomerTimeline(input: {
  sourceDate: string;
  createdAt: Date;
  ownerName: string;
  channelName: string;
  activities: Array<{ id: string; kind: string; occurredOn: string; createdAt: Date; note: string | null; actorName: string }>;
  order: null | {
    id: string;
    openedOn: string;
    createdAt: Date;
    initialDepositCents: number;
    voidedAt: Date | null;
    voidReason: string | null;
    enteredByName: string;
    events: Array<{ id: string; kind: string; occurredOn: string; createdAt: Date; amountCents: number | null; continuationNumber: number | null; voidedAt: Date | null; voidReason: string | null; enteredByName: string }>;
  };
}): CustomerTimelineEvent[] {
  const events: CustomerTimelineEvent[] = [{
    key: "source",
    occurredOn: input.sourceDate,
    createdAt: input.createdAt,
    label: "录入号码",
    actorName: input.ownerName,
    detail: `来源渠道：${input.channelName}`,
    voided: false,
  }];

  for (const activity of input.activities) {
    events.push({
      key: `activity:${activity.id}`,
      occurredOn: activity.occurredOn,
      createdAt: activity.createdAt,
      label: customerTimelineActivityLabels[activity.kind] ?? activity.kind,
      actorName: activity.actorName,
      detail: activity.note?.trim() || "—",
      voided: false,
    });
  }

  if (input.order) {
    events.push({
      key: `order:${input.order.id}`,
      occurredOn: input.order.openedOn,
      createdAt: input.order.createdAt,
      label: input.order.voidedAt ? "开单（已作废）" : "客户开单",
      actorName: input.order.enteredByName,
      detail: input.order.voidedAt
        ? `原首充 ${money(input.order.initialDepositCents)} · 作废原因：${input.order.voidReason || "未填写"}`
        : `首充 ${money(input.order.initialDepositCents)}`,
      voided: Boolean(input.order.voidedAt),
    });
    for (const event of input.order.events) {
      const action = event.kind === "WITHDRAWAL"
        ? "出金"
        : event.continuationNumber
          ? `第 ${event.continuationNumber} 次续充`
          : "入金";
      events.push({
        key: `finance:${event.id}`,
        occurredOn: event.occurredOn,
        createdAt: event.createdAt,
        label: event.voidedAt ? `${action}（已作废）` : action,
        actorName: event.enteredByName,
        detail: `${money(event.amountCents ?? 0)}${event.voidedAt ? ` · 作废原因：${event.voidReason || "未填写"}` : ""}`,
        voided: Boolean(event.voidedAt),
      });
    }
  }

  return events.sort((left, right) => left.occurredOn.localeCompare(right.occurredOn) || left.createdAt.getTime() - right.createdAt.getTime());
}
