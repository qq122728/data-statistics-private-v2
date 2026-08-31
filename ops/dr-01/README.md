# DR-01: PostgreSQL PITR rollout and recovery runbook

Status: reviewable implementation package; **not deployed and no real restore rehearsal has been claimed**.

Owners:

- Primary: DBA/on-call database owner (name must be filled in before production rollout).
- Secondary: operations on-call (name must be filled in before production rollout).
- Business recovery decision: application owner (name must be filled in before production rollout).

Targets:

- RPO target: 5 minutes. `archive_timeout=300s` bounds a quiet database; the
  repository/WAL check runs every five minutes with at most 30 seconds of
  jitter, and an external deadman must alert if two heartbeats are missed.
- RTO target: 60 minutes from declared recovery to validated isolated database. This remains a target until a timed rehearsal measures it.
- Repository retention: 6 weekly full backups, 36 daily differential backups,
  and WAL required by those full backups. The off-site provider must enforce at
  least 35 days of immutable/versioned retention.

## Safety boundaries

- Production application and PostgreSQL configuration remain unchanged until the reviewed rollout steps are performed.
- Never paste a connection string, storage key, cipher passphrase, or restored customer row into a ticket or rehearsal record.
- The object repository must be in a separate account/project with server-side encryption, versioning or object lock, access logging, and capacity alerts.
- The database host credential needs only list/read/write access to the
  dedicated prefix for backup, check, verify, and restore. It must not have
  bucket administration, retention changes, or deletion of protected object
  versions. `expire-auto=n` prevents pgBackRest from trying to delete with this
  identity. Keep every deletion-capable credential off the database host.
- Run pgBackRest `expire` from a separately controlled off-host retention job
  using a dedicated deletion identity and the same reviewed retention settings.
  That identity must be restricted to the one repository prefix and unable to
  change bucket policy, versioning, object lock, or the database host. Schedule
  it after the weekly full backup; alert on failure and repository capacity.
  The six-week counts intentionally put normal expiration beyond the 35-day
  immutable window.
- Keep the existing daily encrypted logical dump during the migration and for at least two successful PITR rehearsals. It is defense in depth, not a substitute for WAL/PITR.

## Reviewed production rollout

All commands below require an approved change window. Take no action directly from an unreviewed branch.

1. Create the independent object-store bucket/prefix and its least-privilege
   database-host service identity (list/read/write only, no object deletion).
   Create the separate off-host retention identity described above. Record
   provider screenshots or policy exports in the restricted operations evidence
   store, not Git.
2. Install the Ubuntu pgBackRest package and record the exact installed version. The 2026-08-25 inventory found no pgBackRest binary.
3. Copy `pgbackrest.env.example` to a root-only temporary secret source, replace every placeholder through the secret manager, then render without printing values:

   ```sh
   install -d -o root -g postgres -m 0750 /etc/pgbackrest
   node scripts/dr/render-pgbackrest-config.mjs /restricted/pgbackrest.env ops/dr-01/pgbackrest.conf.template /etc/pgbackrest/pgbackrest.conf
   chown root:postgres /etc/pgbackrest/pgbackrest.conf
   chmod 0640 /etc/pgbackrest/pgbackrest.conf
   ```

4. Create `/var/log/pgbackrest`, `/var/spool/pgbackrest`, and
   `/var/lock/pgbackrest` owned by `postgres:postgres`, mode `0750`. Install
   `tmpfiles.d/data-statistics-dr.conf` and run
   `systemd-tmpfiles --create data-statistics-dr.conf`; verify
   `/var/lib/postgresql/dr-rehearsal` is a real directory owned by
   `postgres:postgres`, mode `0700`, and not a symlink. The shared lock path
   prevents backup, verification, and restore jobs from racing despite systemd
   private temporary directories. Install the runtime shell/Python files from
   `scripts/dr` into `/usr/local/lib/data-statistics-dr`, owned by root and not
   writable by postgres.
5. Run `sudo -u postgres pgbackrest --stanza=data-statistics stanza-create`, then `check`. Stop if either fails.
6. Install `postgresql-pitr.conf` into the PostgreSQL 16 `conf.d` directory. Confirm `wal_level` remains `replica`. `archive_mode` requires a PostgreSQL restart; use a maintenance window and verify application health immediately afterward.
7. After restart verify, without exposing repository details:

   ```sh
   sudo -u postgres psql -XAtqc "show archive_mode; show archive_timeout" postgres
   sudo -u postgres pgbackrest --stanza=data-statistics check
   sudo -u postgres psql -XAtqc "select archived_count,failed_count,last_archived_time is not null from pg_stat_archiver" postgres
   ```

8. Run an initial full backup: `sudo -u postgres pgbackrest --stanza=data-statistics --type=full backup`. Run `info` and the health-check script. Confirm the provider shows encrypted objects in the independent location. Verify the database-host identity cannot delete a test object in the dedicated prefix, then verify the off-host retention job can expire only eligible pgBackRest objects after the immutable window.
9. Install `restore-cleanup.sh`, `pidfd-stop-postgres.py`, and
   `archive-restore-evidence.py` root-owned and not group/world writable under
   `/usr/local/lib/data-statistics-dr/`. Apply the supplied tmpfiles rule to
   pre-create the rehearsal root as `postgres:postgres 0700` and the external
   evidence directory `/var/lib/data-statistics/dr-evidence` as `root:root 0700`.
   The systemd unit runs the restore as postgres, then uses its reviewed `+`
   `ExecStartPost` helper as root to atomically archive a passed `result.json`
   and matching SHA-256 outside the rotating rehearsal tree. Evidence files are
   root-owned mode `0600`, immutable by name, and are never removed by rehearsal
   retention.
10. Treat migration evidence as three separate, immutable inputs. The committed
   `migration-manifest.sha256` is the **repository manifest**: CI regenerates it
   from all 48 `migration.sql` files and fails on any name or SHA-256 change.
   Install it as
   `/usr/local/share/data-statistics-dr/migration-manifest.sha256`, owned by
   root, mode `0644`, and not writable by postgres. Install
   `ops/database/db-01/export-production-migration-ledger.py` as root-owned mode
   `0755` at `/usr/local/sbin/data-statistics-export-migration-ledger`, then use
   the reviewed command in `ops/database/db-01/README.md` on the database host.
   The exporter uses only the fixed local PostgreSQL socket, checks all 17
   names/states/checksums against this manifest, and atomically writes
   `/etc/data-statistics/dr-production-migration-ledger.json` as root-owned mode
   `0600`, with schema keys `version`, `algorithm`, `approvalId`, `exceptions`,
   and `migrations`. It accepts no connection URL or password and does not print
   psql output. Never commit this production ledger and never rewrite it during
   a restore to make a check pass.

   In that JSON, `migrations` is an object keyed by the exact database
   `migration_name`, with the actual 64-character lowercase database checksum
   as its value. If the known baseline differs, `exceptions` must contain
   exactly one object with `migrationName` set to
   `20260818150000_postgres_baseline`, `reason` set to
   `trailing-newline-only`, and a non-placeholder restricted `evidenceId`.
   No wildcard, alternate reason, second exception, or repository checksum may
   be substituted for the production value.

   The DBA must independently approve the one observed production checksum in
   `/etc/data-statistics/dr-baseline-checksum-approval.json`, root-owned mode
   `0600`, never committed. It has this strict schema; every placeholder must
   be replaced from restricted production evidence, never guessed:

   ```json
   {"version":1,"algorithm":"sha256","migrationName":"20260818150000_postgres_baseline","productionChecksum":"replace-with-the-64-character-lowercase-production-checksum","evidenceId":"replace-with-the-same-restricted-evidence-id-used-by-the-ledger-exception","ledgerApprovalId":"replace-with-the-production-ledger-approval-id"}
   ```

   The validator requires the ledger baseline checksum and exception evidence
   ID to match this separate approval exactly. A different checksum cannot
   reuse the words `trailing-newline-only` to become trusted.

   The only permitted repository/production checksum difference is the DB-02
   recorded history for `20260818150000_postgres_baseline`: reason must be
   exactly `trailing-newline-only` and the ledger must contain a non-placeholder
   restricted evidence ID. This agrees with
   `docs/operations/postgresql-migrations.md`; it does not authorize editing the
   SQL file or production ledger. Any other checksum difference, unknown name,
   missing name, unfinished migration, rolled-back migration, extra exception,
   or approval-ID mismatch fails closed. Copy
   `restore-rehearsal.env.example` to the root-managed
   `/etc/data-statistics/dr-restore.env` mode `0600`; replace every critical
   table placeholder with a positive count from the restricted production
   baseline and record its change-ticket/evidence identifier. Do not deploy
   sample value `1` or invent a count. The systemd unit reads the production
   ledger and baseline-checksum approval from their fixed root-owned mode-`0600`
   source paths with `LoadCredential`; the postgres process receives only
   read-only private credential copies under `/run/credentials`. These are
   release metadata and counts
   only; do not copy rows. The script rejects placeholders, implausible integer
   ranges, a writable manifest, any missing/unexpected migration name, an
   database migration must match the DBA ledger exactly. `result.json` records
   the repository-manifest, production-ledger, and baseline-checksum-approval
   hashes. The restore
   service has a 60-minute hard timeout matching the stated RTO target. Install
   the systemd units, run `systemd-analyze verify`, enable the
   full, differential, five-minute check, weekly checksum verification, and
   monthly rehearsal timers, and configure `/etc/data-statistics/dr-alert.env`
   mode `0600` with both alert and deadman endpoints.
11. Cause a harmless alert test by invoking the alert script with a test event.
    Confirm the on-call channel receives it. Confirm the external deadman alerts
    when two expected health heartbeats are withheld in the monitoring test
    environment. Do not deliberately break production archiving.
12. Leave the existing logical-dump timer enabled during the proving period.

## First restore and PITR acceptance

The automated rehearsal defaults to ten minutes before invocation. PostgreSQL
is started with command-line isolation settings, which override restored
`postgresql.auto.conf`: no TCP listener, a private Unix socket on port 55433,
the dedicated data/HBA paths, and archiving off. The script verifies every
effective setting after startup and stops on any mismatch. It creates a unique
directory beneath `/var/lib/postgresql/dr-rehearsal`; it never touches the
production data directory. Only the newest two rehearsal directories are kept
by default; change that reviewed value only with a disk-capacity plan.

1. From `pgbackrest info`, choose and record an approved **full** backup label.
   Separately choose a UTC PITR target timestamp within the retained WAL window
   and decide whether `latest`, `current`, or a reviewed numeric timeline is
   correct. Do not paste repository endpoints or credentials into the record.
2. Ensure the isolated host has the same PostgreSQL major version and reviewed pgBackRest configuration. A separate recovery VM is preferred; the dedicated local directory is the minimum acceptable first test.
3. Run the full-backup restore and PITR as two independent rehearsals through
   the hardened systemd unit. Do not invoke the script directly: the unit is
   responsible for loading the root-only ledger/checksum evidence as private
   credentials, holding the sandbox, archiving the passed result as root, and
   triggering failure alerts. For each run, use `systemctl edit --runtime
   data-statistics-restore-rehearsal.service`, replace only `ExecStart`, start the
   unit, preserve the result, then `systemctl revert` before configuring the
   other mode:

   ```sh
   [Service]
   ExecStart=
   ExecStart=/usr/local/lib/data-statistics-dr/restore-rehearsal.sh --mode full --set APPROVED_FULL_BACKUP_LABEL

   # For the separate PITR run, revert and create a new runtime override:
   [Service]
   ExecStart=
   ExecStart=/usr/local/lib/data-statistics-dr/restore-rehearsal.sh --mode pitr --target 2026-08-25\x2012:34:00+00 --timeline latest
   ```

   Run `sudo systemctl start data-statistics-restore-rehearsal.service` after
   each reviewed override and confirm both the unit and root-protected evidence
   files. `\x20` is systemd's escaped space inside the timestamp argument; use
   the separately approved real target. After each run, execute `sudo systemctl
   revert data-statistics-restore-rehearsal.service` and `sudo systemctl
   daemon-reload` so a one-off target cannot silently become the monthly default.

4. Retain both `result.json` files, the systemd result, start/end timestamps,
   selected backup label/type, backup WAL start/stop and source timeline,
   requested timeline/target, resulting replay timestamp/timeline, and
   redacted provider evidence. The script verifies
   promotion; effective socket-only isolation; approved minimum counts for
   `User`, `TeamGroup`, `LeadCustomer`, and `CustomerOrder`; and the exact
   migration count/latest migration. It never prints row contents.
   PostgreSQL startup is bounded to 45 minutes inside the 60-minute systemd
   timeout. Cleanup responsibility is registered before startup; every exit
   holds one exclusive lock from run-directory creation through final cleanup.
   Retention refuses every candidate with a live, stale, malformed, or unknown
   `postmaster.pid`, and scans `/proc` for a live exact data-path reference before
   checking again and deleting. Cleanup validates the fixed rehearsal
   PID/data/start time, exact PostgreSQL executable, process owner, session, and
   `-D` argument. The Linux helper then opens a pidfd, repeats validation against
   that pinned kernel process, and sends PostgreSQL fast shutdown through the
   pidfd; it does not rely on the PID remaining globally unique between shell
   checks and signal delivery. Failure records `cleanup-error.log`, preserves the
   run, fails the service, and triggers alerting.
5. Record measured RPO as the difference between the requested target/incident cutoff and the newest successfully restorable transaction evidence. Record measured RTO from declaration/start to validation completion.
6. Treat any missing backup, corrupt repository, missing WAL segment, timeout, failed table check, or absent alert as failed acceptance. Fix it and repeat; do not mark DR-01 complete.

## Alert coverage

- Backup/upload failure: the full and differential units fail and invoke `data-statistics-dr-alert@.service`.
- Missing/stale backup or broken WAL path: five-minute `pgbackrest check`, fresh
  successful-archive validation, and latest-failure ordering fail and alert.
- Host/timer/check silence: an external deadman alerts after two missed
  five-minute success heartbeats. This monitor must be outside the database
  host and backup account.
- Damaged backup objects: weekly `pgbackrest verify` checksum validation fails and alerts.
- Restore failure, isolation mismatch, exact-migration mismatch, or controlled
  table-baseline failure: the monthly rehearsal unit fails and alerts.
- Provider-side alerts must additionally cover denied writes, capacity/quota, object-lock/versioning changes, and credential changes; these cannot be proven from this repository.

## Disaster recovery procedure

1. Incident commander freezes deployments and records the desired UTC recovery point. Revoke compromised application credentials if relevant.
2. Preserve the failed cluster and any unarchived `pg_wal` on separate storage when safe. Never overwrite the only copy.
3. Provision an isolated PostgreSQL 16 host. Restore with the reviewed script/pgBackRest target. Do not point the application at it yet.
4. Validate PostgreSQL starts with the command-line isolation settings,
   recovery used the intended backup/timeline and reached the intended point,
   migrations exactly match the release, critical table counts meet the
   approved baseline, and a DBA performs restricted business checks without
   exporting personal data.
5. Rotate database/application secrets, fence the old primary, then switch the application in a separately approved change. Run login, permissions, read, and write smoke tests.
6. Preserve incident logs and the redacted recovery record. Take a new full backup after the recovered primary is stable.

## Rollback during enablement

Rollback is for a failed rollout before a disaster, not for undoing an actual recovery.

1. Disable the five DR timers (full, differential, health check, checksum verification, and restore rehearsal); keep evidence and the existing logical backup running.
2. If the PostgreSQL restart or archive command causes instability, set `archive_command=''` by an approved config change and reload so PostgreSQL stops calling pgBackRest while retaining WAL. Diagnose promptly because WAL can fill disk.
3. To fully revert, restore the pre-change PostgreSQL configuration with `archive_mode=off` and restart in a maintenance window. Verify application health and disk/WAL usage.
4. Do not delete the remote repository, WAL, local spool, or prior full backups during rollback. Deletion is a later, separately approved retention action after recovery evidence is secured.

## Completion checklist

- [ ] Named primary, secondary, and business owners recorded.
- [ ] Independent encrypted/versioned/immutable repository evidence recorded.
- [ ] Database-host identity is proven list/read/write-only with no delete, and
      the isolated off-host retention job is tested.
- [ ] Initial full backup and continuous WAL check pass.
- [ ] Full restore succeeds in isolation.
- [ ] Specified-time restore succeeds in isolation.
- [ ] Critical table and migration checks pass.
- [ ] Repository manifest, root-only DBA production ledger, and independent
      root-only baseline-checksum approval hashes are all recorded; only the
      documented DB-02 baseline newline exception appears, with the exact
      separately approved production checksum and evidence ID.
- [ ] Passed restore result and SHA-256 exist as root-owned mode-`0600` files in
      `/var/lib/data-statistics/dr-evidence`, independently of retained run dirs.
- [ ] Effective listen address, port, socket, data path, HBA path, and archive
      mode prove the restored instance remained isolated.
- [ ] Backup corruption/upload/restore alert paths are tested.
- [ ] External deadman alert is tested without breaking production archiving.
- [ ] Measured RPO is at most 5 minutes or exception accepted.
- [ ] Measured RTO is at most 60 minutes or exception accepted.
- [ ] Runbook and evidence location are accessible to both on-call owners.
