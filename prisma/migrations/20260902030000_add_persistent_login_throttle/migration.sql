CREATE TABLE "LoginThrottleBucket" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" DATETIME NOT NULL,
  "lockedUntil" DATETIME,
  "touchedAt" DATETIME NOT NULL,
  "auditUserId" TEXT,
  "auditTeamId" TEXT
);

CREATE INDEX "LoginThrottleBucket_touchedAt_idx" ON "LoginThrottleBucket"("touchedAt");
