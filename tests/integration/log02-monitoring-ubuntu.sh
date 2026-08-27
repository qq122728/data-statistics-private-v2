#!/usr/bin/env bash
set -euo pipefail

[[ "$(uname -s)" == Linux ]] || { echo "SKIP: LOG-02 Ubuntu monitoring test"; exit 0; }
[[ ${EUID} -eq 0 ]] || { echo "ERROR: LOG-02 Ubuntu monitoring test must run as root" >&2; exit 1; }
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_dir="$(mktemp -d /tmp/log02-monitoring.XXXXXX)"
trap 'rm -rf -- "$test_dir"' EXIT
mock_bin="$test_dir/bin"
mock_log="$test_dir/mock.log"
mkdir -p "$mock_bin"

cat >"$mock_bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >>"$MOCK_LOG"
SH
cat >"$mock_bin/logger" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'logger %s\n' "$*" >>"$MOCK_LOG"
SH
cat >"$mock_bin/journalctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${MOCK_JOURNAL_LINE:?MOCK_JOURNAL_LINE is required}"
SH
chmod 0755 "$mock_bin"/*

monitor_env="$test_dir/log-monitor.env"
install -o root -g root -m 0600 "$repo_root/ops/systemd/log-monitor.env.example" "$monitor_env"
common=(
  PATH="$mock_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  MOCK_LOG="$mock_log"
  LOG02_MONITOR_ENV_FILE="$monitor_env"
  LOG02_ALERT_WEBHOOK_URL=https://monitoring.example.invalid/log-alert
)

env "${common[@]}" "$repo_root/ops/scripts/send-data-statistics-log-alert.sh" acceptance acceptance.service
grep -Fq 'https://monitoring.example.invalid/log-alert' "$mock_log"
grep -Fq 'acceptance.service' "$mock_log"

bad_monitor_env="$test_dir/bad-log-monitor.env"
install -o root -g root -m 0644 "$repo_root/ops/systemd/log-monitor.env.example" "$bad_monitor_env"
if env "${common[@]}" LOG02_MONITOR_ENV_FILE="$bad_monitor_env" \
  "$repo_root/ops/scripts/send-data-statistics-log-alert.sh" acceptance acceptance.service \
  2>"$test_dir/bad-monitor.err"; then
  echo 'ERROR: insecure LOG-02 monitor EnvironmentFile mode was accepted' >&2
  exit 1
fi
grep -Fq 'root:root mode 0600' "$test_dir/bad-monitor.err"

env "${common[@]}" MOCK_JOURNAL_LINE='{"MESSAGE":"no suppression event"}' \
  "$repo_root/ops/scripts/check-journal-suppression.sh"
if env "${common[@]}" \
  MOCK_JOURNAL_LINE='{"MESSAGE":"data-statistics.service: Suppressed 7 messages from stdout/stderr"}' \
  "$repo_root/ops/scripts/check-journal-suppression.sh"; then
  echo 'ERROR: suppressed application messages were accepted' >&2
  exit 1
fi
grep -Fq 'event=LOG_MESSAGES_SUPPRESSED' "$mock_log"
if env "${common[@]}" MOCK_JOURNAL_LINE='not-json' \
  "$repo_root/ops/scripts/check-journal-suppression.sh" 2>"$test_dir/malformed.err"; then
  echo 'ERROR: malformed journal JSON was accepted' >&2
  exit 1
fi
grep -Fq 'journalctl returned malformed JSON' "$test_dir/malformed.err"

echo 'PASS: LOG-02 external alert and suppression monitoring behavior succeeded.'
