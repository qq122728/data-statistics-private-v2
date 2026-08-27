import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyMigrationChecksums } from "./verify-postgres-migration-checksums.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");

export function migrationDatabaseUrl(databaseUrl, environment = process.env) {
  if (!databaseUrl) {
    throw new Error("MIGRATION_DATABASE_URL is required for PostgreSQL migrations.");
  }

  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("PostgreSQL migrations require a postgresql:// or postgres:// DATABASE_URL.");
  }

  const lockTimeout = timeoutFromEnvironment("MIGRATION_LOCK_TIMEOUT_MS", 10_000, environment);
  const statementTimeout = timeoutFromEnvironment("MIGRATION_STATEMENT_TIMEOUT_MS", 600_000, environment);
  const existingOptions = url.searchParams.get("options")?.trim();
  const safetyOptions = `-c lock_timeout=${lockTimeout} -c statement_timeout=${statementTimeout}`;
  url.searchParams.set("options", existingOptions ? `${existingOptions} ${safetyOptions}` : safetyOptions);
  return url.toString();
}

function timeoutFromEnvironment(name, fallback, environment) {
  const raw = environment[name] ?? String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 3_600_000) {
    throw new Error(`${name} must be an integer from 1 to 3600000 milliseconds.`);
  }
  return Number(raw);
}

export function deployPostgresMigrations({ environment = process.env, spawn = spawnSync } = {}) {
  verifyMigrationChecksums();
  if (!environment.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to verify the separate runtime account.");
  }
  const migrationUrl = migrationDatabaseUrl(environment.MIGRATION_DATABASE_URL, environment);
  const migrationScript = resolve(projectRoot, "scripts/run-postgres-migrations.sh");
  const result = spawn("bash", [migrationScript], {
    cwd: projectRoot,
    env: { ...environment, MIGRATION_DATABASE_URL: migrationUrl },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  try {
    process.exitCode = deployPostgresMigrations();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
