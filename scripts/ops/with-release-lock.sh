#!/usr/bin/env bash
set -euo pipefail

lock_file="/run/lock/data-statistics-release.lock"
flock_bin="flock"

if (($# == 0)); then
  echo "Usage: sudo $0 COMMAND [ARGUMENT ...]" >&2
  echo "Runs a deployment or rollback command under the OPS-02 release lock." >&2
  exit 2
fi

command -v "$flock_bin" >/dev/null 2>&1 || { echo "ERROR: flock is required" >&2; exit 1; }
mkdir -p "$(dirname "$lock_file")"
exec 9>"$lock_file"
if ! "$flock_bin" -n 9; then
  echo "ERROR: release lock is held; another deploy, rollback, or cleanup is running: ${lock_file}" >&2
  exit 1
fi

"$@"
