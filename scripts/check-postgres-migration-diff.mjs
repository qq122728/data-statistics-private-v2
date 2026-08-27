import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const migrationsPrefix = "prisma/postgres/migrations/";

export function forbiddenMigrationChanges(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const [status, ...paths] = line.split(/\s+/);
      if (status === "A") return false;
      return paths.some((path) => path.startsWith(migrationsPrefix) && path.endsWith("/migration.sql"));
    });
}

export function checkMigrationDiff(baseRef, { spawn = spawnSync } = {}) {
  if (!baseRef) throw new Error("A trusted base Git ref is required.");
  const result = spawn("git", [
    "diff",
    "--name-status",
    "--find-renames",
    `${baseRef}...HEAD`,
    "--",
    `${migrationsPrefix}*/migration.sql`,
  ], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr?.trim() || "Unable to compare PostgreSQL migrations.");

  const forbidden = forbiddenMigrationChanges(result.stdout ?? "");
  if (forbidden.length) {
    throw new Error(`Existing PostgreSQL migrations are immutable:\n${forbidden.join("\n")}`);
  }
  return true;
}

function main() {
  try {
    const baseRef = process.argv[2] || process.env.MIGRATION_DIFF_BASE;
    checkMigrationDiff(baseRef);
    console.log(`No existing PostgreSQL migration changed relative to ${baseRef}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
