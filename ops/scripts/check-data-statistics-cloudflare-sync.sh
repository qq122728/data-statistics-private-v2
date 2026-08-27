#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${NET02_STATE_DIR:-/var/lib/data-statistics/net-02}"
LAST_SUCCESS_FILE="$STATE_DIR/last-success-epoch"
MAX_AGE_SECONDS="${NET02_MAX_AGE_SECONDS:-129600}"
MONITOR_ENV_FILE="${NET02_MONITOR_ENV_FILE:-/etc/data-statistics/net02-monitor.env}"

[[ -f "$MONITOR_ENV_FILE" && ! -L "$MONITOR_ENV_FILE" \
  && "$(stat -c '%u:%g:%a' "$MONITOR_ENV_FILE")" == "0:0:600" ]] || {
  echo "ERROR: NET-02 monitor EnvironmentFile must be root:root mode 0600 and not a symlink" >&2
  exit 1
}

[[ "$MAX_AGE_SECONDS" =~ ^[0-9]+$ && "$MAX_AGE_SECONDS" -ge 3600 && "$MAX_AGE_SECONDS" -le 604800 ]] || {
  echo "ERROR: NET02_MAX_AGE_SECONDS must be between 3600 and 604800" >&2
  exit 1
}
[[ -d "$STATE_DIR" && ! -L "$STATE_DIR" && "$(stat -c '%u:%g:%a' "$STATE_DIR")" == "0:0:750" ]] || {
  echo "ERROR: NET-02 state directory is unsafe" >&2
  exit 1
}
[[ -f "$LAST_SUCCESS_FILE" && ! -L "$LAST_SUCCESS_FILE" && "$(stat -c '%u:%g:%a' "$LAST_SUCCESS_FILE")" == "0:0:640" ]] || {
  echo "ERROR: NET-02 last-success state is missing or unsafe" >&2
  exit 1
}
last_success="$(tr -d '[:space:]' <"$LAST_SUCCESS_FILE")"
[[ "$last_success" =~ ^[0-9]{10}$ ]] || { echo "ERROR: invalid last-success timestamp" >&2; exit 1; }
now="$(date -u +%s)"
age=$((now - last_success))
(( age >= 0 && age <= MAX_AGE_SECONDS )) || {
  echo "ERROR: Cloudflare synchronization is stale or timestamp is in the future (age=${age}s)" >&2
  exit 1
}

[[ "${NET02_DEADMAN_WEBHOOK_URL:-}" == https://* ]] || {
  echo "ERROR: NET02_DEADMAN_WEBHOOK_URL must be an HTTPS URL" >&2
  exit 1
}
payload="$(python3 - "$age" "$(hostname -f)" <<'PY'
import json
import sys
print(json.dumps({"check": "net02-cloudflare-sync", "ageSeconds": int(sys.argv[1]), "host": sys.argv[2]}))
PY
)"
curl --fail-with-body --silent --show-error --proto '=https' --connect-timeout 10 \
  --max-time 30 -H 'Content-Type: application/json' --data-binary "$payload" \
  "$NET02_DEADMAN_WEBHOOK_URL" >/dev/null

echo "PASS: Cloudflare synchronization is ${age}s old and the dead-man heartbeat was accepted."
