ALTER TABLE "UserGroupMembership" ADD COLUMN "secondaryRoles" TEXT;

UPDATE "UserGroupMembership"
SET "secondaryRoles" = (
    SELECT string_agg("role"::text, ',' ORDER BY "role"::text)
    FROM "UserRoleAssignment"
    WHERE "userId" = "UserGroupMembership"."userId"
      AND "role" <> "UserGroupMembership"."role"
)
WHERE "effectiveTo" IS NULL;
