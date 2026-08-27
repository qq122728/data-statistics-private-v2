ALTER TABLE "User" ADD COLUMN "managementScopeName" TEXT;
ALTER TABLE "User" ADD COLUMN "managementCountryCode" TEXT;

CREATE INDEX "User_departmentId_managementCountryCode_idx"
ON "User"("departmentId", "managementCountryCode");
