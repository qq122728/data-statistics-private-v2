#!/usr/bin/env bash
set -euo pipefail

event="${1:-NET-02 failure}"
unit="${2:-unknown-unit}"
MONITOR_ENV_FILE="${NET02_MONITOR_ENV_FILE:-/etc/data-statistics/net02-monitor.env}"
[[ -f "$MONITOR_ENV_FILE" && ! -L "$MONITOR_ENV_FILE" \
  && "$(stat -c '%u:%g:%a' "$MONITOR_ENV_FILE")" == "0:0:600" ]] || {
  echo "ERROR: NET-02 monitor EnvironmentFile must be root:root mode 0600 and not a symlink" >&2
  exit 1
}
logger -p authpriv.err -t data-statistics-net02 -- "${event}: ${unit}"

[[ "${NET02_ALERT_WEBHOOK_URL:-}" == https://* ]] || {
  echo "ERROR: NET02_ALERT_WEBHOOK_URL must be an HTTPS URL" >&2
  exit 1
}

payload="$(python3 - "$event" "$unit" "$(hostname -f)" <<'PY'
import json
import sys
print(json.dumps({"event": sys.argv[1], "unit": sys.argv[2], "host": sys.argv[3]}))
PY
)"
curl --fail-with-body --silent --show-error --proto '=https' --connect-timeout 10 \
  --max-time 30 -H 'Content-Type: application/json' --data-binary "$payload" \
  "$NET02_ALERT_WEBHOOK_URL" >/dev/null
