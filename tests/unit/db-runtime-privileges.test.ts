import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("DB-01 PostgreSQL role separation", () => {
  const stage = read("ops/database/db-01/02-stage-cutover.sql");
  const finalize = read("ops/database/db-01/03-finalize-cutover.sql");
  const verifier = read("ops/database/db-01/verify-db-privileges.sh");
  const migrationRunner = read("scripts/run-postgres-migrations.sh");

  it("gives the runtime role DML and sequence use without ownership or DDL privileges", () => {
    expect(stage).toContain("REASSIGN OWNED BY data_statistics TO data_statistics_migrator");
    expect(stage).toContain("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    expect(stage).not.toContain("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
    expect(stage).toContain("REVOKE ALL ON SCHEMA public FROM data_statistics_runtime");
    expect(stage).toContain("GRANT USAGE ON SCHEMA public TO data_statistics_runtime");
    expect(stage).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO data_statistics_runtime");
    expect(stage).toContain("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO data_statistics_runtime");
    expect(stage).not.toMatch(/GRANT\s+(?:ALL|CREATE|TRUNCATE).*data_statistics_runtime/i);
    expect(stage).toContain("REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM data_statistics_runtime");
  });

  it("does not automatically expose future internal objects to the website", () => {
    expect(stage).toContain("ALTER DEFAULT PRIVILEGES FOR ROLE data_statistics_migrator IN SCHEMA public");
    expect(stage).toContain("REVOKE ALL PRIVILEGES ON TABLES FROM data_statistics_runtime");
    expect(stage).toContain("REVOKE ALL PRIVILEGES ON SEQUENCES FROM data_statistics_runtime");
    expect(stage).not.toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO data_statistics_runtime");
    expect(stage).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE data_statistics_migrator\n  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
    );
    expect(stage).toContain("REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC");
  });

  it("clears every explicit legacy grant before adding transitional DML", () => {
    expect(stage).toContain("REVOKE ALL ON DATABASE data_statistics FROM data_statistics");
    expect(stage).toContain("REVOKE ALL ON SCHEMA public FROM data_statistics");
    expect(stage).toContain("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM data_statistics");
    expect(stage).toContain("REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM data_statistics");
    expect(stage).toContain("REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM data_statistics");
  });

  it("disables the legacy database role after the health-checked cutover", () => {
    expect(finalize).toContain("ALTER ROLE data_statistics NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  });

  it("verifies allowed DML and rejects CREATE, ALTER, TRUNCATE, and DROP", () => {
    for (const operation of ["INSERT INTO", "SELECT id", "UPDATE public", "DELETE FROM"]) {
      expect(verifier).toContain(operation);
    }
    expect(verifier).toContain("expect_create_denied");
    for (const operation of ["ALTER TABLE", "TRUNCATE TABLE", "DROP TABLE"]) {
      expect(verifier).toContain(`expect_denied \"${operation}\"`);
    }
    expect(verifier).toContain("JOIN pg_roles granted ON granted.oid = m.roleid");
    expect(verifier).toContain("SQLSTATE 42501");
    expect(verifier).toContain("current_oid <> ${expected_oid}::oid");
    expect(verifier).toContain("pg_get_userbyid(c.relowner) = '${expected_owner}'");
    expect(verifier).toContain("LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE");
    expect(verifier).not.toContain("DROP TABLE IF EXISTS public.db01_runtime_must_not_exist");
  });

  it("checks every required privilege separately and protects migration history", () => {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(verifier).toContain(`table_name), '${privilege}')`);
    }
    for (const privilege of ["USAGE", "SELECT"]) {
      expect(verifier).toContain(`sequence_name), '${privilege}')`);
    }
    expect(verifier).toContain("website or legacy role can access Prisma migration history");
    expect(verifier).toContain("future migrator functions are executable by PUBLIC");
  });

  it("requires explicit stage/final verification and proves the legacy role is disabled", () => {
    expect(verifier).toContain('"$phase" != "stage" && "$phase" != "final"');
    expect(verifier).toContain("checking transitional legacy-account access");
    expect(verifier).toContain("checking finalized legacy-account removal");
    expect(verifier).toContain("rolname = 'data_statistics' AND NOT rolcanlogin");
    expect(verifier).toContain("legacy role still has database or schema privileges");
    expect(verifier).toContain("legacy role still owns or can access a public relation");
    expect(verifier).toContain("legacy role still owns or can execute a public function");
    expect(verifier).toContain("PUBLIC still has access to the public schema");
    expect(verifier).toContain("PUBLIC still has database privileges");
  });

  it("requires the named, separate runtime and migration accounts", () => {
    expect(migrationRunner).toContain('decodeURIComponent(runtime.username) !== "data_statistics_runtime"');
    expect(migrationRunner).toContain('decodeURIComponent(migrator.username) !== "data_statistics_migrator"');
    expect(migrationRunner).not.toMatch(/echo.*(?:DATABASE_URL|MIGRATION_DATABASE_URL).*\$/);
  });
});
