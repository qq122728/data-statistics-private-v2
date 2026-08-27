#!/usr/bin/env bash
set -euo pipefail

lookback_seconds="${LOG02_SUPPRESSION_LOOKBACK_SECONDS:-600}"
[[ "$lookback_seconds" =~ ^[0-9]+$ \
  && "$lookback_seconds" -ge 60 \
  && "$lookback_seconds" -le 86400 ]] || {
  logger -p daemon.alert -t data-statistics-log-monitor \
    'event=LOG_SUPPRESSION_CHECK_INVALID result=failure'
  exit 2
}

since_epoch="$(( $(date -u +%s) - lookback_seconds ))"
suppressed_count="$({
  journalctl --quiet --since "@${since_epoch}" --no-pager --output=json
} | python3 -c '
import json
import re
import sys

pattern = re.compile(r"\bdata-statistics\.service\b.*\bSuppressed ([1-9][0-9]*) messages?\b", re.I)
count = 0
for line in sys.stdin:
    try:
        message = json.loads(line).get("MESSAGE", "")
    except (json.JSONDecodeError, AttributeError) as error:
        raise SystemExit("journalctl returned malformed JSON") from error
    match = pattern.search(str(message))
    if match:
        count += int(match.group(1))
print(count)
')"

[[ "$suppressed_count" =~ ^[0-9]+$ ]] || {
  logger -p daemon.alert -t data-statistics-log-monitor \
    'event=LOG_SUPPRESSION_CHECK_FAILED result=failure'
  exit 2
}
if (( suppressed_count > 0 )); then
  logger -p daemon.alert -t data-statistics-log-monitor \
    "event=LOG_MESSAGES_SUPPRESSED result=failure count=${suppressed_count} lookback_seconds=${lookback_seconds}"
  exit 1
fi
logger -p daemon.info -t data-statistics-log-monitor \
  "event=LOG_SUPPRESSION_OK result=success lookback_seconds=${lookback_seconds}"
