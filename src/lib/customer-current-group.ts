import type { Prisma } from "@prisma/client";

/** 当前工作归属：调组后的客户看 currentGroupId；从未调组的客户沿用来源批次小组。 */
export function customerCurrentGroupWhere(groupId: string): Prisma.LeadCustomerWhereInput {
  return {
    OR: [
      { currentGroupId: groupId },
      { currentGroupId: null, batch: { groupId } },
    ],
  };
}

export function customerCurrentGroupsWhere(groupIds: string[]): Prisma.LeadCustomerWhereInput {
  return {
    OR: [
      { currentGroupId: { in: groupIds } },
      { currentGroupId: null, batch: { groupId: { in: groupIds } } },
    ],
  };
}

export function leadCurrentGroupId(lead: { currentGroupId?: string | null; batch: { groupId: string } }) {
  return lead.currentGroupId ?? lead.batch.groupId;
}
