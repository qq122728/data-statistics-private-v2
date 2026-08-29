import { PrismaClient } from "@prisma/client";
import { applyDepartmentManagerDutyBackfill, planDepartmentManagerDutyBackfill } from "./backfill-department-manager-duty-lib.mjs";

/**
 * 阶段5a一次性数据回填（/Users/aaaa/.claude/plans/merry-sauteeing-cook.md 阶段5开工前摸底的
 * 命名坑决策）：老 Role.COMPANY_MANAGER（53个老路由在用，User.departmentId 单值绑定）实际语义
 * 是"管一个部门"，正是新架构里的**部门管理员**，不是新 Duty.COMPANY_MANAGER/Duty.HQ_MANAGER
 * 那种真正"管一个公司下多个部门"的公司/总公司管理员。新权限网关（org-permissions.ts）
 * 只读 Duty，不读 Role 字符串，所以这批既有账号需要一次性补上 Duty.DEPARTMENT_MANAGER，
 * 之后才能完全走新网关判断，不用在新代码里再认老的 Role.COMPANY_MANAGER 字符串。
 *
 * 安全边界：
 * - 只处理 role === "COMPANY_MANAGER" 的账号。
 * - 只回填 duty 当前为空（null）的账号；duty 已经手动设置成别的值（比如已经在走新账号体系
 *   提拔）的账号一律跳过、不覆盖——先查一遍打印出来，绝不盲目覆盖。
 * - 幂等：重复执行时，第一次已经回填过的账号 duty 不再是 null，第二次运行会显示"0 个账号
 *   待回填"，不会重复写入、也不会报错。
 * - 默认只预览，不写库；确认无误后加 CONFIRM_DEPARTMENT_MANAGER_DUTY_BACKFILL=YES 环境变量
 *   才会真正执行 UPDATE（仿照已删除的 backfill-rebate-channel-snapshots.mjs 的预览+确认模式）。
 *
 * 核心查询/更新逻辑抽在 backfill-department-manager-duty-lib.mjs，方便单测直接传假的 db
 * 对象验证（不需要真的起一个数据库），这里只负责真实数据库连接、预览打印和确认门禁。
 */

const db = new PrismaClient();

try {
  const { roleAccounts, toBackfill, alreadySet } = await planDepartmentManagerDutyBackfill(db);

  console.log(`共找到 ${roleAccounts.length} 个 Role.COMPANY_MANAGER 账号（老枚举值，实际语义=部门管理员）。`);

  console.log(`\nduty 已经有值，跳过不动：${alreadySet.length} 个`);
  if (alreadySet.length) {
    console.table(alreadySet.map((user) => ({
      username: user.username,
      name: user.name,
      duty: user.duty,
      departmentId: user.departmentId,
      active: user.active,
    })));
  }

  console.log(`\nduty 为空，将补成 DEPARTMENT_MANAGER：${toBackfill.length} 个`);
  if (toBackfill.length) {
    console.table(toBackfill.map((user) => ({
      username: user.username,
      name: user.name,
      departmentId: user.departmentId,
      active: user.active,
    })));
  }

  if (!toBackfill.length) {
    console.log("\n没有需要回填的账号，脚本可安全重复执行（幂等）。");
  } else if (process.env.CONFIRM_DEPARTMENT_MANAGER_DUTY_BACKFILL !== "YES") {
    console.log("\n当前仅预览，没有修改数据。核对无误后设置 CONFIRM_DEPARTMENT_MANAGER_DUTY_BACKFILL=YES 再执行。");
    process.exitCode = 2;
  } else {
    const result = await applyDepartmentManagerDutyBackfill(db, toBackfill);
    console.log(`\n已回填 ${result.count} 个账号的 duty = DEPARTMENT_MANAGER。`);
  }
} finally {
  await db.$disconnect();
}
