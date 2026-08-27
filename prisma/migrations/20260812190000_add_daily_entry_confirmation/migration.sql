CREATE TABLE "DailyEntryConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "businessDate" TEXT NOT NULL,
    "confirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyEntryConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DailyEntryConfirmation_userId_businessDate_key" ON "DailyEntryConfirmation"("userId", "businessDate");
CREATE INDEX "DailyEntryConfirmation_businessDate_idx" ON "DailyEntryConfirmation"("businessDate");
