# DR-01 production inventory (read-only)

Inventory date: 2026-08-25 UTC

This file deliberately contains no database connection string, password, token, private key, or object-storage credential.

## Observed state

- Host OS: Ubuntu 24.04.
- PostgreSQL: 16.15, service active.
- Application database: `data_statistics`; 16 completed production migrations were observed.
- `wal_level=replica` and `max_wal_senders=10` are already compatible with continuous archiving.
- `archive_mode=off`, `archive_timeout=0`, and no effective archive command is configured. PITR is therefore **not available** today.
- pgBackRest, WAL-G, restic, rclone, and common S3 CLIs were not installed at inventory time.
- Ubuntu 24.04 currently offers pgBackRest 2.50 from its configured package repository. Pin and record the reviewed package version during rollout.
- `data-statistics-boss-daily.timer` runs at 02:30 UTC. Its 2026-08-25 run exited successfully and produced an encrypted custom-format logical dump sent through the existing delivery channel.
- There is no pgBackRest/base-backup/WAL timer enabled.
- Pre-deployment logical dumps exist under `/opt/data-statistics/backups`. Several zero-byte failed artifacts also exist. This directory is on the application host and no separate mount was observed, so it is not independent off-site recovery evidence.
- No root, postgres, or application-user crontab was found. A legacy `/etc/cron.d/data-statistics-boss-brief` entry exists for the report trigger; it is not a PITR job.

## Decision

Use pgBackRest with an encrypted S3-compatible repository in a separate account/project and continuous WAL archiving. Keep the existing encrypted logical dump during rollout as a second recovery format, but do not count it as PITR.

Why pgBackRest: PostgreSQL 16 is supported, the database is currently a single local cluster, and pgBackRest provides base backups, WAL archiving, retention, repository verification, and targeted restore without adding a database proxy or changing the application connection path.

## Evidence still required after rollout

- Provider-side proof that the bucket is in an independent account/project, versioning or object lock is enabled, encryption is enabled, and the database host credential cannot delete retained objects.
- A successful initial full backup and `pgbackrest check`.
- A recorded isolated restore from the off-site repository.
- A recorded point-in-time restore to a chosen UTC timestamp.
- Measured RPO and RTO, rather than the targets stated in the runbook.
