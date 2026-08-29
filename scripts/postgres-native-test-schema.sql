-- Prisma schema 目前无法表达带 WHERE 的部分唯一索引。
-- 正式迁移 20260821022000_enforce_one_active_lead_per_group 创建了该约束；
-- 参考库从 datamodel 生成后补上它，才能与正式 migrations 的结果做完整结构比较。
CREATE UNIQUE INDEX "User_one_active_lead_per_group"
ON "User"("groupId")
WHERE "role" = 'LEAD' AND "active" = true AND "groupId" IS NOT NULL;
