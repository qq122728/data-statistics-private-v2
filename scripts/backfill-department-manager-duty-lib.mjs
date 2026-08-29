/**
 * 阶段5a数据回填的可测试核心逻辑，从 backfill-department-manager-duty.mjs 抽出——
 * 仿照 rotate-initial-account-passwords-lib.mjs 的拆分方式：CLI 脚本负责真实数据库连接、
 * 预览打印和确认门禁，这里只负责纯粹的"查询-分组-更新"逻辑，方便单测直接传一个假的
 * db 对象（vi.fn 模拟 user.findMany/user.updateMany）验证幂等性和"不覆盖已设置 duty"
 * 这两条安全约束，不需要真的起一个数据库。
 */

export async function planDepartmentManagerDutyBackfill(db) {
  const roleAccounts = await db.user.findMany({
    where: { role: "COMPANY_MANAGER" },
    select: { id: true, username: true, name: true, duty: true, departmentId: true, active: true },
    orderBy: { username: "asc" },
  });
  const toBackfill = roleAccounts.filter((user) => user.duty === null);
  const alreadySet = roleAccounts.filter((user) => user.duty !== null);
  return { roleAccounts, toBackfill, alreadySet };
}

/**
 * where 里再带一次 duty: null，防止预览和执行之间数据发生变化（防御性写法，
 * 不能只信任调用方传入的、已经在 JS 层过滤过的 id 列表）；一个用户已经手动设置过
 * 别的 duty 绝不会出现在 toBackfill 里，也就绝不会被这里覆盖。
 */
export async function applyDepartmentManagerDutyBackfill(db, toBackfill) {
  if (!toBackfill.length) return { count: 0 };
  return db.user.updateMany({
    where: { id: { in: toBackfill.map((user) => user.id) }, role: "COMPANY_MANAGER", duty: null },
    data: { duty: "DEPARTMENT_MANAGER" },
  });
}
