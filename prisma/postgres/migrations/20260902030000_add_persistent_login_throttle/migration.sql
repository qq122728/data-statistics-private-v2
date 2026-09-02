CREATE TABLE "LoginThrottleBucket" (
  "key" TEXT NOT NULL,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "windowStartedAt" TIMESTAMP(3) NOT NULL,
  "lockedUntil" TIMESTAMP(3),
  "touchedAt" TIMESTAMP(3) NOT NULL,
  "auditUserId" TEXT,
  "auditTeamId" TEXT,
  CONSTRAINT "LoginThrottleBucket_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "LoginThrottleBucket_touchedAt_idx" ON "LoginThrottleBucket"("touchedAt");
