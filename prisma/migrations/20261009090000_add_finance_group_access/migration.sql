ALTER TABLE "User" ADD COLUMN "financeScopeConfigured" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "FinanceGroupAccess" (
  "userId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "groupId"),
  CONSTRAINT "FinanceGroupAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FinanceGroupAccess_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "FinanceGroupAccess_groupId_idx" ON "FinanceGroupAccess"("groupId");
