import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsDirectory = resolve(scriptDirectory, "../prisma/postgres/migrations");
export const defaultManifestPath = join(defaultMigrationsDirectory, "checksums.json");

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function migrationFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(entry.name, "migration.sql"))
    .filter((path) => existsSync(join(directory, path)))
    .sort();
}

export function verifyMigrationChecksums({
  migrationsDirectory = defaultMigrationsDirectory,
  manifestPath = defaultManifestPath,
} = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== 1 || manifest.algorithm !== "sha256" || !manifest.migrations) {
    throw new Error("PostgreSQL migration checksum manifest format is invalid.");
  }

  const expectedFiles = Object.keys(manifest.migrations).sort();
  const actualFiles = migrationFiles(migrationsDirectory);
  const missing = expectedFiles.filter((path) => !actualFiles.includes(path));
  const unrecorded = actualFiles.filter((path) => !expectedFiles.includes(path));
  const changed = expectedFiles
    .filter((path) => actualFiles.includes(path))
    .filter((path) => sha256(join(migrationsDirectory, path)) !== manifest.migrations[path]);

  if (missing.length || unrecorded.length || changed.length) {
    const details = [
      ...missing.map((path) => `missing: ${path}`),
      ...unrecorded.map((path) => `not in manifest: ${path}`),
      ...changed.map((path) => `content changed: ${path}`),
    ];
    throw new Error(`PostgreSQL migration immutability check failed:\n${details.join("\n")}`);
  }

  return { count: actualFiles.length, directory: relative(process.cwd(), migrationsDirectory) || "." };
}

function main() {
  try {
    const result = verifyMigrationChecksums();
    console.log(`Verified ${result.count} immutable PostgreSQL migrations.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
