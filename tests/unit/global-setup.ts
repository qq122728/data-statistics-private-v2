import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

export default async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "data-statistics-unit-"));
  const databasePath = join(directory, "test.db");
  closeSync(openSync(databasePath, "w"));
  const databaseUrl = `file:${databasePath}`;

  execFileSync(
    process.execPath,
    [join(process.cwd(), "node_modules/prisma/build/index.js"), "migrate", "deploy"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "ignore",
    },
  );

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await prisma.teamGroup.createMany({
    data: [
      { id: "group-a", name: "一组" },
      { id: "group-b", name: "二组" },
    ],
  });
  await prisma.user.createMany({
    data: [
      { id: "admin-1", username: "admin", name: "管理员", passwordHash: "test", role: "ADMIN" },
      { id: "lead-1", username: "lead", name: "组长", passwordHash: "test", role: "LEAD", groupId: "group-a" },
      { id: "member-1", username: "member", name: "前台接粉", passwordHash: "test", role: "RECEPTION", groupId: "group-a" },
    ],
  });
  await prisma.channel.createMany({
    data: [
      { id: "channel-1", name: "底料", normalizedName: "底料", groupId: "group-a" },
      { id: "channel-2", name: "抖音", normalizedName: "抖音", groupId: "group-b" },
    ],
  });
  await prisma.sourceBatch.createMany({
    data: [
      { id: "base-batch-a", groupId: "group-a", channelId: "channel-1", sourceDate: "2026-08-01" },
      { id: "base-batch-b", groupId: "group-b", channelId: "channel-2", sourceDate: "2026-08-01" },
    ],
  });
  await prisma.$disconnect();

  // Worker processes inherit this value, so src/lib/db never opens prisma/dev.db.
  process.env.DATABASE_URL = databaseUrl;

  return async () => {
    rmSync(directory, { recursive: true, force: true });
  };
}
