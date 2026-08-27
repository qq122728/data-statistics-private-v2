#!/usr/bin/env bash
set -euo pipefail

port=3001
expected_user="data-statistics"
deploy_root="${DEPLOY_ROOT:-/opt/data-statistics}"
confirmation=""
expected_pid=""
expected_release_input=""
expected_starttime=""
proc_root="${OPS02_PROC_ROOT:-/proc}"
cgroup_root="${OPS02_CGROUP_ROOT:-/sys/fs/cgroup}"
ss_bin="${OPS02_SS_BIN:-ss}"
systemctl_bin="${OPS02_SYSTEMCTL_BIN:-systemctl}"
loginctl_bin="${OPS02_LOGINCTL_BIN:-loginctl}"
nginx_bin="${OPS02_NGINX_BIN:-nginx}"

cleanup_abandoned_session() {
  local cleanup_session_id="$1"
  local cleanup_session_scope="$2"
  local cleanup_cgroup_path="$3"
  local mapped_scope scope_substate cgroup_procs remaining

  mapped_scope="$($loginctl_bin show-session "$cleanup_session_id" -p Scope --value 2>/dev/null || true)"
  if [[ -z "$mapped_scope" ]]; then
    return 0
  fi
  scope_substate="$($systemctl_bin show "$cleanup_session_scope" -p SubState --value 2>/dev/null || true)"
  [[ "$mapped_scope" == "$cleanup_session_scope" && "$scope_substate" == "abandoned" ]] || {
    echo "ERROR: session identity changed after stop; refusing session cleanup" >&2
    return 1
  }

  cgroup_procs="${cgroup_root}${cleanup_cgroup_path}/cgroup.procs"
  [[ -f "$cgroup_procs" && -r "$cgroup_procs" ]] || {
    echo "ERROR: unable to read ${cgroup_procs}; refusing session cleanup" >&2
    return 1
  }
  if ! remaining="$(tr '\n' ' ' <"$cgroup_procs")"; then
    echo "ERROR: failed to read ${cgroup_procs}; refusing session cleanup" >&2
    return 1
  fi
  [[ -z "${remaining// /}" ]] || {
    echo "ERROR: ${cleanup_session_scope} still contains processes (${remaining}); refusing session cleanup" >&2
    return 1
  }
  "$loginctl_bin" terminate-session "$cleanup_session_id"
}

# Unit tests source this file to exercise the fail-closed session cleanup
# helper without sending a signal. Normal execution continues below.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

usage() {
  echo "Usage: sudo $0 --expected-pid PID --expected-release NAME_OR_PATH --expected-starttime TICKS [--confirm OPS-02-STOP-3001]"
  echo "Without the exact confirmation value this script performs validation only."
}

while (($#)); do
  case "$1" in
    --port) port="${2:-}"; shift 2 ;;
    --user) expected_user="${2:-}"; shift 2 ;;
    --expected-pid) expected_pid="${2:-}"; shift 2 ;;
    --expected-release) expected_release_input="${2:-}"; shift 2 ;;
    --expected-starttime) expected_starttime="${2:-}"; shift 2 ;;
    --confirm) confirmation="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$port" == "3001" ]] || { echo "ERROR: OPS-02 is intentionally restricted to TCP 3001" >&2; exit 2; }
[[ "$expected_pid" =~ ^[1-9][0-9]*$ ]] || { echo "ERROR: --expected-pid is required" >&2; exit 2; }
[[ -n "$expected_release_input" ]] || { echo "ERROR: --expected-release is required" >&2; exit 2; }
[[ "$expected_starttime" =~ ^[1-9][0-9]*$ ]] || { echo "ERROR: --expected-starttime is required" >&2; exit 2; }

release_root="$(readlink -f "${deploy_root}/releases")"
if [[ "$expected_release_input" == */* ]]; then
  expected_release="$(readlink -f "$expected_release_input")"
else
  expected_release="$(readlink -f "${release_root}/${expected_release_input}")"
fi
[[ -d "$expected_release" && "$(dirname "$expected_release")" == "$release_root" ]] || {
  echo "ERROR: expected release must be a direct child of ${release_root}" >&2
  exit 2
}

process_starttime() {
  local process_pid="$1" remainder
  remainder="$(sed -E 's/^[0-9]+ \(.*\) //' "${proc_root}/${process_pid}/stat")"
  awk '{print $20}' <<<"$remainder"
}

process_cgroup_path() {
  local process_pid="$1"
  awk -F: '$1 == "0" { print $3; exit }' "${proc_root}/${process_pid}/cgroup"
}

process_owner() {
  local process_pid="$1"
  if stat -c '%U' "${proc_root}/${process_pid}" 2>/dev/null; then
    return
  fi
  stat -f '%Su' "${proc_root}/${process_pid}"
}

validate_session_cgroup() {
  local cgroup_path="$1" component scope_count=0 mapped_scope scope_substate
  session_scope=""
  session_id=""
  IFS='/' read -r -a components <<<"$cgroup_path"
  for component in "${components[@]}"; do
    [[ -n "$component" ]] || continue
    if [[ "$component" == *.service ]]; then
      echo "ERROR: process belongs to managed service cgroup ${component}" >&2
      return 1
    fi
    if [[ "$component" == *.scope ]]; then
      if [[ "$component" =~ ^session-([0-9]+)\.scope$ ]]; then
        session_scope="$component"
        session_id="${BASH_REMATCH[1]}"
        ((scope_count += 1))
      else
        echo "ERROR: process belongs to non-session scope ${component}" >&2
        return 1
      fi
    fi
  done
  [[ "$scope_count" -eq 1 ]] || { echo "ERROR: expected exactly one session-*.scope cgroup" >&2; return 1; }

  mapped_scope="$($loginctl_bin show-session "$session_id" -p Scope --value 2>/dev/null || true)"
  scope_substate="$($systemctl_bin show "$session_scope" -p SubState --value 2>/dev/null || true)"
  [[ "$mapped_scope" == "$session_scope" ]] || { echo "ERROR: login session does not map to ${session_scope}" >&2; return 1; }
  # "abandoned" is systemd's scope SubState. loginctl maps the numeric login
  # session to that scope but does not expose an "abandoned" session State.
  [[ "$scope_substate" == "abandoned" ]] || {
    echo "ERROR: ${session_scope} is not abandoned (SubState=${scope_substate:-unknown})" >&2
    return 1
  }
}

validate_process_identity() {
  local process_pid="$1" owner cwd current cmd starttime cgroup_path listener_pids
  [[ -d "${proc_root}/${process_pid}" ]] || { echo "ERROR: PID ${process_pid} no longer exists" >&2; return 1; }
  owner="$(process_owner "$process_pid")"
  cwd="$(readlink -f "${proc_root}/${process_pid}/cwd")"
  current="$(readlink -f "${deploy_root}/app")"
  cmd="$(tr '\0' ' ' <"${proc_root}/${process_pid}/cmdline")"
  starttime="$(process_starttime "$process_pid")"
  cgroup_path="$(process_cgroup_path "$process_pid")"

  [[ "$owner" == "$expected_user" ]] || { echo "ERROR: listener owner is ${owner}, not ${expected_user}" >&2; return 1; }
  [[ "$cwd" == "$expected_release" ]] || { echo "ERROR: PID cwd ${cwd} does not match approved release ${expected_release}" >&2; return 1; }
  [[ "$cwd" != "$current" ]] || { echo "ERROR: refusing to stop a process from the current release" >&2; return 1; }
  [[ "$starttime" == "$expected_starttime" ]] || { echo "ERROR: PID starttime changed (${starttime} != ${expected_starttime})" >&2; return 1; }
  [[ "$cmd" == *next-server* ]] || { echo "ERROR: listener is not a Next.js server" >&2; return 1; }
  validate_session_cgroup "$cgroup_path" || return 1

  listener_pids="$($ss_bin -H -lntp "sport = :${port}" | grep -Eo 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
  [[ "$listener_pids" == "$process_pid" ]] || {
    echo "ERROR: TCP ${port} listener no longer matches approved PID ${process_pid}" >&2
    return 1
  }
  validated_cgroup_path="$cgroup_path"
}

pids=()
while IFS= read -r found_pid; do
  [[ -n "$found_pid" ]] && pids+=("$found_pid")
done < <($ss_bin -H -lntp "sport = :${port}" | grep -Eo 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)
if ((${#pids[@]} != 1)); then
  echo "ERROR: expected exactly one listener on TCP ${port}; found ${#pids[@]}" >&2
  exit 1
fi

pid="${pids[0]}"
[[ "$pid" == "$expected_pid" ]] || { echo "ERROR: listener PID ${pid} is not approved PID ${expected_pid}" >&2; exit 1; }
validate_process_identity "$pid"

connections="$($ss_bin -H -ntp | awk -v suffix=":${port}" '$4 ~ suffix "$" || $5 ~ suffix "$"')"
[[ -z "$connections" ]] || { echo "ERROR: active TCP ${port} connections exist; investigate before stopping" >&2; exit 1; }

nginx_config="$($nginx_bin -T 2>/dev/null)" || { echo "ERROR: unable to inspect complete Nginx configuration" >&2; exit 1; }
if grep -Ev '^[[:space:]]*#' <<<"$nginx_config" | grep -Eq "(^|[^0-9])${port}([^0-9]|$)"; then
  echo "ERROR: Nginx configuration references ${port}, directly or through an upstream" >&2
  exit 1
fi

echo "Validated abandoned-session candidate: PID=${pid}, release=${expected_release}, starttime=${expected_starttime}, scope=${session_scope}"
if [[ "$confirmation" != "OPS-02-STOP-3001" ]]; then
  echo "DRY RUN: no signal sent. Re-run with the same expected identity and --confirm OPS-02-STOP-3001 after approval."
  exit 0
fi

[[ "$EUID" -eq 0 ]] || { echo "ERROR: confirmed stop must run as root" >&2; exit 1; }
if [[ -n "${OPS02_PROC_ROOT:-}${OPS02_CGROUP_ROOT:-}${OPS02_SS_BIN:-}${OPS02_SYSTEMCTL_BIN:-}${OPS02_LOGINCTL_BIN:-}${OPS02_NGINX_BIN:-}" ]]; then
  echo "ERROR: command and proc/cgroup overrides are forbidden in confirmed mode" >&2
  exit 1
fi
[[ "$expected_user" == "data-statistics" ]] || { echo "ERROR: confirmed stop is restricted to data-statistics" >&2; exit 1; }
# Close the validation-to-signal window: PID numbers can be reused after exit.
validate_process_identity "$pid"
kill -TERM "$pid"
for _ in {1..30}; do
  kill -0 "$pid" 2>/dev/null || break
  sleep 1
done

if kill -0 "$pid" 2>/dev/null; then
  echo "ERROR: PID ${pid} did not stop after 30 seconds; no SIGKILL was sent" >&2
  exit 1
fi
if $ss_bin -H -lntp "sport = :${port}" | grep -q .; then
  echo "ERROR: TCP ${port} is still listening after PID ${pid} stopped" >&2
  exit 1
fi

# Clean the stale login record only when the exact abandoned session remains
# and a successful cgroup.procs read proves that it contains no processes.
# Missing, unreadable, or failed reads refuse cleanup instead of treating an
# unknown state as empty.
cleanup_abandoned_session "$session_id" "$session_scope" "$validated_cgroup_path"
echo "Stopped approved PID ${pid}; TCP ${port} is no longer listening; abandoned session cleanup completed."
