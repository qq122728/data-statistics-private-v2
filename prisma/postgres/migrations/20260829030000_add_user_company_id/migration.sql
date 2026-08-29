ALTER TABLE "User" ADD COLUMN "companyId" TEXT;

CREATE INDEX "User_companyId_idx" ON "User"("companyId");

ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
