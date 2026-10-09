ALTER TABLE "User" ADD COLUMN "financeScopeConfigured" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "FinanceGroupAccess" (
  "userId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceGroupAccess_pkey" PRIMARY KEY ("userId", "groupId")
);

CREATE INDEX "FinanceGroupAccess_groupId_idx" ON "FinanceGroupAccess"("groupId");

ALTER TABLE "FinanceGroupAccess" ADD CONSTRAINT "FinanceGroupAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinanceGroupAccess" ADD CONSTRAINT "FinanceGroupAccess_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
