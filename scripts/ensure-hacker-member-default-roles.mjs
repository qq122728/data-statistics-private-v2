process.env.DATABASE_URL ||= "file:./dev.db";
const { PrismaClient } = await import("@prisma/client");

const db = new PrismaClient();
const apply = process.argv.includes("--apply");
const baseRoles = ["RECEPTION", "GROUP_OPERATOR"];

try {
  const members = await db.user.findMany({
    where: {
      group: { groupType: "HACKER" },
      role: { in: ["RECEPTION", "GROUP_OPERATOR", "EXPERT"] },
    },
    orderBy: [{ group: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      username: true,
      role: true,
      active: true,
      group: { select: { name: true, department: { select: { name: true } } } },
      roleAssignments: { select: { role: true } },
    },
  });

  const mismatches = members.flatMap((member) => {
    const current = new Set([member.role, ...member.roleAssignments.map((item) => item.role)]);
    const missing = baseRoles.filter((role) => !current.has(role));
    return missing.length ? [{ member, missing, current: [...current] }] : [];
  });

  console.log(JSON.stringify({
    mode: apply ? "APPLY" : "DRY_RUN",
    checked: members.length,
    mismatched: mismatches.length,
    accounts: mismatches.map(({ member, missing, current }) => ({
      department: member.group?.department.name ?? "—",
      group: member.group?.name ?? "—",
      name: member.name,
      username: member.username,
      active: member.active,
      primaryRole: member.role,
      currentRoles: current,
      missingRoles: missing,
    })),
  }, null, 2));

  if (!apply || mismatches.length === 0) process.exit(0);

  const actor = await db.user.findFirst({
    where: { role: "ADMIN", active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!actor) throw new Error("没有可用于记录修复审计的启用中总公司管理员账号");

  await db.$transaction(async (tx) => {
    for (const { member, missing, current } of mismatches) {
      await tx.userRoleAssignment.createMany({
        data: missing.map((role) => ({ userId: member.id, role })),
        skipDuplicates: true,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "MEMBER_DEFAULT_ROLES_REPAIRED",
          entityType: "User",
          entityId: member.id,
          summary: JSON.stringify({
            reason: "黑客组组员默认同时拥有接粉与炒群权限；专家为额外权限",
            before: current,
            added: missing,
            after: [...new Set([...current, ...missing])],
          }),
        },
      });
    }
  });

  console.log(`已补齐 ${mismatches.length} 个账号；只增加缺少的接粉/炒群权限，没有删除专家权限。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
