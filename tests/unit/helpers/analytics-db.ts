import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const execFile = promisify(execFileCallback);

export type AnalyticsMemberSeed = {
  id: string;
  name: string;
  role?: "LEAD" | "RECEPTION";
  hireDate?: string | null;
  stageOverride?: "TRAINING" | "OBSERVATION" | "FORMAL" | "PAUSED" | null;
};

export type AnalyticsChannelSeed = {
  id: string;
  name: string;
  effectiveFanPriceCents?: number | null;
};

type AnalyticsTestDatabaseOptions = {
  members?: AnalyticsMemberSeed[];
  channels?: AnalyticsChannelSeed[];
};

export async function createAnalyticsTestDatabase(prefix: string, options: AnalyticsTestDatabaseOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const databasePath = join(directory, "test.db");
  const databaseUrl = `file:${databasePath}`;
  await execFile("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await prisma.user.createMany({
    data: options.members?.map((member) => ({
      id: member.id,
      username: member.id,
      name: member.name,
      passwordHash: "test",
      role: member.role ?? "RECEPTION",
      groupId: "group-a",
      hireDate: member.hireDate ?? null,
      stageOverride: member.stageOverride ?? null,
    })) ?? [],
  });
  await prisma.channel.createMany({
    data: options.channels?.map((channel) => ({
      id: channel.id,
      name: channel.name,
      normalizedName: channel.name.trim().toLocaleLowerCase(),
      groupId: "group-a",
      effectiveFanPriceCents: channel.effectiveFanPriceCents ?? null,
    })) ?? [],
  });
  await prisma.$disconnect();
  return {
    databaseUrl,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}
