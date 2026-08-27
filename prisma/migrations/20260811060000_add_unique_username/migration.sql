ALTER TABLE "User" ADD COLUMN "username" TEXT NOT NULL DEFAULT '';
UPDATE "User" SET "username" = "id" WHERE "username" = '';
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
