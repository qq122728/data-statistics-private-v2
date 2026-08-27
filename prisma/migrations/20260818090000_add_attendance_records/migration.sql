CREATE TABLE "AttendanceRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "businessDate" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "scheduledStartMinutes" INTEGER NOT NULL,
  "scheduledEndMinutes" INTEGER NOT NULL,
  "clockInAt" DATETIME,
  "clockOutAt" DATETIME,
  "clockInStatus" TEXT,
  "clockOutStatus" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AttendanceRecord_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AttendanceRecord_userId_businessDate_key" ON "AttendanceRecord"("userId", "businessDate");
CREATE INDEX "AttendanceRecord_groupId_businessDate_idx" ON "AttendanceRecord"("groupId", "businessDate");
CREATE INDEX "AttendanceRecord_businessDate_idx" ON "AttendanceRecord"("businessDate");
