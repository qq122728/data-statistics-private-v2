#!/usr/bin/env bash
set -euo pipefail

deploy_root="${DEPLOY_ROOT:-/opt/data-statistics}"
releases_root="${RELEASES_ROOT:-${deploy_root}/releases}"
current_link="${CURRENT_LINK:-${deploy_root}/app}"
proc_root="${OPS02_PROC_ROOT:-/proc}"
systemctl_bin="${OPS02_SYSTEMCTL_BIN:-systemctl}"
curl_bin="${OPS02_CURL_BIN:-curl}"
ss_bin="${OPS02_SS_BIN:-ss}"
prune_script="${OPS02_PRUNE_SCRIPT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/prune-releases.sh}"
keep=8
rollback_input=""
apply=false
confirmation=""

usage() {
  echo "Usage: sudo $0 --rollback-release NAME_OR_PATH [--keep 5..10] [--apply --confirm OPS-02-POST-DEPLOY]"
  echo "Default mode validates the deployed service and previews release cleanup."
}

while (($#)); do
  case "$1" in
    --rollback-release) rollback_input="${2:-}"; shift 2 ;;
    --keep) keep="${2:-}"; shift 2 ;;
    --apply) apply=true; shift ;;
    --confirm) confirmation="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ -n "$rollback_input" ]] || { echo "ERROR: --rollback-release is required" >&2; exit 2; }
[[ "$keep" =~ ^[0-9]+$ ]] && ((keep >= 5 && keep <= 10)) || {
  echo "ERROR: --keep must be between 5 and 10" >&2
  exit 2
}
if $apply; then
  [[ "$confirmation" == "OPS-02-POST-DEPLOY" ]] || {
    echo "ERROR: apply mode requires --confirm OPS-02-POST-DEPLOY" >&2
    exit 1
  }
  if [[ "$EUID" -ne 0 ]]; then
    [[ "${OPS02_TEST_ALLOW_UNPRIVILEGED:-}" == "1" && "$releases_root" != "/opt/data-statistics/releases" ]] || {
      echo "ERROR: apply mode must run as root" >&2
      exit 1
    }
  else
    deploy_root="/opt/data-statistics"
    releases_root="/opt/data-statistics/releases"
    current_link="/opt/data-statistics/app"
    proc_root="/proc"
    systemctl_bin="systemctl"
    curl_bin="curl"
    ss_bin="ss"
    prune_script="/usr/local/sbin/prune-data-statistics-releases"
  fi
fi

for command_path in "$systemctl_bin" "$curl_bin" "$ss_bin"; do
  command -v "$command_path" >/dev/null 2>&1 || { echo "ERROR: required command is missing: ${command_path}" >&2; exit 1; }
done
[[ -x "$prune_script" ]] || { echo "ERROR: prune script is not executable: ${prune_script}" >&2; exit 1; }
if $apply && [[ "$EUID" -eq 0 ]]; then
  [[ "$(stat -c '%U:%G:%a' "$prune_script")" == "root:root:755" ]] || {
    echo "ERROR: production prune script must be root:root mode 0755" >&2
    exit 1
  }
fi
[[ -L "$current_link" ]] || { echo "ERROR: current app path is not a symlink: ${current_link}" >&2; exit 1; }

releases_root="$(realpath "$releases_root")"
current="$(realpath "$current_link")"
if [[ "$rollback_input" == */* ]]; then
  rollback="$(realpath "$rollback_input")"
else
  rollback="$(realpath "${releases_root}/${rollback_input}")"
fi
for release in "$current" "$rollback"; do
  [[ -d "$release" && "$(dirname "$release")" == "$releases_root" ]] || {
    echo "ERROR: release is not a direct child of ${releases_root}: ${release}" >&2
    exit 1
  }
done
[[ "$current" != "$rollback" ]] || { echo "ERROR: rollback release must differ from current" >&2; exit 1; }

[[ "$($systemctl_bin is-active data-statistics.service)" == "active" ]] || {
  echo "ERROR: formal data-statistics.service is not active" >&2
  exit 1
}
main_pid="$($systemctl_bin show data-statistics.service --property MainPID --value)"
[[ "$main_pid" =~ ^[1-9][0-9]*$ && -e "${proc_root}/${main_pid}/cwd" ]] || {
  echo "ERROR: formal service MainPID is missing or invalid" >&2
  exit 1
}
service_cwd="$(readlink -f "${proc_root}/${main_pid}/cwd")"
[[ "$service_cwd" == "$current" || "$service_cwd" == "${current}/"* ]] || {
  echo "ERROR: formal service is not running from the current release" >&2
  exit 1
}
if "$ss_bin" -H -lnt "sport = :3001" | grep -q .; then
  echo "ERROR: TCP 3001 is still listening; finish the approved orphan-process removal first" >&2
  exit 1
fi
"$curl_bin" --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/login >/dev/null || {
  echo "ERROR: current release login health check failed" >&2
  exit 1
}

echo "Validated current release: ${current}"
echo "Validated rollback release: ${rollback}"
echo "Formal service is active on the current release; login is healthy; TCP 3001 is closed."

prune_args=(--keep "$keep" --rollback-release "$rollback")
if $apply; then
  prune_args+=(--apply --confirm OPS-02-PRUNE-RELEASES)
fi
DEPLOY_ROOT="$deploy_root" RELEASES_ROOT="$releases_root" CURRENT_LINK="$current_link" \
  "$prune_script" "${prune_args[@]}"

if $apply; then
  echo "Post-deploy retention completed. Save this redacted output in the restricted change record."
else
  echo "DRY RUN: post-deploy checks passed; no release was deleted."
fi
