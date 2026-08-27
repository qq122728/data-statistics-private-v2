#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const files = {
  config: "ops/dr-01/pgbackrest.conf.template",
  postgres: "ops/dr-01/postgresql-pitr.conf",
  runbook: "ops/dr-01/README.md",
  restore: "scripts/dr/restore-rehearsal.sh",
  health: "scripts/dr/pgbackrest-healthcheck.sh",
};

const content = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")])));
const units = [
  "data-statistics-pgbackrest-full.service",
  "data-statistics-pgbackrest-diff.service",
  "data-statistics-pgbackrest-check.service",
  "data-statistics-pgbackrest-verify.service",
  "data-statistics-restore-rehearsal.service",
];

function requireMatch(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(message);
}

const verifyUnit = await readFile("ops/dr-01/systemd/data-statistics-pgbackrest-verify.service", "utf8");
requireMatch(verifyUnit, /pgbackrest --stanza=data-statistics verify/, "repository checksum verification missing");
const checkUnit = await readFile("ops/dr-01/systemd/data-statistics-pgbackrest-check.service", "utf8");
const checkTimer = await readFile("ops/dr-01/systemd/data-statistics-pgbackrest-check.timer", "utf8");
const restoreUnit = await readFile("ops/dr-01/systemd/data-statistics-restore-rehearsal.service", "utf8");
const alertScript = await readFile("scripts/dr/send-dr-alert.sh", "utf8");
const renderer = await readFile("scripts/dr/render-pgbackrest-config.mjs", "utf8");
const tmpfiles = await readFile("ops/dr-01/tmpfiles.d/data-statistics-dr.conf", "utf8");
const restoreEnvExample = await readFile("ops/dr-01/restore-rehearsal.env.example", "utf8");
const migrationManifest = await readFile("ops/dr-01/migration-manifest.sha256", "utf8");
const healthValidator = await readFile("scripts/dr/validate-backup-health.py", "utf8");
const healthValidatorTest = await readFile("scripts/dr/test_validate_backup_health.py", "utf8");
const migrationValidator = await readFile("scripts/dr/validate-migration-ledger.py", "utf8");
const migrationValidatorTest = await readFile("scripts/dr/test_validate_migration_ledger.py", "utf8");
const cleanupLibrary = await readFile("scripts/dr/restore-cleanup.sh", "utf8");
const cleanupTest = await readFile("scripts/dr/test_restore_cleanup.sh", "utf8");
const pidfdStop = await readFile("scripts/dr/pidfd-stop-postgres.py", "utf8");
const evidenceArchiver = await readFile("scripts/dr/archive-restore-evidence.py", "utf8");
const workflow = await readFile(".github/workflows/verify.yml", "utf8");

for (const name of ["PGBACKREST_S3_KEY", "PGBACKREST_S3_KEY_SECRET", "PGBACKREST_REPO1_CIPHER_PASS"]) {
  requireMatch(content.config, new RegExp(`\\$\\{${name}\\}`), `missing ${name} placeholder`);
}
requireMatch(content.config, /repo1-type=s3/, "repository must be off-site S3-compatible storage");
requireMatch(content.config, /repo1-cipher-type=aes-256-cbc/, "repository encryption missing");
requireMatch(content.config, /repo1-retention-full=6/, "35-day full retention missing");
requireMatch(content.config, /repo1-retention-diff=36/, "35-day differential retention missing");
requireMatch(content.config, /expire-auto=n/, "database-host automatic expiration must be disabled");
requireMatch(content.config, /lock-path=\/var\/lock\/pgbackrest/, "shared lock path missing");
requireMatch(content.postgres, /archive_mode = on/, "WAL archive mode missing");
requireMatch(content.postgres, /archive-push %p/, "archive-push missing");
requireMatch(content.postgres, /archive_timeout = 300s/, "five-minute archive bound missing");
requireMatch(content.restore, /PORT != 5432/, "restore must reject production port");
requireMatch(content.restore, /\/var\/lib\/postgresql\/dr-rehearsal/, "restore root guard missing");
requireMatch(content.restore, /--type=time/, "point-in-time restore missing");
requireMatch(content.restore, /--type=immediate/, "independent full restore mode missing");
requireMatch(content.restore, /--set=/, "explicit restore backup set missing");
requireMatch(content.restore, /--target-timeline=/, "recovery timeline selection missing");
requireMatch(content.restore, /PG_CTL.*-o/, "command-line PostgreSQL isolation override missing");
requireMatch(content.restore, /isolationPassed/, "effective isolation validation missing");
requireMatch(content.restore, /"User"/, "critical User table check missing");
requireMatch(content.restore, /migrationCheckPassed/, "exact migration check missing");
requireMatch(migrationValidator, /checksumMismatches/, "production-ledger checksum/set comparison missing");
requireMatch(migrationValidator, /BASELINE_EXCEPTION_REASON = "trailing-newline-only"/, "strict DB-02 baseline newline exception missing");
requireMatch(migrationValidator, /repositoryManifestSha256/, "repository manifest evidence hash missing");
requireMatch(migrationValidator, /productionLedgerSha256/, "production ledger evidence hash missing");
requireMatch(content.restore, /timeout .*45m/, "pg_ctl start must have a timeout below the systemd RTO timeout");
requireMatch(cleanupLibrary, /python3 "\$pidfd_stop_helper"/, "exact pidfd PostgreSQL cleanup helper missing");
requireMatch(pidfdStop, /pidfd_send_signal/, "pidfd signal delivery missing");
requireMatch(pidfdStop, /signal\.SIGINT/, "PostgreSQL fast shutdown signal missing");
requireMatch(content.restore, /trap cleanup EXIT/, "cleanup must be registered before PostgreSQL startup");
requireMatch(cleanupLibrary, /\/proc\/\$postmaster_pid\/cmdline/, "cleanup PID ownership guard missing");
requireMatch(cleanupTest, /unrelated_cleanup_code/, "unrelated PID no-kill dynamic test missing");
requireMatch(cleanupTest, /forged_cleanup_code/, "forged non-PostgreSQL PID no-kill dynamic test missing");
requireMatch(cleanupLibrary, /process_session.*postmaster_pid/, "cleanup must verify the PostgreSQL session leader identity");
requireMatch(cleanupTest, /race_code/, "post-pidfd identity-change regression test missing");
requireMatch(content.restore, /flock -n 8/, "whole-rehearsal exclusive lock missing");
requireMatch(cleanupLibrary, /dr_assert_rehearsal_run_inactive/, "retention live-instance guard missing");
requireMatch(cleanupTest, /live_candidate_code/, "retention live-instance regression test missing");
requireMatch(restoreUnit, /^ExecStartPost=\+\/usr\/local\/lib\/data-statistics-dr\/archive-restore-evidence\.py$/m, "root evidence archiver missing");
requireMatch(evidenceArchiver, /dr-evidence/, "external protected evidence directory missing");
requireMatch(evidenceArchiver, /sha256/, "external evidence checksum missing");
requireMatch(workflow, /for file in scripts\/dr\/\*\.sh; do bash -n/, "Ubuntu CI bash syntax validation missing");
requireMatch(workflow, /systemd-analyze verify/, "Ubuntu CI systemd unit validation missing");
requireMatch(workflow, /test_restore_cleanup\.sh/, "Ubuntu CI cleanup dynamic test missing");
requireMatch(content.restore, /selectedBackupLabel/, "selected backup evidence missing");
requireMatch(content.restore, /selectedBackupTimelineId/, "selected backup timeline evidence missing");
for (const key of ["USERS", "GROUPS", "LEADS", "ORDERS"]) {
  requireMatch(content.restore, new RegExp(`DR_MIN_${key} > 0`), `critical-table baseline ${key} must be non-zero`);
}
requireMatch(content.health, /pgbackrest .* check/, "repository check missing");
requireMatch(content.health, /lastFailedTime/, "WAL failure ordering validation missing");
requireMatch(healthValidator, /last_failed > last_archived/, "WAL timestamps must be compared without second truncation");
requireMatch(healthValidatorTest, /failure_later_in_same_second_is_rejected/, "same-second WAL failure regression test missing");
requireMatch(content.health, /DR_DEADMAN_WEBHOOK_URL/, "external deadman heartbeat missing");
requireMatch(content.runbook, /not deployed/i, "runbook must not claim rollout completion");
requireMatch(content.runbook, /RPO target: 5 minutes/, "RPO target missing");
requireMatch(content.runbook, /RTO target: 60 minutes/, "RTO target missing");
requireMatch(checkTimer, /OnCalendar=\*:0\/5/, "WAL health timer must run every five minutes");
requireMatch(checkUnit, /TimeoutStartSec=10m/, "WAL health timeout missing");
requireMatch(restoreUnit, /TimeoutStartSec=60m/, "restore timeout must enforce the stated RTO target");
requireMatch(alertScript, /DR_ALERT_WEBHOOK_URL:\?/, "missing alert webhook must fail closed");
requireMatch(renderer, /CIPHER_PASS.*length < 32/, "repository cipher passphrase strength check missing");
requireMatch(tmpfiles, /\/var\/lib\/postgresql\/dr-rehearsal 0700 postgres postgres/, "rehearsal root tmpfiles rule missing");
requireMatch(tmpfiles, /\/var\/lib\/data-statistics\/dr-evidence 0700 root root/, "root-protected external evidence directory missing");
requireMatch(restoreUnit, /^EnvironmentFile=\/etc\/data-statistics\/dr-restore\.env$/m, "restore approval settings must come from a root-managed EnvironmentFile");
requireMatch(restoreUnit, /^Environment=DR_APPROVAL_ENV_FILE=\/etc\/data-statistics\/dr-restore\.env$/m, "runtime approval file ownership check path missing");
if (/^Environment=DR_MIN_/m.test(restoreUnit)) throw new Error("restore unit must not embed critical-table baseline defaults");
for (const key of ["USERS", "GROUPS", "LEADS", "ORDERS"]) {
  requireMatch(restoreEnvExample, new RegExp(`^DR_MIN_${key}=replace-with-approved-positive-count$`, "m"), `${key} baseline example must remain an explicit placeholder`);
}
requireMatch(restoreEnvExample, /^DR_BASELINE_APPROVAL_ID=replace-with-/m, "baseline approval evidence placeholder missing");
requireMatch(restoreEnvExample, /^DR_MIGRATION_LEDGER_APPROVAL_ID=replace-with-/m, "production ledger approval placeholder missing");
requireMatch(restoreUnit, /^LoadCredential=production-migration-ledger:\/etc\/data-statistics\/dr-production-migration-ledger\.json$/m, "root production ledger credential source missing");
requireMatch(restoreUnit, /^LoadCredential=baseline-checksum-approval:\/etc\/data-statistics\/dr-baseline-checksum-approval\.json$/m, "root baseline checksum approval credential source missing");
requireMatch(content.restore, /DR_BASELINE_APPROVAL_ID.*replace-with-/, "runtime baseline approval guard missing");
requireMatch(content.restore, /stat -c '%u:%a'.*DR_APPROVAL_ENV_FILE/, "runtime root/mode-0600 approval file check missing");
requireMatch(content.restore, /\/run\/credentials\/\*\/production-migration-ledger/, "runtime production ledger credential guard missing");
requireMatch(content.restore, /\/run\/credentials\/\*\/baseline-checksum-approval/, "runtime baseline checksum credential guard missing");
requireMatch(migrationValidator, /ledger\[BASELINE_MIGRATION\] != approved_baseline_checksum/, "baseline exception must pin the separately approved production checksum");
requireMatch(migrationValidatorTest, /arbitrary_baseline_checksum_cannot_use_the_newline_exception/, "wrong baseline checksum regression test missing");
requireMatch(content.restore, /DR_MIN_ORDERS <= 2147483647/, "runtime baseline reasonableness bound missing");

const migrationEntries = (await readdir("prisma/postgres/migrations", { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (!migrationEntries.length) throw new Error("no PostgreSQL migrations found");
if (migrationEntries.length !== 24 || migrationEntries.at(-1) !== "20260826233000_add_department_manager_scope") {
  throw new Error("DR-01 must be based on the approved 24-migration release containing department manager scope");
}
requireMatch(restoreEnvExample, new RegExp(`^DR_EXPECTED_MIGRATION_COUNT=${migrationEntries.length}$`, "m"), "restore migration count does not match repository");
requireMatch(restoreEnvExample, new RegExp(`^DR_EXPECTED_LATEST_MIGRATION=${migrationEntries.at(-1)}$`, "m"), "restore latest migration does not match repository");

const generatedManifest = (await Promise.all(migrationEntries.map(async (name) => {
  const sql = await readFile(`prisma/postgres/migrations/${name}/migration.sql`);
  return `${createHash("sha256").update(sql).digest("hex")} ${name}`;
}))).join("\n") + "\n";
if (migrationManifest !== generatedManifest) throw new Error("approved migration manifest names/checksums do not exactly match the repository");

const healthTest = spawnSync("python3", ["scripts/dr/test_validate_backup_health.py"], { encoding: "utf8" });
if (healthTest.status !== 0) {
  throw new Error(`backup health regression tests failed: ${healthTest.stdout}${healthTest.stderr}`);
}
const migrationTest = spawnSync("python3", ["scripts/dr/test_validate_migration_ledger.py"], { encoding: "utf8" });
if (migrationTest.status !== 0) {
  throw new Error(`migration ledger regression tests failed: ${migrationTest.stdout}${migrationTest.stderr}`);
}

for (const unit of units) {
  const value = await readFile(`ops/dr-01/systemd/${unit}`, "utf8");
  requireMatch(value, /OnFailure=data-statistics-dr-alert@%n\.service/, `${unit} has no failure alert`);
  requireMatch(value, /NoNewPrivileges=true/, `${unit} lacks hardening`);
}

for (const [unit, timeout] of [
  ["data-statistics-pgbackrest-full.service", "8h"],
  ["data-statistics-pgbackrest-diff.service", "4h"],
  ["data-statistics-pgbackrest-check.service", "10m"],
]) {
  const value = await readFile(`ops/dr-01/systemd/${unit}`, "utf8");
  requireMatch(value, new RegExp(`TimeoutStartSec=${timeout}`), `${unit} timeout missing`);
  if (/\bexpire(?:\s|$)/m.test(value)) throw new Error(`${unit} must not delete repository objects with the database-host identity`);
}

async function walk(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

const scannedPaths = [
  ...await walk("ops/dr-01"),
  ...await walk("scripts/dr"),
  ".github/workflows/verify.yml",
];
const all = (await Promise.all(scannedPaths.map(async (path) => `${path}\n${await readFile(path, "utf8")}`))).join("\n");

function approvedPlaceholderOrReference(value) {
  return value.startsWith("replace-with-")
    || /^\$\{[A-Z0-9_]+\}$/.test(value)
    || /^(?:secret|vault|sm|aws-secretsmanager):\/\/[A-Za-z0-9._/@:+-]+$/.test(value);
}

function approvedCiPostgresUrl(raw) {
  try {
    const parsed = new URL(raw);
    const approvedQueries = new Set([
      "?schema=public",
      "?schema=public&options=-c%20lock_timeout%3D10000%20-c%20statement_timeout%3D600000",
    ]);
    return parsed.protocol === "postgresql:"
      && parsed.hostname === "127.0.0.1"
      && parsed.port === "5432"
      && parsed.username === "migration_replay"
      && parsed.password === "ci_only_password"
      && parsed.pathname === "/migration_replay"
      && parsed.hash === ""
      && approvedQueries.has(parsed.search);
  } catch {
    return false;
  }
}

function assertNoCommittedSecrets(value) {
  for (const match of value.matchAll(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi)) {
    if (match[0].includes(":") && match[0].includes("@") && !approvedCiPostgresUrl(match[0])) {
      throw new Error("connection string with credentials detected");
    }
  }
  const privateKeyPattern = new RegExp("BEGIN " + "(?:(?:OPENSSH|RSA|EC) )?" + "PRIVATE KEY");
  if (privateKeyPattern.test(value)) throw new Error("private key detected");
  if (/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/.test(value)) throw new Error("AWS access key detected");
  if (/^\s*(?:AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN)\s*=\s*[^\s#]+/m.test(value)) throw new Error("AWS secret or session token detected");
  for (const match of value.matchAll(/^PGBACKREST_(?:S3_KEY|S3_KEY_SECRET|REPO1_CIPHER_PASS)=(.+)$/gm)) {
    if (!approvedPlaceholderOrReference(match[1])) throw new Error("real pgBackRest key/passphrase detected");
  }
  for (const match of value.matchAll(/^repo1-(?:s3-key|s3-key-secret|cipher-pass)=(.+)$/gm)) {
    if (!approvedPlaceholderOrReference(match[1])) throw new Error("rendered pgBackRest key/passphrase detected");
  }
}

assertNoCommittedSecrets(all);
const postgresScheme = ["postgres", "ql://"].join("");
assertNoCommittedSecrets(`${postgresScheme}migration_replay:ci_only_password@127.0.0.1:5432/migration_replay?schema=public`);
assertNoCommittedSecrets(`${postgresScheme}migration_replay:ci_only_password@127.0.0.1:5432/migration_replay?schema=public&options=-c%20lock_timeout%3D10000%20-c%20statement_timeout%3D600000`);
for (const rejectedUrl of [
  `${postgresScheme}migration_replay:not-the-ci-password@127.0.0.1:5432/migration_replay`,
  `${postgresScheme}migration_replay:ci_only_password@db.internal:5432/migration_replay`,
  `${postgresScheme}production:ci_only_password@127.0.0.1:5432/migration_replay`,
  `${postgresScheme}migration_replay:ci_only_password@127.0.0.1:5432/migration_replay?schema=public&sslpassword=hidden-secret`,
  `${postgresScheme}migration_replay:ci_only_password@127.0.0.1:5432/migration_replay?schema=public&arbitrary=value`,
  `${postgresScheme}migration_replay:ci_only_password@127.0.0.1:5432/migration_replay?schema=public&schema=public`,
  `${postgresScheme}migration_replay:ci_only_password@127.0.0.1:5432/migration_replay?schema=public#hidden-token`,
]) {
  let rejected = false;
  try {
    assertNoCommittedSecrets(rejectedUrl);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`connection-string scanner regression for ${rejectedUrl}`);
}
for (const prefix of [
  ["PGBACKREST", "S3", "KEY"].join("_"),
  ["repo1", "s3", "key"].join("-"),
]) {
  let rejected = false;
  try {
    assertNoCommittedSecrets(`${prefix}=custom-provider-access-id-123456`);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`generic access-id scanner regression for ${prefix}`);
}

process.stdout.write("DR-01 static validation passed\n");
