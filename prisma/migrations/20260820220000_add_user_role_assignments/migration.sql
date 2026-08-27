CREATE TABLE "UserRoleAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserRoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 旧账号全部保留原主岗位，迁移后行为不变；以后只把额外岗位写入此表。
INSERT INTO "UserRoleAssignment" ("id", "userId", "role", "createdAt")
SELECT 'primary-role-' || "id", "id", "role", CURRENT_TIMESTAMP
FROM "User";

CREATE UNIQUE INDEX "UserRoleAssignment_userId_role_key" ON "UserRoleAssignment"("userId", "role");
CREATE INDEX "UserRoleAssignment_role_idx" ON "UserRoleAssignment"("role");
