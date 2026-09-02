import type { Prisma } from "@prisma/client";

/**
 * 普通组员查看客户明细的统一边界：只要本人是原接粉人、当前炒群负责人或
 * 当前专家负责人之一，就属于这位客户的实际协作人。
 *
 * attributionOwnerId 是现行权威字段；第二项只兼容尚未回填该字段的旧客户。
 * 组长和组织管理员是否跳过本条件，由各读取路由在确认管理范围后决定。
 */
export function customerCollaborationWhere(
  actorId: string,
): Prisma.LeadCustomerWhereInput {
  return {
    OR: [
      { attributionOwnerId: actorId },
      { attributionOwnerId: null, ownerId: actorId },
      { groupOperatorOwnerId: actorId },
      { expertOwnerId: actorId },
    ],
  };
}

export function isCustomerCollaborator(
  actorId: string,
  customer: {
    ownerId: string;
    attributionOwnerId?: string | null;
    groupOperatorOwnerId?: string | null;
    expertOwnerId?: string | null;
  },
): boolean {
  const receptionOwnerId = customer.attributionOwnerId ?? customer.ownerId;
  return (
    receptionOwnerId === actorId ||
    customer.groupOperatorOwnerId === actorId ||
    customer.expertOwnerId === actorId
  );
}
