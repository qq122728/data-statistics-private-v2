-- 黑客组普通组员统一拥有接粉＋炒群权限；专家和组长保持原权限。
INSERT OR IGNORE INTO "UserRoleAssignment" ("id", "userId", "role", "createdAt")
SELECT
  'hacker-dual-operator-' || user."id",
  user."id",
  'GROUP_OPERATOR',
  CURRENT_TIMESTAMP
FROM "User" AS user
JOIN "TeamGroup" AS team_group ON team_group."id" = user."groupId"
WHERE team_group."groupType" = 'HACKER'
  AND user."role" = 'RECEPTION';

INSERT OR IGNORE INTO "UserRoleAssignment" ("id", "userId", "role", "createdAt")
SELECT
  'hacker-dual-reception-' || user."id",
  user."id",
  'RECEPTION',
  CURRENT_TIMESTAMP
FROM "User" AS user
JOIN "TeamGroup" AS team_group ON team_group."id" = user."groupId"
WHERE team_group."groupType" = 'HACKER'
  AND user."role" = 'GROUP_OPERATOR';

UPDATE "UserGroupMembership"
SET "secondaryRoles" = CASE
  WHEN "role" = 'RECEPTION' AND instr(',' || COALESCE("secondaryRoles", '') || ',', ',GROUP_OPERATOR,') = 0
    THEN CASE WHEN COALESCE("secondaryRoles", '') = '' THEN 'GROUP_OPERATOR' ELSE 'GROUP_OPERATOR,' || "secondaryRoles" END
  WHEN "role" = 'GROUP_OPERATOR' AND instr(',' || COALESCE("secondaryRoles", '') || ',', ',RECEPTION,') = 0
    THEN CASE WHEN COALESCE("secondaryRoles", '') = '' THEN 'RECEPTION' ELSE 'RECEPTION,' || "secondaryRoles" END
  ELSE "secondaryRoles"
END
WHERE "effectiveTo" IS NULL
  AND "role" IN ('RECEPTION', 'GROUP_OPERATOR')
  AND "groupId" IN (SELECT "id" FROM "TeamGroup" WHERE "groupType" = 'HACKER');

UPDATE "UserPosition"
SET "secondaryPositions" = CASE
  WHEN "position" = 'RECEPTION' AND instr(',' || COALESCE("secondaryPositions", '') || ',', ',GROUP_OPERATOR,') = 0
    THEN CASE WHEN COALESCE("secondaryPositions", '') = '' THEN 'GROUP_OPERATOR' ELSE 'GROUP_OPERATOR,' || "secondaryPositions" END
  WHEN "position" = 'GROUP_OPERATOR' AND instr(',' || COALESCE("secondaryPositions", '') || ',', ',RECEPTION,') = 0
    THEN CASE WHEN COALESCE("secondaryPositions", '') = '' THEN 'RECEPTION' ELSE 'RECEPTION,' || "secondaryPositions" END
  ELSE "secondaryPositions"
END
WHERE "effectiveTo" IS NULL
  AND "position" IN ('RECEPTION', 'GROUP_OPERATOR')
  AND "groupId" IN (SELECT "id" FROM "TeamGroup" WHERE "groupType" = 'HACKER');
