# LOG-02 security logging deployment and verification

## Production observation (read-only, 2026-08-25)

- The app writes stdout to journald with no unit rate limit or documented retention cap.
- Nginx uses its default access log, which includes the complete request target, client
  address, and browser fingerprinting data.
- PostgreSQL connection, disconnection, and slow-query logging are disabled.
- Nginx and PostgreSQL have distribution logrotate entries; scheduled application-job
  logs have no dedicated rule.
- Log contents were deliberately not opened because historical manual starts may have
  placed database credentials in the systemd journal.

## Staged change

1. Install the Nginx format inside `http {}` and select `privacy_main`. Run `nginx -t`
   before reload. Confirm a test URL containing a harmless query marker logs the path
   but not the marker, client IP, Referer, authenticated username, or User-Agent.
   Every authenticated application 403 is centrally audited with its internal actor and
   carries `X-Security-Audit: app`; Nginx must hide that internal header. Its anonymous
   fallback is only for an unmarked response where no actor exists (for example, an
   Nginx-originated 403), never a substitute for application actor auditing.
2. Install the PostgreSQL fragment through the server's supported `conf.d` directory.
   Before reload, query `pg_file_settings` and stop if any row has a non-null `error`;
   reload with the distribution's supported command, then verify every setting in the
   fragment through `pg_settings`. Do not issue test SQL containing personal data.
3. Create `/var/log/data-statistics` as `0750`, owned by the runtime account; install
   the logrotate rule and run `logrotate --debug` before enabling it.
4. Install the application service drop-in, run `systemd-analyze verify` against the
   complete unit, reload systemd, and restart only the application service. Check that
   `LogRateLimitIntervalUSec` and `LogRateLimitBurst` have the intended values.
5. Size the host-wide journald limits for the actual disk, install the journald drop-in,
   run `systemd-analyze cat-config systemd/journald.conf`, and restart journald in the
   maintenance window. The supplied 1 GiB/2 GiB values are examples, not universal.
6. Install the capacity, journal-suppression, and external-alert scripts as root-owned
   `0755`. Create `/etc/data-statistics/log-monitor.env` from the example as root:root
   `0600`, using a dedicated HTTPS receiver. Install and enable both check timers.
   Their services use `OnFailure=data-statistics-log-alert@%n.service`; a journal entry
   alone is not an adequate off-host alert. Configure the monitoring receiver itself
   to warn if expected alerts/tests stop arriving.
7. Limit journal and log-group membership to operations staff. Application runtime and
   deployment users must not be members of `systemd-journal`, `adm`, or `postgres`.
8. Use the credential-rotation runbook separately. Do not inspect or reproduce the old
   journal payload while rotating.

## Acceptance checks

- Login success/failure/lockout and role denial produce JSON containing only timestamp,
  category, event, internal user ID, team ID, and result.
- Searching new logs for the controlled test password/token/phone/name returns no hits.
- Nginx emits valid JSON without query strings, client IP, Referer, username, or
  User-Agent; scheduled-job rotation retains 14 compressed daily files.
- PostgreSQL logs connections and queries slower than one second, but not bind values.
- Journald enforces the approved size/retention caps, the application unit has a rate
  limit, and Nginx/PostgreSQL distribution rotation remains enabled.
- The capacity and suppression timers are active. A controlled capacity threshold
  failure and a controlled `data-statistics.service: Suppressed N messages` fixture
  both invoke `data-statistics-log-alert@...`; the external receiver acknowledges both.

## Capacity and suppressed-message alert verification

Install these files using the paths encoded in the units:

```text
ops/scripts/check-log-capacity.sh
  -> /usr/local/sbin/data-statistics-check-log-capacity
ops/scripts/check-journal-suppression.sh
  -> /usr/local/sbin/data-statistics-check-journal-suppression
ops/scripts/send-data-statistics-log-alert.sh
  -> /usr/local/lib/data-statistics/send-data-statistics-log-alert
ops/systemd/log-monitor.env.example
  -> /etc/data-statistics/log-monitor.env (root:root 0600)
```

Run `systemd-analyze verify` before installing the service/timer files. After daemon
reload, start both check services once, enable both timers, and confirm the external
receiver got a controlled `systemctl start data-statistics-log-alert@acceptance.service`
test. Temporarily set `DATA_STATISTICS_LOG_MAX_PERCENT` below current usage in the
protected environment file, start the capacity service, confirm the off-host alert,
then immediately restore the approved threshold. Do not fill the disk to test it.

The suppression checker reads only JSON journal `MESSAGE` fields from the configured
lookback and emits only an aggregate count; it never copies application log content to
the alert. A rate-limit event can be tested in an isolated staging unit that emits only
non-sensitive fixed text. Do not deliberately flood the production application. The
five-minute lookback can repeat an alert until the event ages out, so the receiver
should deduplicate by unit and time window.

## PostgreSQL privacy boundary

`log_parameter_max_length = 0` prevents bind values from being added to normal slow-query
entries. It cannot redact string literals embedded directly in SQL text. The application
must continue to use parameterized Prisma queries; do not enable `log_statement`, and do
not paste business values into ad-hoc SQL. If literal-bearing SQL is unavoidable, send
slow-query telemetry from `pg_stat_statements` to the approved monitoring system instead
of increasing statement logging.

The line prefix deliberately omits the client-host placeholder. `log_connections` can
still put the database connection source into PostgreSQL's own connection message, so it
is acceptable only while PostgreSQL accepts application traffic from a local Unix socket
or loopback address. Before enabling it, verify `listen_addresses`, `pg_hba.conf`, and the
runtime connection string. If the database is moved to another host, reassess this setting
and the log destination before rollout; do not assume a remote client address is harmless.
