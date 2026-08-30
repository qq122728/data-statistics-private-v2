-- Preserve usernames and password hashes. This migration only fills the new structural
-- fields from existing roles and membership history so old accounts open the right UI.
UPDATE "User"
SET "duty" = CASE
  WHEN "role" = 'LEAD' THEN 'LEAD'::"Duty"
  WHEN "role" = 'COMPANY_MANAGER' THEN 'DEPARTMENT_MANAGER'::"Duty"
  WHEN "role" = 'RESOURCE_MANAGER' THEN 'RESOURCE_MANAGER'::"Duty"
  WHEN "role" = 'FINANCE' THEN 'FINANCE'::"Duty"
  ELSE "duty"
END
WHERE "duty" IS NULL
  AND "role" IN ('LEAD', 'COMPANY_MANAGER', 'RESOURCE_MANAGER', 'FINANCE');

-- Repair any historical account that is missing its primary role assignment.
INSERT INTO "UserRoleAssignment" ("id", "userId", "role", "createdAt")
SELECT
  'primary-role-repair-' || md5("id"),
  "id",
  "role",
  CURRENT_TIMESTAMP
FROM "User"
ON CONFLICT ("userId", "role") DO NOTHING;

-- Convert the already-frozen membership rows into the new position-history shape.
-- LEAD is a duty rather than a position, but a lead with a frontline secondary role
-- still receives a position row for that secondary role.
WITH membership_roles AS (
  SELECT
    membership."id" AS "membershipId",
    membership."userId",
    membership."groupId",
    membership."effectiveFrom",
    membership."effectiveTo",
    membership."reason",
    membership."createdById",
    membership."createdAt",
    role_item."roleName",
    role_item."sortOrder"
  FROM "UserGroupMembership" AS membership
  CROSS JOIN LATERAL (
    SELECT membership."role"::TEXT AS "roleName", 0::BIGINT AS "sortOrder"
    UNION ALL
    SELECT trim(value), ordinality
    FROM unnest(string_to_array(COALESCE(membership."secondaryRoles", ''), ',')) WITH ORDINALITY AS secondary(value, ordinality)
    WHERE trim(value) <> ''
  ) AS role_item
  WHERE role_item."roleName" IN ('RECEPTION', 'GROUP_OPERATOR', 'EXPERT')
), ranked_roles AS (
  SELECT
    membership_roles.*,
    row_number() OVER (
      PARTITION BY "userId", "effectiveFrom"
      ORDER BY "sortOrder", "roleName"
    ) AS "roleRank"
  FROM membership_roles
), position_rows AS (
  SELECT
    "membershipId",
    "userId",
    "groupId",
    "effectiveFrom",
    "effectiveTo",
    "reason",
    "createdById",
    "createdAt",
    max("roleName") FILTER (WHERE "roleRank" = 1) AS "primaryPosition",
    string_agg("roleName", ',' ORDER BY "sortOrder", "roleName") FILTER (WHERE "roleRank" > 1) AS "secondaryPositions"
  FROM ranked_roles
  GROUP BY "membershipId", "userId", "groupId", "effectiveFrom", "effectiveTo", "reason", "createdById", "createdAt"
)
INSERT INTO "UserPosition" (
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
  'legacy-position-' || md5("membershipId"),
  "userId",
  "primaryPosition"::"Position",
  "secondaryPositions",
  "groupId",
  "effectiveFrom",
  "effectiveTo",
  COALESCE("reason", '系统升级自动建立岗位历史'),
  "createdById",
  "createdAt"
FROM position_rows
ON CONFLICT ("userId", "effectiveFrom") DO NOTHING;
