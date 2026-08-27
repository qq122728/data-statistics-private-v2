#!/usr/bin/env bash
set -euo pipefail

[[ "$(uname -s)" == "Linux" ]] || { echo "restore cleanup dynamic test requires Linux" >&2; exit 77; }
command -v timeout >/dev/null

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=restore-cleanup.sh
source "$SCRIPT_DIR/restore-cleanup.sh"

test_root="$(mktemp -d)"
owned_pid=""
unrelated_pid=""
forged_pid=""
race_pid=""
race_unrelated_pid=""
retention_pid=""
cleanup_test_processes() {
  [[ -z "$owned_pid" ]] || kill "$owned_pid" >/dev/null 2>&1 || true
  [[ -z "$unrelated_pid" ]] || kill "$unrelated_pid" >/dev/null 2>&1 || true
  [[ -z "$forged_pid" ]] || kill "$forged_pid" >/dev/null 2>&1 || true
  [[ -z "$race_pid" ]] || kill "$race_pid" >/dev/null 2>&1 || true
  [[ -z "$race_unrelated_pid" ]] || kill "$race_unrelated_pid" >/dev/null 2>&1 || true
  [[ -z "$retention_pid" ]] || kill "$retention_pid" >/dev/null 2>&1 || true
  rm -rf -- "$test_root"
}
trap cleanup_test_processes EXIT

run_id="$(date -u +%Y%m%dT%H%M%SZ)-123"
run_dir="$test_root/$run_id"
data_dir="$run_dir/data"
mkdir -p "$data_dir"
fake_pg_ctl="$test_root/fake-pg-ctl"
pidfd_helper="$SCRIPT_DIR/pidfd-stop-postgres.py"
ln -s "$(command -v python3)" "$test_root/postgres"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'data_dir=""' \
  'for ((i=1; i<=$#; i++)); do if [[ "${!i}" == "-D" ]]; then j=$((i+1)); data_dir="${!j}"; fi; done' \
  'if [[ "${*: -1}" == "start" ]]; then' \
  '  "$(dirname "$0")/postgres" -c '\''import os,signal,sys,time; os.setsid(); signal.signal(signal.SIGINT, lambda *_: sys.exit(0)); time.sleep(300)'\'' -- -D "$data_dir" &' \
  '  child=$!' \
  '  printf '\''%s\n%s\n%s\n'\'' "$child" "$data_dir" "$(date -u +%s)" >"$data_dir/postmaster.pid"' \
  '  while :; do :; done' \
  'else' \
  '  printf '\''stop\n'\'' >>"$(dirname "$0")/pg-ctl-stop.log"' \
  '  pid="$(head -n 1 "$data_dir/postmaster.pid")"' \
  '  kill "$pid"' \
  '  for _ in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.01; done' \
  '  rm -f -- "$data_dir/postmaster.pid"' \
  'fi' >"$fake_pg_ctl"
chmod 0755 "$fake_pg_ctl"

set +e
timeout --foreground --signal=TERM --kill-after=0.1s 0.2s "$fake_pg_ctl" -D "$data_dir" start
start_code=$?
set -e
[[ "$start_code" -eq 124 ]]
owned_pid="$(head -n 1 "$data_dir/postmaster.pid")"
kill -0 "$owned_pid"
DR_ALLOW_TEST_PIDFD_HELPER=YES DR_CLEANUP_STOP_TIMEOUT_SECONDS=3 \
  dr_cleanup_postgres "$test_root" "$run_dir" "$data_dir" "$fake_pg_ctl" "$run_dir/postgresql.log" "$run_dir/cleanup-error.log" "$pidfd_helper"
for _ in $(seq 1 100); do kill -0 "$owned_pid" 2>/dev/null || break; sleep 0.01; done
! kill -0 "$owned_pid" 2>/dev/null
owned_pid=""

sleep 300 &
unrelated_pid=$!
printf '%s\n%s\n%s\n' "$unrelated_pid" "$data_dir" "$(date -u +%s)" >"$data_dir/postmaster.pid"
set +e
DR_ALLOW_TEST_PIDFD_HELPER=YES DR_CLEANUP_STOP_TIMEOUT_SECONDS=1 \
  dr_cleanup_postgres "$test_root" "$run_dir" "$data_dir" "$fake_pg_ctl" "$run_dir/postgresql.log" "$run_dir/cleanup-error.log" "$pidfd_helper"
unrelated_cleanup_code=$?
set -e
[[ "$unrelated_cleanup_code" -ne 0 ]]
kill -0 "$unrelated_pid"
kill "$unrelated_pid"
wait "$unrelated_pid" 2>/dev/null || true
unrelated_pid=""

# A non-PostgreSQL process is not owned merely because its command line embeds
# the rehearsal data path. pg_ctl must never be invoked for this forged PID.
bash -c 'while :; do :; done' "$data_dir" &
forged_pid=$!
printf '%s\n%s\n%s\n' "$forged_pid" "$data_dir" "$(date -u +%s)" >"$data_dir/postmaster.pid"
: >"$test_root/pg-ctl-stop.log"
set +e
DR_ALLOW_TEST_PIDFD_HELPER=YES DR_CLEANUP_STOP_TIMEOUT_SECONDS=1 \
  dr_cleanup_postgres "$test_root" "$run_dir" "$data_dir" "$fake_pg_ctl" "$run_dir/postgresql.log" "$run_dir/cleanup-error.log" "$pidfd_helper"
forged_cleanup_code=$?
set -e
[[ "$forged_cleanup_code" -ne 0 ]]
kill -0 "$forged_pid"
[[ ! -s "$test_root/pg-ctl-stop.log" ]]
kill "$forged_pid"
wait "$forged_pid" 2>/dev/null || true
forged_pid=""

# Pin the intended process, then change postmaster.pid during the test delay.
# The helper must fail without signaling either the pinned or replacement PID.
"$test_root/postgres" -c 'import os,signal,sys,time; os.setsid(); signal.signal(signal.SIGINT, lambda *_: sys.exit(0)); time.sleep(300)' -- -D "$data_dir" &
race_pid=$!
sleep 0.05
printf '%s\n%s\n%s\n' "$race_pid" "$data_dir" "$(date -u +%s)" >"$data_dir/postmaster.pid"
race_start_ticks="$(awk '{ print $22 }' "/proc/$race_pid/stat")"
sleep 300 &
race_unrelated_pid=$!
set +e
python3 "$pidfd_helper" --pid "$race_pid" --data-dir "$data_dir" \
  --expected-postgres "$test_root/postgres" --expected-start-ticks "$race_start_ticks" \
  --timeout-seconds 1 --test-delay-ms 500 >"$test_root/race.log" 2>&1 &
helper_pid=$!
sleep 0.1
printf '%s\n%s\n%s\n' "$race_unrelated_pid" "$data_dir" "$(date -u +%s)" >"$data_dir/postmaster.pid"
wait "$helper_pid"
race_code=$?
set -e
[[ "$race_code" -ne 0 ]]
kill -0 "$race_pid"
kill -0 "$race_unrelated_pid"
kill "$race_pid" "$race_unrelated_pid"
wait "$race_pid" "$race_unrelated_pid" 2>/dev/null || true
race_pid=""
race_unrelated_pid=""
rm -f -- "$data_dir/postmaster.pid"

# Retention permits a quiescent run, but rejects both an unknown PID file and a
# live process that references the candidate data directory without a PID file.
candidate="$test_root/$(date -u -d '1 day ago' +%Y%m%dT%H%M%SZ)-999"
candidate_data="$candidate/data"
mkdir -p "$candidate_data"
dr_assert_rehearsal_run_inactive "$test_root" "$candidate" "$run_dir/cleanup-error.log"
printf 'not-a-pid\n' >"$candidate_data/postmaster.pid"
set +e
dr_assert_rehearsal_run_inactive "$test_root" "$candidate" "$run_dir/cleanup-error.log"
unknown_candidate_code=$?
set -e
[[ "$unknown_candidate_code" -ne 0 ]]
rm -f -- "$candidate_data/postmaster.pid"
bash -c 'while :; do :; done' "$candidate_data" &
retention_pid=$!
set +e
dr_assert_rehearsal_run_inactive "$test_root" "$candidate" "$run_dir/cleanup-error.log"
live_candidate_code=$?
set -e
[[ "$live_candidate_code" -ne 0 ]]
kill -0 "$retention_pid"
kill "$retention_pid"
wait "$retention_pid" 2>/dev/null || true
retention_pid=""

# The same lock used by the restore script must reject a concurrent holder.
lock_file="$test_root/.restore.lock"
exec 8>"$lock_file"
flock -n 8
set +e
(exec 9>"$lock_file"; flock -n 9)
concurrent_lock_code=$?
set -e
[[ "$concurrent_lock_code" -ne 0 ]]
flock -u 8

echo "restore cleanup dynamic tests passed"
