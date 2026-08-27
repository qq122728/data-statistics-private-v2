#!/usr/bin/env bash
set -euo pipefail

STANZA="${PGBACKREST_STANZA:-data-statistics}"
MAX_ANY_AGE_SECONDS="${PGBACKREST_MAX_ANY_AGE_SECONDS:-129600}"
MAX_FULL_AGE_SECONDS="${PGBACKREST_MAX_FULL_AGE_SECONDS:-691200}"
MAX_ARCHIVE_AGE_SECONDS="${PGBACKREST_MAX_ARCHIVE_AGE_SECONDS:-600}"
: "${DR_DEADMAN_WEBHOOK_URL:?DR deadman webhook is not configured}"

for value in "$MAX_ANY_AGE_SECONDS" "$MAX_FULL_AGE_SECONDS" "$MAX_ARCHIVE_AGE_SECONDS"; do
  [[ "$value" =~ ^[0-9]+$ ]] && (( value > 0 )) || { echo "health thresholds must be positive integers" >&2; exit 2; }
done

command -v pgbackrest >/dev/null
command -v psql >/dev/null
command -v python3 >/dev/null
command -v curl >/dev/null
HEALTH_VALIDATOR="${DR_HEALTH_VALIDATOR:-/usr/local/lib/data-statistics-dr/validate-backup-health.py}"
[[ -f "$HEALTH_VALIDATOR" && ! -L "$HEALTH_VALIDATOR" ]] || { echo "backup health validator is missing" >&2; exit 2; }

# pgBackRest check forces a WAL switch and waits until the segment is safely in
# the repository, so the archiver timestamp below must be fresh afterward.
pgbackrest --stanza="$STANZA" check >/dev/null
info_json="$(pgbackrest --stanza="$STANZA" --output=json info)"
archiver_json="$(psql -XAtq --dbname=postgres --set=ON_ERROR_STOP=1 -c \
  "SELECT json_build_object('archivedCount', archived_count, 'failedCount', failed_count, 'lastArchivedTime', last_archived_time, 'lastFailedTime', last_failed_time) FROM pg_stat_archiver;")"

health_json="$(python3 "$HEALTH_VALIDATOR" "$MAX_ANY_AGE_SECONDS" "$MAX_FULL_AGE_SECONDS" \
  "$MAX_ARCHIVE_AGE_SECONDS" "$info_json" "$archiver_json")"

# This is a deadman heartbeat: if the host, timer, repository check, or this
# request stops succeeding, the external monitor must alert independently.
curl --fail --silent --show-error --max-time 15 \
  -H 'Content-Type: application/json' --data "$health_json" "$DR_DEADMAN_WEBHOOK_URL" >/dev/null
printf '%s\n' "$health_json"
