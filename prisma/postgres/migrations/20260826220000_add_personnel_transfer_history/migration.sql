ALTER TABLE "User" ADD COLUMN "employeeCode" TEXT;

UPDATE "User"
SET "employeeCode" = "username"
WHERE "employeeCode" IS NULL;

CREATE UNIQUE INDEX "User_employeeCode_key" ON "User"("employeeCode");

CREATE TABLE "UserGroupMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGroupMembership_pkey" PRIMARY KEY ("id")
);

INSERT INTO "UserGroupMembership" (
    "id", "userId", "groupId", "role", "effectiveFrom", "reason", "createdAt"
)
SELECT
    'membership-' || "id",
    "id",
    "groupId",
    "role",
    COALESCE("hireDate", to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
    '系统升级自动建立当前归属',
    CURRENT_TIMESTAMP
FROM "User"
WHERE "groupId" IS NOT NULL;

CREATE UNIQUE INDEX "UserGroupMembership_userId_effectiveFrom_key" ON "UserGroupMembership"("userId", "effectiveFrom");
CREATE INDEX "UserGroupMembership_groupId_effectiveFrom_effectiveTo_idx" ON "UserGroupMembership"("groupId", "effectiveFrom", "effectiveTo");
CREATE INDEX "UserGroupMembership_userId_effectiveTo_idx" ON "UserGroupMembership"("userId", "effectiveTo");

ALTER TABLE "UserGroupMembership" ADD CONSTRAINT "UserGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserGroupMembership" ADD CONSTRAINT "UserGroupMembership_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
