import type { Prisma, PrismaClient } from "@prisma/client";

type AuditClient = Pick<PrismaClient, "auditLog"> | Prisma.TransactionClient;

export type AuditInput = {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: Record<string, unknown>;
};

function sortSummary(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortSummary);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortSummary(nestedValue)]),
    );
  }

  return value;
}

export async function recordAudit(client: AuditClient, input: AuditInput): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: JSON.stringify(sortSummary(input.summary)),
    },
  });
}
