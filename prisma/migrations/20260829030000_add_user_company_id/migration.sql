-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeCode" TEXT,
    "username" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT NOT NULL,
    "duty" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "groupId" TEXT,
    "departmentId" TEXT,
    "companyId" TEXT,
    "managementScopeName" TEXT,
    "managementCountryCode" TEXT,
    "hireDate" TEXT,
    "recruitmentSource" TEXT,
    "referrerName" TEXT,
    "stageOverride" TEXT,
    "stageOverrideReason" TEXT,
    "stageOverrideAt" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("active", "createdAt", "departmentId", "duty", "employeeCode", "groupId", "hireDate", "id", "lastLoginAt", "managementCountryCode", "managementScopeName", "mustChangePassword", "name", "passwordHash", "recruitmentSource", "referrerName", "role", "stageOverride", "stageOverrideAt", "stageOverrideReason", "updatedAt", "username") SELECT "active", "createdAt", "departmentId", "duty", "employeeCode", "groupId", "hireDate", "id", "lastLoginAt", "managementCountryCode", "managementScopeName", "mustChangePassword", "name", "passwordHash", "recruitmentSource", "referrerName", "role", "stageOverride", "stageOverrideAt", "stageOverrideReason", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_employeeCode_key" ON "User"("employeeCode");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");
CREATE INDEX "User_departmentId_managementCountryCode_idx" ON "User"("departmentId", "managementCountryCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");
