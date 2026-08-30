-- SQLite development equivalent of the production compatibility backfill.
UPDATE "User"
SET "duty" = CASE
  WHEN "role" = 'LEAD' THEN 'LEAD'
  WHEN "role" = 'COMPANY_MANAGER' THEN 'DEPARTMENT_MANAGER'
  WHEN "role" = 'RESOURCE_MANAGER' THEN 'RESOURCE_MANAGER'
  WHEN "role" = 'FINANCE' THEN 'FINANCE'
  ELSE "duty"
END
WHERE "duty" IS NULL
  AND "role" IN ('LEAD', 'COMPANY_MANAGER', 'RESOURCE_MANAGER', 'FINANCE');

INSERT OR IGNORE INTO "UserRoleAssignment" ("id", "userId", "role", "createdAt")
SELECT
  'primary-role-repair-' || "id",
  "id",
  "role",
  CURRENT_TIMESTAMP
FROM "User";

INSERT OR IGNORE INTO "UserPosition" (
  "id",
  "userId",
  "position",
  "secondaryPositions",
  "groupId",
  "effectiveFrom",
  "effectiveTo",
  "reason",
  "createdById",
  "createdAt"
)
SELECT
  'legacy-position-' || membership."id",
  membership."userId",
  membership."role",
  membership."secondaryRoles",
  membership."groupId",
  membership."effectiveFrom",
  membership."effectiveTo",
  COALESCE(membership."reason", '系统升级自动建立岗位历史'),
  membership."createdById",
  membership."createdAt"
FROM "UserGroupMembership" AS membership
WHERE membership."role" IN ('RECEPTION', 'GROUP_OPERATOR', 'EXPERT');
