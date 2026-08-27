#!/usr/bin/env bash
set -euo pipefail

readonly LOG_PATH="/var/log"
readonly MAX_PERCENT="${DATA_STATISTICS_LOG_MAX_PERCENT:-80}"

if ! [[ "$MAX_PERCENT" =~ ^[0-9]+$ ]] || (( MAX_PERCENT < 1 || MAX_PERCENT > 99 )); then
  logger -p daemon.alert -t data-statistics-log-capacity 'event=LOG_CAPACITY_CHECK_INVALID result=failure'
  exit 2
fi

used_percent="$(df -P "$LOG_PATH" | awk 'NR == 2 {gsub(/%/, "", $5); print $5}')"
if ! [[ "$used_percent" =~ ^[0-9]+$ ]]; then
  logger -p daemon.alert -t data-statistics-log-capacity 'event=LOG_CAPACITY_CHECK_FAILED result=failure'
  exit 2
fi

if (( used_percent >= MAX_PERCENT )); then
  logger -p daemon.alert -t data-statistics-log-capacity \
    "event=LOG_CAPACITY_HIGH result=failure used_percent=${used_percent} threshold_percent=${MAX_PERCENT}"
  exit 1
fi

logger -p daemon.info -t data-statistics-log-capacity \
  "event=LOG_CAPACITY_OK result=success used_percent=${used_percent} threshold_percent=${MAX_PERCENT}"
