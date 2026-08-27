#!/usr/bin/env bash
set -euo pipefail

event="${1:-LOG-02 monitoring failure}"
unit="${2:-unknown-unit}"
monitor_env_file="${LOG02_MONITOR_ENV_FILE:-/etc/data-statistics/log-monitor.env}"

[[ -f "$monitor_env_file" && ! -L "$monitor_env_file" \
  && "$(stat -c '%u:%g:%a' "$monitor_env_file")" == "0:0:600" ]] || {
  echo "ERROR: LOG-02 monitor EnvironmentFile must be root:root mode 0600 and not a symlink" >&2
  exit 1
}
[[ "${LOG02_ALERT_WEBHOOK_URL:-}" == https://* ]] || {
  echo "ERROR: LOG02_ALERT_WEBHOOK_URL must be an HTTPS URL" >&2
  exit 1
}

logger -p daemon.alert -t data-statistics-log-monitor -- "${event}: ${unit}" || true
payload="$(python3 - "$event" "$unit" "$(hostname -f)" <<'PY'
import json
import sys
print(json.dumps({"event": sys.argv[1], "unit": sys.argv[2], "host": sys.argv[3]}))
PY
)"
curl --fail-with-body --silent --show-error --proto '=https' --connect-timeout 10 \
  --max-time 30 -H 'Content-Type: application/json' --data-binary "$payload" \
  "$LOG02_ALERT_WEBHOOK_URL" >/dev/null
