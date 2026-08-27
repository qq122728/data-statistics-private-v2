import { spawnSync } from "node:child_process";
import { join } from "node:path";

const projectRoot = process.cwd();
const databaseUrl = process.env.SQLITE_DATABASE_URL?.trim() || "file:./dev.db";
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
  });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

const checkExitCode = run(process.execPath, [join(projectRoot, "scripts/check-lead-phone-duplicates.mjs")]);
if (checkExitCode !== 0) process.exit(checkExitCode);

const prismaExecutable = join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma",
);
const migrationExitCode = run(prismaExecutable, [
  "migrate",
  "deploy",
  "--schema",
  "prisma/schema.prisma",
]);
process.exit(migrationExitCode);
