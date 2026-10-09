CREATE TABLE "SheetActionSequence" (
 "groupId" TEXT NOT NULL,
 "action" TEXT NOT NULL,
 "date" TEXT NOT NULL,
 "value" INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY ("groupId", "action", "date")
);
