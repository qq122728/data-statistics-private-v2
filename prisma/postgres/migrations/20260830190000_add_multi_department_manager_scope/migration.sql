CREATE TABLE "UserManagedDepartment" (
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    CONSTRAINT "UserManagedDepartment_pkey" PRIMARY KEY ("userId", "departmentId"),
    CONSTRAINT "UserManagedDepartment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserManagedDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "UserManagedDepartment_departmentId_idx" ON "UserManagedDepartment"("departmentId");

INSERT INTO "UserManagedDepartment" ("userId", "departmentId")
SELECT "id", "departmentId"
FROM "User"
WHERE "duty" = 'DEPARTMENT_MANAGER' AND "departmentId" IS NOT NULL
ON CONFLICT ("userId", "departmentId") DO NOTHING;
