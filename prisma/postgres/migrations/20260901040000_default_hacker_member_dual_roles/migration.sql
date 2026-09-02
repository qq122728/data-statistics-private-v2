-- 黑客组普通组员统一拥有接粉＋炒群权限；专家和组长保持原权限。
INSERT INTO "UserRoleAssignment" ("id", "userId", "role", "createdAt")
SELECT
  'hacker-dual-operator-' || md5(account."id"),
  account."id",
  'GROUP_OPERATOR'::"Role",
  CURRENT_TIMESTAMP
FROM "User" AS account
JOIN "TeamGroup" AS team_group ON team_group."id" = account."groupId"
WHERE team_group."groupType" = 'HACKER'
  AND account."role" = 'RECEPTION'
ON CONFLICT ("userId", "role") DO NOTHING;

INSERT INTO "UserRoleAssignment" ("id", "userId", "role", "createdAt")
SELECT
  'hacker-dual-reception-' || md5(account."id"),
  account."id",
  'RECEPTION'::"Role",
  CURRENT_TIMESTAMP
FROM "User" AS account
JOIN "TeamGroup" AS team_group ON team_group."id" = account."groupId"
WHERE team_group."groupType" = 'HACKER'
  AND account."role" = 'GROUP_OPERATOR'
ON CONFLICT ("userId", "role") DO NOTHING;

UPDATE "UserGroupMembership" AS membership
SET "secondaryRoles" = CASE
  WHEN membership."role" = 'RECEPTION'
    AND position('GROUP_OPERATOR' IN COALESCE(membership."secondaryRoles", '')) = 0
    THEN concat_ws(',', 'GROUP_OPERATOR', NULLIF(membership."secondaryRoles", ''))
  WHEN membership."role" = 'GROUP_OPERATOR'
    AND position('RECEPTION' IN COALESCE(membership."secondaryRoles", '')) = 0
    THEN concat_ws(',', 'RECEPTION', NULLIF(membership."secondaryRoles", ''))
  ELSE membership."secondaryRoles"
END
FROM "TeamGroup" AS team_group
WHERE team_group."id" = membership."groupId"
  AND team_group."groupType" = 'HACKER'
  AND membership."effectiveTo" IS NULL
  AND membership."role" IN ('RECEPTION', 'GROUP_OPERATOR');

UPDATE "UserPosition" AS position_history
SET "secondaryPositions" = CASE
  WHEN position_history."position" = 'RECEPTION'
    AND position('GROUP_OPERATOR' IN COALESCE(position_history."secondaryPositions", '')) = 0
    THEN concat_ws(',', 'GROUP_OPERATOR', NULLIF(position_history."secondaryPositions", ''))
  WHEN position_history."position" = 'GROUP_OPERATOR'
    AND position('RECEPTION' IN COALESCE(position_history."secondaryPositions", '')) = 0
    THEN concat_ws(',', 'RECEPTION', NULLIF(position_history."secondaryPositions", ''))
  ELSE position_history."secondaryPositions"
END
FROM "TeamGroup" AS team_group
WHERE team_group."id" = position_history."groupId"
  AND team_group."groupType" = 'HACKER'
  AND position_history."effectiveTo" IS NULL
  AND position_history."position" IN ('RECEPTION', 'GROUP_OPERATOR');
