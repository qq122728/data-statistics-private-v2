#!/usr/bin/env bash
set -euo pipefail

: "${CONFIRM_ISOLATED_RESTORE:?set CONFIRM_ISOLATED_RESTORE=YES}"
[[ "$CONFIRM_ISOLATED_RESTORE" == "YES" ]] || { echo "isolated restore confirmation missing" >&2; exit 2; }

STANZA="${PGBACKREST_STANZA:-data-statistics}"
REHEARSAL_ROOT="${DR_REHEARSAL_ROOT:-/var/lib/postgresql/dr-rehearsal}"
PORT="${DR_REHEARSAL_PORT:-55433}"
DATABASE="${DR_REHEARSAL_DATABASE:-data_statistics}"
MODE="${DR_RESTORE_MODE:-pitr}"
TARGET_UTC="${DR_RESTORE_TARGET_UTC:-}"
BACKUP_SET="${DR_RESTORE_SET:-}"
TARGET_TIMELINE="${DR_RESTORE_TIMELINE:-latest}"
KEEP_RUNS="${DR_REHEARSAL_KEEP_RUNS:-2}"

: "${DR_APPROVAL_ENV_FILE:?set the root-managed restore approval EnvironmentFile path}"
: "${DR_REPO_MIGRATION_MANIFEST:?set the installed repository migration manifest path}"
: "${DR_PRODUCTION_MIGRATION_LEDGER:?set the root-managed production migration ledger path}"
: "${DR_BASELINE_CHECKSUM_APPROVAL:?set the root-managed baseline checksum approval path}"
: "${DR_MIGRATION_LEDGER_APPROVAL_ID:?set the DBA production-ledger approval identifier}"
: "${DR_MIGRATION_VALIDATOR:?set the installed migration-ledger validator path}"
: "${DR_CLEANUP_LIBRARY:?set the installed bounded cleanup library path}"
: "${DR_PIDFD_STOP_HELPER:?set the installed pidfd PostgreSQL stop helper path}"
: "${DR_EXPECTED_MIGRATION_COUNT:?set the exact deployed migration count}"
: "${DR_EXPECTED_LATEST_MIGRATION:?set the exact latest deployed migration name}"
: "${DR_BASELINE_APPROVAL_ID:?set the approved baseline evidence/change identifier}"
: "${DR_MIN_USERS:?set the approved minimum restored User count}"
: "${DR_MIN_GROUPS:?set the approved minimum restored TeamGroup count}"
: "${DR_MIN_LEADS:?set the approved minimum restored LeadCustomer count}"
: "${DR_MIN_ORDERS:?set the approved minimum restored CustomerOrder count}"

usage() {
  echo "usage: restore-rehearsal.sh --mode pitr [--target 'YYYY-MM-DD HH:MM:SS+00'] [--timeline latest|current|N] [--set BACKUP]" >&2
  echo "       restore-rehearsal.sh --mode full --set FULL_BACKUP_LABEL" >&2
  exit 2
}

while (( $# )); do
  case "$1" in
    --mode) [[ $# -ge 2 ]] || usage; MODE="$2"; shift 2 ;;
    --target) [[ $# -ge 2 ]] || usage; TARGET_UTC="$2"; shift 2 ;;
    --timeline) [[ $# -ge 2 ]] || usage; TARGET_TIMELINE="$2"; shift 2 ;;
    --set) [[ $# -ge 2 ]] || usage; BACKUP_SET="$2"; shift 2 ;;
    *) usage ;;
  esac
done

[[ "$MODE" == "pitr" || "$MODE" == "full" ]] || usage
[[ "$REHEARSAL_ROOT" == /var/lib/postgresql/dr-rehearsal ]] || {
  echo "DR_REHEARSAL_ROOT must be the dedicated rehearsal directory" >&2
  exit 2
}
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1024 && PORT <= 65535 && PORT != 5432 )) || {
  echo "invalid isolated PostgreSQL port" >&2
  exit 2
}
[[ "$KEEP_RUNS" =~ ^[0-9]+$ ]] && (( KEEP_RUNS >= 1 && KEEP_RUNS <= 10 )) || {
  echo "DR_REHEARSAL_KEEP_RUNS must be between 1 and 10" >&2
  exit 2
}
for value in "$DR_EXPECTED_MIGRATION_COUNT" "$DR_MIN_USERS" "$DR_MIN_GROUPS" "$DR_MIN_LEADS" "$DR_MIN_ORDERS"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "migration and table thresholds must be non-negative integers" >&2; exit 2; }
done
(( DR_EXPECTED_MIGRATION_COUNT > 0 && DR_EXPECTED_MIGRATION_COUNT <= 10000 \
  && DR_MIN_USERS > 0 && DR_MIN_USERS <= 2147483647 \
  && DR_MIN_GROUPS > 0 && DR_MIN_GROUPS <= 2147483647 \
  && DR_MIN_LEADS > 0 && DR_MIN_LEADS <= 2147483647 \
  && DR_MIN_ORDERS > 0 && DR_MIN_ORDERS <= 2147483647 )) || {
  echo "migration and every critical-table expectation must be greater than zero" >&2
  exit 2
}
[[ "$DR_BASELINE_APPROVAL_ID" != replace-with-* \
  && "$DR_BASELINE_APPROVAL_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$ ]] || {
  echo "invalid or placeholder baseline approval identifier" >&2
  exit 2
}
[[ "$DR_MIGRATION_LEDGER_APPROVAL_ID" != replace-with-* \
  && "$DR_MIGRATION_LEDGER_APPROVAL_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$ ]] || {
  echo "invalid or placeholder production migration ledger approval identifier" >&2
  exit 2
}
[[ "$DR_CLEANUP_LIBRARY" == /usr/local/lib/data-statistics-dr/restore-cleanup.sh \
  && -f "$DR_CLEANUP_LIBRARY" && ! -L "$DR_CLEANUP_LIBRARY" ]] || {
  echo "installed bounded cleanup library is missing" >&2
  exit 2
}
cleanup_library_mode="$(stat -c '%a' "$DR_CLEANUP_LIBRARY")"
[[ "$(stat -c '%u' "$DR_CLEANUP_LIBRARY")" == 0 \
  && "$cleanup_library_mode" =~ ^[0-7]{3,4}$ && $(( 0$cleanup_library_mode & 0022 )) -eq 0 ]] || {
  echo "bounded cleanup library must be root-owned and not group/world writable" >&2
  exit 2
}
# shellcheck source=restore-cleanup.sh
source "$DR_CLEANUP_LIBRARY"
[[ "$DR_PIDFD_STOP_HELPER" == /usr/local/lib/data-statistics-dr/pidfd-stop-postgres.py \
  && -f "$DR_PIDFD_STOP_HELPER" && ! -L "$DR_PIDFD_STOP_HELPER" ]] || {
  echo "installed pidfd PostgreSQL stop helper is missing" >&2
  exit 2
}
pidfd_helper_mode="$(stat -c '%a' "$DR_PIDFD_STOP_HELPER")"
[[ "$(stat -c '%u' "$DR_PIDFD_STOP_HELPER")" == 0 \
  && "$pidfd_helper_mode" =~ ^[0-7]{3,4}$ && $(( 0$pidfd_helper_mode & 0022 )) -eq 0 ]] || {
  echo "pidfd PostgreSQL stop helper must be root-owned and not group/world writable" >&2
  exit 2
}
[[ "$DR_APPROVAL_ENV_FILE" == /etc/data-statistics/dr-restore.env \
  && -f "$DR_APPROVAL_ENV_FILE" && ! -L "$DR_APPROVAL_ENV_FILE" \
  && "$(stat -c '%u:%a' "$DR_APPROVAL_ENV_FILE")" == "0:600" ]] || {
  echo "restore approval EnvironmentFile must be the root-owned mode-0600 managed path" >&2
  exit 2
}
[[ "$DR_EXPECTED_LATEST_MIGRATION" =~ ^[A-Za-z0-9_-]{1,200}$ ]] || {
  echo "invalid expected migration name" >&2
  exit 2
}

if [[ "$MODE" == "pitr" ]]; then
  TARGET_UTC="${TARGET_UTC:-$(date -u -d '10 minutes ago' '+%Y-%m-%d %H:%M:%S+00')}"
  [[ "$TARGET_UTC" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}\ [0-9]{2}:[0-9]{2}:[0-9]{2}\+00$ ]] || {
    echo "PITR target must be an explicit UTC timestamp ending in +00" >&2
    exit 2
  }
  target_epoch="$(date -u -d "$TARGET_UTC" +%s)" || { echo "invalid PITR target" >&2; exit 2; }
  [[ "$(date -u -d "@$target_epoch" '+%Y-%m-%d %H:%M:%S+00')" == "$TARGET_UTC" ]] || {
    echo "invalid PITR calendar timestamp" >&2
    exit 2
  }
  (( target_epoch <= $(date -u +%s) )) || { echo "PITR target cannot be in the future" >&2; exit 2; }
  [[ "$TARGET_TIMELINE" == "latest" || "$TARGET_TIMELINE" == "current" || "$TARGET_TIMELINE" =~ ^(0x[0-9A-Fa-f]+|[1-9][0-9]*)$ ]] || {
    echo "invalid recovery target timeline" >&2
    exit 2
  }
else
  [[ -n "$BACKUP_SET" ]] || { echo "full restore requires --set with an approved full backup label" >&2; exit 2; }
  [[ -z "$TARGET_UTC" ]] || { echo "full restore does not accept a PITR target" >&2; exit 2; }
  target_epoch=""
  TARGET_TIMELINE=""
fi

for command in pgbackrest pg_config psql pg_isready python3 find sort stat timeout head tr grep basename dirname readlink sed awk flock; do command -v "$command" >/dev/null; done
PG_BINDIR="${PG_BINDIR:-$(pg_config --bindir)}"
PG_CTL="$PG_BINDIR/pg_ctl"
[[ -x "$PG_CTL" ]] || { echo "pg_ctl not found in PostgreSQL bindir" >&2; exit 2; }
if pg_isready -q -h 127.0.0.1 -p "$PORT"; then
  echo "rehearsal port is already in use" >&2
  exit 2
fi

umask 077
[[ -d "$REHEARSAL_ROOT" && ! -L "$REHEARSAL_ROOT" ]] || {
  echo "dedicated rehearsal root must be pre-created and must not be a symlink" >&2
  exit 2
}
lock_file="$REHEARSAL_ROOT/.restore.lock"
if [[ -e "$lock_file" || -L "$lock_file" ]]; then
  [[ -f "$lock_file" && ! -L "$lock_file" && "$(stat -c '%u:%a' "$lock_file")" == "$(id -u):600" ]] || {
    echo "rehearsal lock file is unsafe" >&2
    exit 2
  }
fi
(umask 077; : >>"$lock_file")
chmod 0600 "$lock_file"
exec 8>>"$lock_file"
flock -n 8 || { echo "another restore rehearsal or retention cleanup is active" >&2; exit 1; }
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$"
run_dir="$REHEARSAL_ROOT/$run_id"
data_dir="$run_dir/data"
socket_dir="$run_dir/socket"
mkdir "$run_dir"
mkdir "$data_dir" "$socket_dir"

# Register cleanup as soon as this run owns a data directory, before any
# restore or PostgreSQL start attempt. A timed-out pg_ctl may still have
# launched postgres, so cleanup is based on the fixed data path and PID file,
# not on whether pg_ctl reported success.
cleanup() {
  exit_code=$?
  trap - EXIT
  cleanup_failed=0
  dr_cleanup_postgres "$REHEARSAL_ROOT" "$run_dir" "$data_dir" "$PG_CTL" \
    "$run_dir/postgresql.log" "$run_dir/cleanup-error.log" "$DR_PIDFD_STOP_HELPER" || cleanup_failed=1
  if (( cleanup_failed )); then
    echo "isolated PostgreSQL cleanup failed; see $run_dir/cleanup-error.log" >&2
    (( exit_code == 0 )) && exit_code=1
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ "$DR_REPO_MIGRATION_MANIFEST" == /usr/local/share/data-statistics-dr/migration-manifest.sha256 \
  && -f "$DR_REPO_MIGRATION_MANIFEST" && ! -L "$DR_REPO_MIGRATION_MANIFEST" ]] || {
  echo "repository migration manifest must be the installed regular non-symlink file" >&2
  exit 2
}
manifest_uid="$(stat -c '%u' "$DR_REPO_MIGRATION_MANIFEST")"
manifest_mode="$(stat -c '%a' "$DR_REPO_MIGRATION_MANIFEST")"
[[ "$manifest_uid" == 0 && "$manifest_mode" =~ ^[0-7]{3,4}$ && $(( 0$manifest_mode & 0022 )) -eq 0 ]] || {
  echo "repository migration manifest must be root-owned and not group/world writable" >&2
  exit 2
}
[[ "$DR_PRODUCTION_MIGRATION_LEDGER" == /run/credentials/*/production-migration-ledger \
  && -f "$DR_PRODUCTION_MIGRATION_LEDGER" && ! -L "$DR_PRODUCTION_MIGRATION_LEDGER" \
  && -r "$DR_PRODUCTION_MIGRATION_LEDGER" ]] || {
  echo "production migration ledger must be the systemd read-only credential sourced from the root-owned mode-0600 file" >&2
  exit 2
}
[[ "$DR_BASELINE_CHECKSUM_APPROVAL" == /run/credentials/*/baseline-checksum-approval \
  && -f "$DR_BASELINE_CHECKSUM_APPROVAL" && ! -L "$DR_BASELINE_CHECKSUM_APPROVAL" \
  && -r "$DR_BASELINE_CHECKSUM_APPROVAL" ]] || {
  echo "baseline checksum approval must be the systemd read-only credential sourced from the root-owned mode-0600 file" >&2
  exit 2
}
[[ "$DR_MIGRATION_VALIDATOR" == /usr/local/lib/data-statistics-dr/validate-migration-ledger.py \
  && -f "$DR_MIGRATION_VALIDATOR" && ! -L "$DR_MIGRATION_VALIDATOR" ]] || {
  echo "installed migration-ledger validator is missing" >&2
  exit 2
}
migration_validator_mode="$(stat -c '%a' "$DR_MIGRATION_VALIDATOR")"
[[ "$(stat -c '%u' "$DR_MIGRATION_VALIDATOR")" == 0 \
  && "$migration_validator_mode" =~ ^[0-7]{3,4}$ && $(( 0$migration_validator_mode & 0022 )) -eq 0 ]] || {
  echo "migration-ledger validator must be root-owned and not group/world writable" >&2
  exit 2
}

# Retain a small, explicit number of full restore directories. Every candidate
# is revalidated beneath the fixed rehearsal root before removal.
mapfile -d '' prior_runs < <(find "$REHEARSAL_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z-*' -print0 | sort -z)
while (( ${#prior_runs[@]} > KEEP_RUNS )); do
  candidate="${prior_runs[0]}"
  prior_runs=("${prior_runs[@]:1}")
  [[ "$candidate" != "$run_dir" && "$candidate" == "$REHEARSAL_ROOT"/20* && "$(basename "$candidate")" =~ ^20[0-9]{6}T[0-9]{6}Z-[0-9]+$ ]] || {
    echo "unsafe rehearsal retention candidate rejected" >&2
    exit 2
  }
  dr_assert_rehearsal_run_inactive "$REHEARSAL_ROOT" "$candidate" "$run_dir/cleanup-error.log" || {
    echo "retention candidate may contain a live or unknown PostgreSQL instance; refusing deletion" >&2
    exit 1
  }
  dr_assert_rehearsal_run_inactive "$REHEARSAL_ROOT" "$candidate" "$run_dir/cleanup-error.log" || {
    echo "retention candidate identity changed; refusing deletion" >&2
    exit 1
  }
  rm -rf -- "$candidate"
done

info_file="$run_dir/pgbackrest-info.json"
pgbackrest --stanza="$STANZA" --output=json info >"$info_file"
IFS=$'\t' read -r selected_backup selected_type selected_stop selected_archive_start selected_archive_stop < <(
  python3 - "$info_file" "$MODE" "$BACKUP_SET" "$target_epoch" <<'PY'
import json
import sys

path, mode, requested, target = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    data = json.load(handle)
if len(data) != 1 or data[0].get("status", {}).get("code") != 0:
    raise SystemExit("pgBackRest repository status is not ok")
backups = [item for item in data[0].get("backup", []) if not item.get("error")]
if requested:
    candidates = [item for item in backups if item.get("label") == requested]
    if len(candidates) != 1:
        raise SystemExit("requested backup label was not found exactly once")
    selected = candidates[0]
else:
    cutoff = int(target)
    candidates = [item for item in backups if int(item.get("timestamp", {}).get("stop", 0)) <= cutoff]
    if not candidates:
        raise SystemExit("no completed backup is old enough for the requested PITR target")
    selected = max(candidates, key=lambda item: int(item["timestamp"]["stop"]))
if mode == "full" and selected.get("type") != "full":
    raise SystemExit("full restore mode requires a full backup label")
if mode == "pitr" and int(selected.get("timestamp", {}).get("stop", 0)) > int(target):
    raise SystemExit("selected backup completed after the PITR target")
archive = selected.get("archive", {})
archive_start = archive.get("start", "")
archive_stop = archive.get("stop", "")
if not isinstance(archive_start, str) or not isinstance(archive_stop, str):
    raise SystemExit("selected backup has invalid WAL archive evidence")
print(f"{selected['label']}\t{selected['type']}\t{selected['timestamp']['stop']}\t{archive_start}\t{archive_stop}")
PY
)
rm -f -- "$info_file"
[[ -n "$selected_backup" && -n "$selected_type" && "$selected_stop" =~ ^[0-9]+$ \
  && "$selected_archive_start" =~ ^[0-9A-Fa-f]{24}$ && "$selected_archive_stop" =~ ^[0-9A-Fa-f]{24}$ ]] || {
  echo "unable to select a restore backup" >&2
  exit 2
}
selected_backup_timeline=$((16#${selected_archive_start:0:8}))

started_at="$(date -u +%s)"

restore_args=(--stanza="$STANZA" --pg1-path="$data_dir" --set="$selected_backup" --target-action=promote --archive-mode=off)
if [[ "$MODE" == "pitr" ]]; then
  restore_args+=(--type=time --target="$TARGET_UTC" --target-timeline="$TARGET_TIMELINE")
else
  restore_args+=(--type=immediate)
fi
pgbackrest "${restore_args[@]}" restore

[[ ! -e "$data_dir/postmaster.pid" ]] || {
  echo "restored data unexpectedly contains postmaster.pid; refusing startup" >&2
  exit 1
}

# postgresql.auto.conf from the restored cluster overrides postgresql.conf.
# pg_ctl -o passes -c options directly to postgres, which has the highest
# configuration precedence and therefore cannot be undone by restored settings.
cat >"$data_dir/postgresql.conf" <<EOF
data_directory = '$data_dir'
hba_file = '$data_dir/pg_hba.conf'
ident_file = '$data_dir/pg_ident.conf'
listen_addresses = ''
port = $PORT
unix_socket_directories = '$socket_dir'
archive_mode = off
EOF
printf 'local all all peer\n' >"$data_dir/pg_hba.conf"
: >"$data_dir/pg_ident.conf"

postgres_options="-c data_directory=$data_dir -c hba_file=$data_dir/pg_hba.conf -c ident_file=$data_dir/pg_ident.conf -c listen_addresses='' -c port=$PORT -c unix_socket_directories=$socket_dir -c archive_mode=off"
timeout --foreground --signal=TERM --kill-after=30s 45m \
  "$PG_CTL" -D "$data_dir" -l "$run_dir/postgresql.log" -o "$postgres_options" -w -t 2400 start

if pg_isready -q -h 127.0.0.1 -p "$PORT"; then
  echo "restored cluster unexpectedly accepts TCP connections" >&2
  exit 1
fi

validation_json="$(psql -XAtq -h "$socket_dir" -p "$PORT" --dbname="$DATABASE" --set=ON_ERROR_STOP=1 \
  --set=expected_migrations="$DR_EXPECTED_MIGRATION_COUNT" \
  --set=expected_latest="$DR_EXPECTED_LATEST_MIGRATION" \
  --set=min_users="$DR_MIN_USERS" --set=min_groups="$DR_MIN_GROUPS" \
  --set=min_leads="$DR_MIN_LEADS" --set=min_orders="$DR_MIN_ORDERS" \
  --set=expected_port="$PORT" --set=expected_socket="$socket_dir" \
  --set=expected_data="$data_dir" --set=expected_hba="$data_dir/pg_hba.conf" <<'SQL'
WITH restored AS (
  SELECT
    (SELECT count(*) FROM "User")::int AS users,
    (SELECT count(*) FROM "TeamGroup")::int AS groups,
    (SELECT count(*) FROM "LeadCustomer")::int AS leads,
    (SELECT count(*) FROM "CustomerOrder")::int AS orders,
    (SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS migrations,
    EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = :'expected_latest' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS expected_latest_applied
)
SELECT json_build_object(
  'notInRecovery', NOT pg_is_in_recovery(),
  'listenAddresses', current_setting('listen_addresses'),
  'port', current_setting('port')::int,
  'socketDirectories', current_setting('unix_socket_directories'),
  'archiveMode', current_setting('archive_mode'),
  'dataDirectoryMatches', current_setting('data_directory') = :'expected_data',
  'hbaFileMatches', current_setting('hba_file') = :'expected_hba',
  'isolationPassed', current_setting('listen_addresses') = ''
    AND current_setting('port')::int = :'expected_port'::int
    AND current_setting('unix_socket_directories') = :'expected_socket'
    AND current_setting('archive_mode') = 'off'
    AND current_setting('data_directory') = :'expected_data'
    AND current_setting('hba_file') = :'expected_hba',
  'replayTimestamp', pg_last_xact_replay_timestamp(),
  'timelineId', (SELECT timeline_id FROM pg_control_checkpoint()),
  'users', restored.users,
  'groups', restored.groups,
  'leads', restored.leads,
  'orders', restored.orders,
  'baselineMinimums', json_build_object(
    'users', :'min_users'::int,
    'groups', :'min_groups'::int,
    'leads', :'min_leads'::int,
    'orders', :'min_orders'::int
  ),
  'migrations', restored.migrations,
  'expectedLatestMigrationApplied', restored.expected_latest_applied,
  'migrationRows', COALESCE((
    SELECT json_agg(json_build_object(
      'name', migration_name,
      'checksum', checksum,
      'finished', finished_at IS NOT NULL,
      'rolledBack', rolled_back_at IS NOT NULL
    ) ORDER BY migration_name)
    FROM "_prisma_migrations"
  ), '[]'::json),
  'baselinePassed', restored.users >= :'min_users'::int
    AND restored.groups >= :'min_groups'::int
    AND restored.leads >= :'min_leads'::int
    AND restored.orders >= :'min_orders'::int,
  'migrationCountAndLatestPassed', restored.migrations = :'expected_migrations'::int
    AND restored.expected_latest_applied
) FROM restored;
SQL
)"

validation_json="$(python3 "$DR_MIGRATION_VALIDATOR" "$validation_json" \
  "$DR_REPO_MIGRATION_MANIFEST" "$DR_PRODUCTION_MIGRATION_LEDGER" \
  "$DR_EXPECTED_MIGRATION_COUNT" "$DR_EXPECTED_LATEST_MIGRATION" \
  "$DR_MIGRATION_LEDGER_APPROVAL_ID" "$DR_BASELINE_CHECKSUM_APPROVAL")"

python3 - "$validation_json" <<'PY'
import json
import sys
result = json.loads(sys.argv[1])
if result.get("notInRecovery") is not True:
    raise SystemExit("restored cluster did not promote")
if result.get("isolationPassed") is not True:
    raise SystemExit("restored cluster isolation validation failed")
if result.get("baselinePassed") is not True:
    raise SystemExit("critical table controlled baseline validation failed")
if result.get("migrationCountAndLatestPassed") is not True:
    raise SystemExit("migration count/latest validation failed")
if result.get("migrationCheckPassed") is not True:
    raise SystemExit("production migration ledger validation failed")
PY

finished_at="$(date -u +%s)"
python3 - "$run_dir/result.json" "$run_id" "$MODE" "$selected_backup" "$selected_type" "$selected_stop" \
  "$selected_archive_start" "$selected_archive_stop" "$selected_backup_timeline" \
  "$TARGET_UTC" "$TARGET_TIMELINE" "$started_at" "$finished_at" "$DR_BASELINE_APPROVAL_ID" "$validation_json" <<'PY'
import json
import os
import sys
path, run_id, mode, backup, backup_type, backup_stop, archive_start, archive_stop, backup_timeline, target, timeline, started, finished, approval_id, validation = sys.argv[1:]
validation_result = json.loads(validation)
result = {
    "runId": run_id,
    "status": "passed",
    "mode": mode,
    "selectedBackupLabel": backup,
    "selectedBackupType": backup_type,
    "selectedBackupStopEpoch": int(backup_stop),
    "selectedBackupArchiveStart": archive_start,
    "selectedBackupArchiveStop": archive_stop,
    "selectedBackupTimelineId": int(backup_timeline),
    "requestedTargetUtc": target or None,
    "requestedTimeline": timeline or None,
    "startedAtEpoch": int(started),
    "finishedAtEpoch": int(finished),
    "durationSeconds": int(finished) - int(started),
    "baselineApprovalId": approval_id,
    "repositoryManifestSha256": validation_result["repositoryManifestSha256"],
    "productionLedgerSha256": validation_result["productionLedgerSha256"],
    "productionLedgerApprovalId": validation_result["productionLedgerApprovalId"],
    "baselineChecksumApprovalSha256": validation_result["baselineChecksumApprovalSha256"],
    "baselineChecksumApprovalEvidenceId": validation_result["baselineChecksumApprovalEvidenceId"],
    "validation": validation_result,
}
temporary = path + ".tmp"
with open(temporary, "x", encoding="utf-8") as handle:
    json.dump(result, handle, separators=(",", ":"))
    handle.write("\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(temporary, 0o600)
os.replace(temporary, path)
pointer = os.path.join(os.path.dirname(os.path.dirname(path)), "last-passed-result-path")
pointer_temporary = pointer + ".tmp"
with open(pointer_temporary, "x", encoding="utf-8") as handle:
    handle.write(path + "\n")
    handle.flush()
    os.fsync(handle.fileno())
os.chmod(pointer_temporary, 0o600)
os.replace(pointer_temporary, pointer)
print(json.dumps(result, separators=(",", ":")))
PY
