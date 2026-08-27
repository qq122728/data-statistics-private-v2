ALTER TABLE "User" ADD COLUMN "departmentId" TEXT REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");
