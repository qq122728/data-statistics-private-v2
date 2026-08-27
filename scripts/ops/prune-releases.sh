#!/usr/bin/env bash
set -euo pipefail

deploy_root="${DEPLOY_ROOT:-/opt/data-statistics}"
releases_root="${RELEASES_ROOT:-${deploy_root}/releases}"
current_link="${CURRENT_LINK:-${deploy_root}/app}"
keep=8
apply=false
confirmation=""
rollback_input=""
lock_file="${OPS02_RELEASE_LOCK_FILE:-/run/lock/data-statistics-release.lock}"
flock_bin="${OPS02_FLOCK_BIN:-flock}"
identity_bin="${OPS02_IDENTITY_BIN:-}"
proc_root="${OPS02_PROC_ROOT:-/proc}"

usage() {
  echo "Usage: sudo $0 [--keep 5..10] --rollback-release NAME_OR_PATH [--apply --confirm OPS-02-PRUNE-RELEASES]"
  echo "Default mode only prints candidates. Apply mode requires an explicit rollback release and confirmation."
}

while (($#)); do
  case "$1" in
    --keep) keep="${2:-}"; shift 2 ;;
    --rollback-release) rollback_input="${2:-}"; shift 2 ;;
    --apply) apply=true; shift ;;
    --confirm) confirmation="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$keep" =~ ^[0-9]+$ ]] && ((keep >= 5 && keep <= 10)) || {
  echo "ERROR: --keep must be between 5 and 10" >&2
  exit 2
}
[[ -d "$releases_root" ]] || { echo "ERROR: release directory not found: ${releases_root}" >&2; exit 1; }
[[ -L "$current_link" ]] || { echo "ERROR: current app path must be a symbolic link: ${current_link}" >&2; exit 1; }

releases_root="$(realpath "$releases_root")"
current="$(realpath "$current_link")"
[[ "$(dirname "$current")" == "$releases_root" && -d "$current" ]] || {
  echo "ERROR: current release is not a direct child of ${releases_root}: ${current}" >&2
  exit 1
}

rollback=""
if [[ -n "$rollback_input" ]]; then
  if [[ "$rollback_input" == */* ]]; then
    rollback="$(realpath "$rollback_input")"
  else
    rollback="$(realpath "${releases_root}/${rollback_input}")"
  fi
  [[ "$(dirname "$rollback")" == "$releases_root" && -d "$rollback" ]] || {
    echo "ERROR: rollback release is not a direct child of ${releases_root}: ${rollback}" >&2
    exit 1
  }
fi

if $apply; then
  if [[ "$EUID" -ne 0 ]]; then
    [[ "${OPS02_TEST_ALLOW_UNPRIVILEGED:-}" == "1" && "$releases_root" != "/opt/data-statistics/releases" ]] || {
      echo "ERROR: apply mode must run as root" >&2
      exit 1
    }
  else
    # Production apply mode always uses the fixed command, lock, and real
    # filesystem identity provider. Environment overrides are test-only.
    lock_file="/run/lock/data-statistics-release.lock"
    flock_bin="flock"
    identity_bin=""
    proc_root="/proc"
  fi
  [[ -n "$rollback" ]] || { echo "ERROR: apply mode requires --rollback-release" >&2; exit 1; }
  [[ "$rollback" != "$current" ]] || { echo "ERROR: rollback release must differ from current" >&2; exit 1; }
  [[ "$confirmation" == "OPS-02-PRUNE-RELEASES" ]] || {
    echo "ERROR: apply mode requires --confirm OPS-02-PRUNE-RELEASES" >&2
    exit 1
  }
fi

command -v "$flock_bin" >/dev/null 2>&1 || { echo "ERROR: flock is required" >&2; exit 1; }
mkdir -p "$(dirname "$lock_file")"
exec 9>"$lock_file"
if ! "$flock_bin" -n 9; then
  echo "ERROR: release lock is held; a deploy, rollback, or cleanup is already running: ${lock_file}" >&2
  exit 1
fi

protected_paths=()
protected_reasons=()

add_protected() {
  local path="$1"
  local reason="$2"
  local index
  for ((index=0; index<${#protected_paths[@]}; index++)); do
    if [[ "${protected_paths[$index]}" == "$path" ]]; then
      protected_reasons[$index]="${protected_reasons[$index]}, ${reason}"
      return
    fi
  done
  protected_paths+=("$path")
  protected_reasons+=("$reason")
}

is_protected() {
  local path="$1"
  local protected_path
  for protected_path in "${protected_paths[@]}"; do
    [[ "$protected_path" == "$path" ]] && return 0
  done
  return 1
}

release_for_target() {
  local target="$1"
  local relative first_component release
  [[ "$target" == "${releases_root}/"* ]] || return 1
  relative="${target#"${releases_root}/"}"
  first_component="${relative%%/*}"
  [[ -n "$first_component" && "$first_component" != "." && "$first_component" != ".." ]] || return 1
  release="${releases_root}/${first_component}"
  [[ -d "$release" && "$(realpath "$release" 2>/dev/null || true)" == "$release" ]] || return 1
  printf '%s\n' "$release"
}

directory_identity() {
  local path="$1"
  if [[ -n "$identity_bin" ]]; then
    "$identity_bin" "$path"
    return
  fi
  if stat -Lc '%d:%i' "$path" 2>/dev/null; then
    return
  fi
  stat -L -f '%d:%i' "$path"
}

add_protected "$current" "current app symlink"
[[ -n "$rollback" ]] && add_protected "$rollback" "declared rollback"

while IFS= read -r -d '' link; do
  target="$(realpath "$link" 2>/dev/null || true)"
  release="$(release_for_target "$target" 2>/dev/null || true)"
  if [[ -n "$release" ]]; then
    add_protected "$release" "symlink ${link}"
  fi
done < <(find "$deploy_root" -maxdepth 2 -type l -print0)

for proc_cwd in "${proc_root}"/[0-9]*/cwd; do
  target="$(readlink -f "$proc_cwd" 2>/dev/null || true)"
  release="$(release_for_target "$target" 2>/dev/null || true)"
  if [[ -n "$release" ]]; then
    add_protected "$release" "running process cwd"
  fi
done

ordered=()
while IFS= read -r release; do
  [[ -n "$release" ]] && ordered+=("$release")
done < <(
  while IFS= read -r -d '' release; do
    if modified="$(stat -c '%Y' "$release" 2>/dev/null)"; then
      :
    else
      modified="$(stat -f '%m' "$release")"
    fi
    printf '%s\t%s\n' "$modified" "$release"
  done < <(find "$releases_root" -mindepth 1 -maxdepth 1 -type d -print0) |
    sort -nr | cut -f2-
)
if ((${#ordered[@]} <= keep)); then
  echo "Nothing to prune: ${#ordered[@]} releases, retention is ${keep}."
  exit 0
fi

candidates=()
candidate_identities=()
for ((index=0; index<${#ordered[@]}; index++)); do
  release="${ordered[$index]}"
  if ((index < keep)) || is_protected "$release"; then
    continue
  fi
  [[ "$(dirname "$release")" == "$releases_root" ]] || { echo "ERROR: unsafe candidate: ${release}" >&2; exit 1; }
  candidates+=("$release")
  candidate_identities+=("$(directory_identity "$release")")
done

echo "Current: ${current}"
echo "Rollback: ${rollback:-NOT DECLARED (required for apply)}"
echo "Retention: newest ${keep} releases, plus every protected release"
echo "Protected releases:"
for ((index=0; index<${#protected_paths[@]}; index++)); do
  printf '  %s (%s)\n' "${protected_paths[$index]}" "${protected_reasons[$index]}"
done | sort
echo "Prune candidates (${#candidates[@]}):"
printf '  %s\n' "${candidates[@]}"

if ! $apply; then
  echo "DRY RUN: nothing deleted."
  exit 0
fi

for ((candidate_index=0; candidate_index<${#candidates[@]}; candidate_index++)); do
  release="${candidates[$candidate_index]}"
  expected_identity="${candidate_identities[$candidate_index]}"
  if is_protected "$release"; then
    echo "ERROR: protected release reached deletion loop: ${release}" >&2
    exit 1
  fi
  latest_current="$(realpath "$current_link")"
  if [[ "$release" == "$latest_current" ]]; then
    echo "ERROR: current release changed during cleanup; refusing to delete ${release}" >&2
    exit 1
  fi
  while IFS= read -r -d '' link; do
    latest_target="$(realpath "$link" 2>/dev/null || true)"
    latest_release="$(release_for_target "$latest_target" 2>/dev/null || true)"
    [[ "$release" != "$latest_release" ]] || {
      echo "ERROR: a symlink began referencing cleanup candidate ${release}; refusing to continue" >&2
      exit 1
    }
  done < <(find "$deploy_root" -maxdepth 2 -type l -print0)
  for proc_cwd in "${proc_root}"/[0-9]*/cwd; do
    latest_target="$(readlink -f "$proc_cwd" 2>/dev/null || true)"
    latest_release="$(release_for_target "$latest_target" 2>/dev/null || true)"
    [[ "$release" != "$latest_release" ]] || {
      echo "ERROR: a process began using cleanup candidate ${release}; refusing to continue" >&2
      exit 1
    }
  done
  latest_identity="$(directory_identity "$release" 2>/dev/null || true)"
  [[ "$latest_identity" == "$expected_identity" ]] || {
    echo "ERROR: cleanup candidate identity changed (${release}); refusing to delete" >&2
    exit 1
  }
  # The shared release lock is the primary exclusion mechanism. Recheck the
  # current target and directory identity immediately before the destructive
  # call as defense in depth against an uncooperative writer.
  [[ "$release" != "$(realpath "$current_link")" ]] || {
    echo "ERROR: cleanup candidate became current immediately before deletion: ${release}" >&2
    exit 1
  }
  [[ "$(directory_identity "$release" 2>/dev/null || true)" == "$expected_identity" ]] || {
    echo "ERROR: cleanup candidate was replaced immediately before deletion: ${release}" >&2
    exit 1
  }
  rm -rf --one-file-system -- "$release"
done
echo "Pruned ${#candidates[@]} old releases."
