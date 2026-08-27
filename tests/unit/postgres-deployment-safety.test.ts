import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const postgresSchema = readFileSync("prisma/postgres/schema.prisma", "utf8");
const readme = readFileSync("README.md", "utf8");
const verifyWorkflow = readFileSync(".github/workflows/verify.yml", "utf8");
const dbPrivilegeIntegration = readFileSync("tests/integration/db-runtime-privileges-postgres.sh", "utf8");
const migrationWrapper = readFileSync("scripts/deploy-postgres-migrations.mjs", "utf8");
const separatedAccountWrapper = readFileSync("scripts/run-postgres-migrations.sh", "utf8");

describe("PostgreSQL production deployment safety", () => {
  it("keeps a dedicated PostgreSQL migration client and deploys with a PostgreSQL client before building", () => {
    expect(postgresSchema).toContain('generator migrationClient {\n  provider = "prisma-client-js"\n  output   = "../../node_modules/.prisma/postgres-migration-client"\n}');
    expect(packageJson.scripts["deploy:postgres"]).toBe("npm run db:generate:postgres && npm run db:migrate:postgres && npm run build");
    expect(packageJson.scripts["db:migrate:postgres"]).toBe("node scripts/deploy-postgres-migrations.mjs");
    expect(migrationWrapper).toContain('resolve(projectRoot, "scripts/run-postgres-migrations.sh")');
    expect(separatedAccountWrapper).toContain('MIGRATION_DATABASE_URL is required');
    expect(separatedAccountWrapper).toContain('DATABASE_URL must use the data_statistics_runtime account');
    expect(separatedAccountWrapper).toContain('MIGRATION_DATABASE_URL must use the data_statistics_migrator account');
    expect(readme).toContain("npm run deploy:postgres");
  });

  it("replays DB-01 against a real PostgreSQL container in CI", () => {
    expect(packageJson.scripts["test:db-runtime-privileges:postgres"]).toBe(
      "bash tests/integration/db-runtime-privileges-postgres.sh",
    );
    expect(verifyWorkflow).toContain("npm run test:db-runtime-privileges:postgres");
    expect(dbPrivilegeIntegration).toContain("postgres:17");
    expect(dbPrivilegeIntegration).toContain("SELECT 1 FROM pg_database WHERE datname = 'data_statistics'");
    expect(dbPrivilegeIntegration).toContain("prisma migrate deploy");
    expect(dbPrivilegeIntegration).toContain("verify-db-privileges.sh data_statistics --phase stage");
    expect(dbPrivilegeIntegration).toContain("verify-db-privileges.sh data_statistics --phase final");
  });
});
