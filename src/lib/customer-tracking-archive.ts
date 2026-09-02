import type { Prisma } from "@prisma/client";

export function activeCustomerTrackingWhere(): Prisma.LeadCustomerWhereInput {
  return { trackingArchivedAt: null };
}
