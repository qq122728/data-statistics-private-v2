PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "Department" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

INSERT INTO "Department" ("id", "name", "active", "createdAt", "updatedAt")
VALUES ('default-department', '默认部门', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE "new_TeamGroup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "departmentId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "TeamGroup_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_TeamGroup" ("id", "name", "active", "departmentId", "createdAt", "updatedAt")
SELECT "id", "name", "active", 'default-department', "createdAt", "updatedAt" FROM "TeamGroup";

DROP TABLE "TeamGroup";
ALTER TABLE "new_TeamGroup" RENAME TO "TeamGroup";
CREATE UNIQUE INDEX "TeamGroup_departmentId_name_key" ON "TeamGroup"("departmentId", "name");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
