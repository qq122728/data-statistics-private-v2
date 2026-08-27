import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const skippedDirectories = new Set([
  ".git",
  ".next",
  ".next-e2e",
  ".worktrees",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function shouldCopyIntoE2EWorkspace(sourceRoot, sourcePath) {
  if (skippedDirectories.has(basename(sourcePath))) return false;
  return sourcePath !== join(sourceRoot, "prisma", "dev.db")
    && sourcePath !== join(sourceRoot, "prisma", "dev.db-journal")
    && sourcePath !== join(sourceRoot, "prisma", "dev.db-wal")
    && sourcePath !== join(sourceRoot, "prisma", "dev.db-shm");
}

export async function prepareE2EWorkspace(sourceRoot) {
  const workspacePath = await mkdtemp(join(tmpdir(), "data-statistics-e2e-"));
  await cp(sourceRoot, workspacePath, {
    recursive: true,
    filter: (sourcePath) => shouldCopyIntoE2EWorkspace(sourceRoot, sourcePath),
  });
  await symlink(join(sourceRoot, "node_modules"), join(workspacePath, "node_modules"), "dir");

  return {
    workspacePath,
    cleanup: () => rm(workspacePath, { recursive: true, force: true }),
  };
}

export function nextDevArguments(port) {
  return ["dev", "--webpack", "--hostname", "127.0.0.1", "--port", port];
}

async function startE2EServer() {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { workspacePath, cleanup } = await prepareE2EWorkspace(sourceRoot);
  const nextCli = join(sourceRoot, "node_modules", "next", "dist", "bin", "next");
  const prismaCli = join(sourceRoot, "node_modules", "prisma", "build", "index.js");
  await writeFile(join(workspacePath, "prisma", "dev.db"), "");
  const databaseEnvironment = {
    ...process.env,
    DATABASE_URL: `file:${join(workspacePath, "prisma", "dev.db")}`,
    ALLOW_DEVELOPMENT_SEED: "YES",
  };
  for (const argumentsList of [["migrate", "deploy"], ["db", "seed"]]) {
    const command = spawn(process.execPath, [prismaCli, ...argumentsList], {
      cwd: workspacePath,
      env: databaseEnvironment,
      stdio: "inherit",
    });
    const exitCode = await new Promise((resolveExit, rejectExit) => {
      command.once("error", rejectExit);
      command.once("exit", resolveExit);
    });
    if (exitCode !== 0) {
      await cleanup();
      throw new Error(`E2E database setup failed: prisma ${argumentsList.join(" ")}`);
    }
  }
  const server = spawn(process.execPath, [nextCli, ...nextDevArguments(process.env.E2E_PORT ?? "3011")], {
    cwd: workspacePath,
    env: { ...databaseEnvironment, NEXT_DIST_DIR: ".next-e2e" },
    stdio: "inherit",
  });

  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    server.kill(signal);
  };

  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  server.once("error", async (error) => {
    await cleanup();
    throw error;
  });
  server.once("exit", async (code) => {
    await cleanup();
    process.exit(code ?? 1);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startE2EServer();
}
