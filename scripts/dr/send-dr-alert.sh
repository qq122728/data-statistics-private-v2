#!/usr/bin/env bash
set -euo pipefail

unit="${1:-unknown-unit}"
event="${2:-backup-or-restore-failure}"
logger -p authpriv.err -t data-statistics-dr -- "unit=$unit event=$event"

: "${DR_ALERT_WEBHOOK_URL:?DR alert webhook is not configured; failure recorded in authpriv}"

payload="$(python3 - "$unit" "$event" <<'PY'
import json
import socket
import sys
print(json.dumps({"service":"data-statistics-dr","host":socket.gethostname(),"unit":sys.argv[1],"event":sys.argv[2]}))
PY
)"
curl --fail-with-body --silent --show-error --max-time 15 \
  -H 'Content-Type: application/json' --data "$payload" "$DR_ALERT_WEBHOOK_URL" >/dev/null
