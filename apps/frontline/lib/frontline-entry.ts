export const WORK_ROLES = ["LEAD", "RECEPTION", "GROUP_OPERATOR", "EXPERT"] as const;

export type WorkRole = (typeof WORK_ROLES)[number];

export type FrontlineEntry =
  | { workspace: "ADMIN" }
  | { workspace: "FRONTLINE"; role: WorkRole };

export function resolveFrontlineEntry(roles: readonly string[], groupId: string | null): FrontlineEntry {
  const role = WORK_ROLES.find((candidate) => roles.includes(candidate));
  if (!groupId || !role) return { workspace: "ADMIN" };

  return { workspace: "FRONTLINE", role };
}
