#!/usr/bin/env bash

# Source this file from restore-rehearsal.sh. The function never signals a PID
# unless Linux /proc and postmaster.pid prove that it is the PostgreSQL
# postmaster created for this exact rehearsal run.
dr_cleanup_postgres() {
  local rehearsal_root="$1"
  local run_dir="$2"
  local data_dir="$3"
  local pg_ctl="$4"
  local postgres_log="$5"
  local cleanup_error_log="$6"
  local pidfd_stop_helper="$7"
  local run_basename postmaster_pid postmaster_data_dir postmaster_started_epoch
  local run_started_epoch now_epoch expected_postgres actual_postgres data_owner process_owner
  local process_start_ticks process_session confirmed_start_ticks confirmed_session
  local confirmed_pid confirmed_data_dir confirmed_postgres
  local has_pgdata_argument argument_index
  local -a postmaster_identity process_argv
  local stop_timeout_seconds="${DR_CLEANUP_STOP_TIMEOUT_SECONDS:-120}"

  run_basename="$(basename "$run_dir")"
  [[ "$data_dir" == "$run_dir/data" && "$run_dir" == "$rehearsal_root"/* \
    && "$run_basename" =~ ^20[0-9]{6}T[0-9]{6}Z-[0-9]+$ \
    && -d "$data_dir" && ! -L "$data_dir" ]] || {
    printf '%s unsafe rehearsal cleanup path rejected\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$cleanup_error_log"
    return 1
  }
  if [[ -e "$data_dir/postmaster.pid" || -L "$data_dir/postmaster.pid" ]]; then
    [[ -f "$data_dir/postmaster.pid" && ! -L "$data_dir/postmaster.pid" ]] || {
      printf '%s unsafe postmaster.pid; manual isolation cleanup required\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$cleanup_error_log"
      return 1
    }
  else
    dr_assert_rehearsal_run_inactive "$rehearsal_root" "$run_dir" "$cleanup_error_log" || return 1
    return 0
  fi
  [[ "$pidfd_stop_helper" == /usr/local/lib/data-statistics-dr/pidfd-stop-postgres.py \
    || "${DR_ALLOW_TEST_PIDFD_HELPER:-}" == YES ]] || {
    printf '%s unapproved pidfd cleanup helper path rejected\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$cleanup_error_log"
    return 1
  }
  [[ -f "$pidfd_stop_helper" && ! -L "$pidfd_stop_helper" \
    && "$stop_timeout_seconds" =~ ^[0-9]+$ \
    && "$stop_timeout_seconds" -ge 1 && "$stop_timeout_seconds" -le 300 ]] || {
    printf '%s pidfd cleanup helper or timeout is invalid\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$cleanup_error_log"
    return 1
  }

  mapfile -t postmaster_identity < <(sed -n '1,3p' "$data_dir/postmaster.pid" 2>/dev/null)
  postmaster_pid="${postmaster_identity[0]:-}"
  postmaster_data_dir="${postmaster_identity[1]:-}"
  postmaster_started_epoch="${postmaster_identity[2]:-}"
  if [[ ! "$postmaster_pid" =~ ^[1-9][0-9]*$ ]]; then
    printf '%s invalid postmaster.pid; manual isolation cleanup required\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$cleanup_error_log"
    return 1
  fi
  if [[ ! -d "/proc/$postmaster_pid" ]]; then
    printf '%s stale postmaster.pid %s found; no live process remained\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$postmaster_pid" >>"$postgres_log"
    return 0
  fi
  run_started_epoch="$(date -u -d "${run_basename:0:8} ${run_basename:9:2}:${run_basename:11:2}:${run_basename:13:2} UTC" +%s 2>/dev/null || true)"
  now_epoch="$(date -u +%s)"
  if [[ "$postmaster_data_dir" != "$data_dir" \
    || ! "$postmaster_started_epoch" =~ ^[1-9][0-9]{9}$ \
    || ! "$run_started_epoch" =~ ^[1-9][0-9]{9}$ \
    || "$postmaster_started_epoch" -lt "$run_started_epoch" \
    || "$postmaster_started_epoch" -gt $((now_epoch + 5)) ]]; then
    printf '%s pid %s has postmaster identity outside this rehearsal run; refusing unsafe signal\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$postmaster_pid" >>"$cleanup_error_log"
    return 1
  fi
  expected_postgres="$(readlink -f -- "$(dirname -- "$pg_ctl")/postgres" 2>/dev/null || true)"
  actual_postgres="$(readlink -f -- "/proc/$postmaster_pid/exe" 2>/dev/null || true)"
  if [[ -z "$expected_postgres" || ! -x "$expected_postgres" || "$actual_postgres" != "$expected_postgres" ]]; then
    printf '%s pid %s is not the PostgreSQL executable paired with pg_ctl; refusing unsafe signal\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$postmaster_pid" >>"$cleanup_error_log"
    return 1
  fi
  data_owner="$(stat -c '%u' "$data_dir" 2>/dev/null || true)"
  process_owner="$(awk '/^Uid:/ { print $3; exit }' "/proc/$postmaster_pid/status" 2>/dev/null || true)"
  if [[ -z "$data_owner" || "$process_owner" != "$data_owner" ]]; then
    printf '%s pid %s owner does not match the rehearsal data directory; refusing unsafe signal\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$postmaster_pid" >>"$cleanup_error_log"
    return 1
  fi
  mapfile -d '' -t process_argv <"/proc/$postmaster_pid/cmdline" || {
    printf '%s pid %s command line is unreadable; refusing unsafe signal\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$postmaster_pid" >>"$cleanup_error_log"
    return 1
  }
  has_pgdata_argument=false
  for ((argument_index = 0; argument_index < ${#process_argv[@]}; argument_index++)); do
    if [[ "${process_argv[$argument_index]}" == "-D" \
      && "${process_argv[$((argument_index + 1))]:-}" == "$data_dir" ]]; then
      has_pgdata_argument=true
      break
    fi
    if [[ "${process_argv[$argument_index]}" == "-D$data_dir" \
      || "${process_argv[$argument_index]}" == "--pgdata=$data_dir" ]]; then
      has_pgdata_argument=true
      break
    fi
  done
  if [[ "$has_pgdata_argument" != true ]]; then
    printf '%s pid %s lacks the exact rehearsal PostgreSQL data argument; refusing unsafe signal\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$postmaster_pid" >>"$cleanup_error_log"
    return 1
  fi
  process_start_ticks="$(awk '{ print $22 }' "/proc/$postmaster_pid/stat" 2>/dev/null || true)"
  process_session="$(awk '{ print $6 }' "/proc/$postmaster_pid/stat" 2>/dev/null || true)"
  [[ "$process_start_ticks" =~ ^[0-9]+$ && "$process_session" == "$postmaster_pid" ]] || {
    printf '%s pid %s is not the recorded PostgreSQL session leader; refusing unsafe signal\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$postmaster_pid" >>"$cleanup_error_log"
    return 1
  }

  # Reconfirm before handing the identity to the pidfd helper. The helper opens
  # a pidfd first, repeats these checks against that pinned kernel process, and
  # sends SIGINT through the pidfd. We do not claim shell checks close the race.
  confirmed_pid="$(sed -n '1p' "$data_dir/postmaster.pid" 2>/dev/null || true)"
  confirmed_data_dir="$(sed -n '2p' "$data_dir/postmaster.pid" 2>/dev/null || true)"
  confirmed_postgres="$(readlink -f -- "/proc/$postmaster_pid/exe" 2>/dev/null || true)"
  confirmed_start_ticks="$(awk '{ print $22 }' "/proc/$postmaster_pid/stat" 2>/dev/null || true)"
  confirmed_session="$(awk '{ print $6 }' "/proc/$postmaster_pid/stat" 2>/dev/null || true)"
  if [[ "$confirmed_pid" != "$postmaster_pid" || "$confirmed_data_dir" != "$data_dir" \
    || "$confirmed_postgres" != "$expected_postgres" || "$confirmed_start_ticks" != "$process_start_ticks" \
    || "$confirmed_session" != "$postmaster_pid" ]]; then
    printf '%s pid %s identity changed before cleanup; refusing unsafe signal\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$postmaster_pid" >>"$cleanup_error_log"
    return 1
  fi
  if ! python3 "$pidfd_stop_helper" --pid "$postmaster_pid" --data-dir "$data_dir" \
    --expected-postgres "$expected_postgres" --expected-start-ticks "$process_start_ticks" \
    --timeout-seconds "$stop_timeout_seconds" >>"$postgres_log" 2>&1; then
    printf '%s exact pidfd PostgreSQL stop failed for pid %s; manual isolation cleanup required\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$postmaster_pid" >>"$cleanup_error_log"
    return 1
  fi
}

# Retention is intentionally stricter than cleanup. A candidate with any PID
# file (live, stale, malformed, or unknown) requires manual review. With no PID
# file, Linux /proc must also show no process carrying the exact data path.
dr_assert_rehearsal_run_inactive() {
  local rehearsal_root="$1"
  local candidate="$2"
  local cleanup_error_log="$3"
  local data_dir data_owner proc_path process_pid proc_owner argument
  local -a argv

  [[ "$candidate" == "$rehearsal_root"/20* && -d "$candidate" && ! -L "$candidate" \
    && "$(basename "$candidate")" =~ ^20[0-9]{6}T[0-9]{6}Z-[0-9]+$ ]] || {
    printf '%s unsafe rehearsal retention candidate rejected: %s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$candidate" >>"$cleanup_error_log"
    return 1
  }
  data_dir="$candidate/data"
  [[ -d "$data_dir" && ! -L "$data_dir" ]] || {
    printf '%s rehearsal retention data directory is missing or unsafe: %s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$candidate" >>"$cleanup_error_log"
    return 1
  }
  data_owner="$(stat -c '%u' "$data_dir")"
  if [[ -e "$data_dir/postmaster.pid" || -L "$data_dir/postmaster.pid" ]]; then
    printf '%s rehearsal retention candidate has a live, stale, or unknown postmaster.pid: %s\n' \
      "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$candidate" >>"$cleanup_error_log"
    return 1
  fi
  for proc_path in /proc/[0-9]*; do
    process_pid="${proc_path##*/}"
    proc_owner="$(stat -c '%u' "$proc_path" 2>/dev/null || true)"
    if [[ ! -r "$proc_path/cmdline" ]]; then
      if [[ "$proc_owner" == "$data_owner" ]]; then
        printf '%s same-owner process %s is unreadable while checking retention candidate %s\n' \
          "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$process_pid" "$candidate" >>"$cleanup_error_log"
        return 1
      fi
      continue
    fi
    mapfile -d '' -t argv <"$proc_path/cmdline" 2>/dev/null || {
      [[ ! -e "$proc_path" ]] && continue
      printf '%s cannot prove process %s is unrelated to retention candidate %s\n' \
        "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$process_pid" "$candidate" >>"$cleanup_error_log"
      return 1
    }
    for argument in "${argv[@]}"; do
      if [[ "$argument" == "$data_dir" || "$argument" == "-D$data_dir" \
        || "$argument" == "--pgdata=$data_dir" || "$argument" == "$data_dir"/* ]]; then
        printf '%s live process %s references rehearsal retention candidate %s\n' \
          "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$process_pid" "$candidate" >>"$cleanup_error_log"
        return 1
      fi
    done
  done
}
