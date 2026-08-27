ALTER TABLE "UserGroupMembership" ADD COLUMN "secondaryRoles" TEXT;

UPDATE "UserGroupMembership"
SET "secondaryRoles" = (
    SELECT group_concat("role", ',')
    FROM "UserRoleAssignment"
    WHERE "userId" = "UserGroupMembership"."userId"
      AND "role" <> "UserGroupMembership"."role"
)
WHERE "effectiveTo" IS NULL;
