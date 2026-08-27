#!/usr/bin/env bash
set -Eeuo pipefail

runtime_user="data-statistics-runtime"
deploy_user="data-statistics"
service_name="data-statistics.service"
application_root="/opt/data-statistics"
unit_path="/etc/systemd/system/${service_name}"
script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ops_directory=$(cd -- "${script_directory}/.." && pwd)
unit_source="${ops_directory}/systemd/data-statistics.service"
verification_script="${script_directory}/verify-runtime-account.sh"
unit_backup="${unit_path}.pre-ops01"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[[ ${APPLY_OPS_01:-} == "YES" ]] || fail "set APPLY_OPS_01=YES after reviewing the runbook"
[[ $(id -u) -eq 0 ]] || fail "must run as root"
[[ -f "$unit_source" ]] || fail "systemd unit template is missing"
[[ -x "$verification_script" ]] || fail "verification script is missing or not executable"
[[ -d "$application_root" ]] || fail "application root is missing"
[[ -L "${application_root}/app" ]] || fail "active release link is missing"
[[ -d "${application_root}/repository" ]] || fail "deployment repository is missing"
[[ -d "${application_root}/releases" ]] || fail "release directory is missing"
[[ -f "${application_root}/.ssh/data_statistics_deploy_ed25519" ]] || fail "deployment private key is missing"
id "$deploy_user" >/dev/null 2>&1 || fail "deployment account is missing"
systemctl is-active --quiet "$service_name" || fail "website service must be healthy before migration"
[[ ! -e "$unit_backup" ]] || fail "rollback unit already exists at ${unit_backup}"

active_release=$(readlink -e "${application_root}/app") || fail "active release link is broken"
case "$active_release" in
  "${application_root}/releases/"*) ;;
  *) fail "active release is outside the managed release directory" ;;
esac

permission_targets=(
  "$application_root"
  "${application_root}/releases"
  "${application_root}/.ssh"
  "${application_root}/repository"
  "${application_root}/backups"
)
if [[ -d "${application_root}/deploy-backups" ]]; then
  permission_targets+=("${application_root}/deploy-backups")
fi
for runtime_path in "/var/lib/${runtime_user}" "/var/cache/${runtime_user}"; do
  if [[ -d "$runtime_path" ]]; then
    permission_targets+=("$runtime_path")
  fi
done
permission_snapshots=()
for permission_target in "${permission_targets[@]}"; do
  permission_snapshots+=("${permission_target}|$(stat -c '%u|%g|%a' "$permission_target")")
done
rollback_needed=0
unit_backup_created=0

rollback() {
  exit_code=$?
  trap - EXIT
  if [[ $exit_code -ne 0 && $rollback_needed -eq 1 ]]; then
    printf 'Migration failed; restoring previous permissions and service unit.\n' >&2
    for permission_snapshot in "${permission_snapshots[@]}"; do
      IFS='|' read -r permission_path permission_uid permission_gid permission_mode <<< "$permission_snapshot"
      chown "${permission_uid}:${permission_gid}" "$permission_path" || true
      chmod "$permission_mode" "$permission_path" || true
    done
    if [[ $unit_backup_created -eq 1 ]]; then
      install -o root -g root -m 0644 "$unit_backup" "$unit_path" || true
    fi
    systemctl daemon-reload || true
    systemctl restart "$service_name" || true
  fi
  exit "$exit_code"
}
trap rollback EXIT

# From this point onward every permission mutation is covered by rollback.
rollback_needed=1

if ! id "$runtime_user" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "/var/lib/${runtime_user}" --shell /usr/sbin/nologin "$runtime_user"
fi
[[ $(getent passwd "$runtime_user" | cut -d: -f7) == "/usr/sbin/nologin" ]] || fail "runtime account has an interactive shell"
if id -nG "$runtime_user" | tr ' ' '\n' | grep -Fxq "$deploy_user"; then
  fail "runtime account must not be a member of the deployment group"
fi

install -d -o "$runtime_user" -g "$runtime_user" -m 0750 "/var/lib/${runtime_user}" "/var/cache/${runtime_user}"
[[ -d "${active_release}/.next/cache" ]] || fail "active release is missing the Next.js cache mount point"
chown "${deploy_user}:${runtime_user}" "$application_root"
chmod 0750 "$application_root"
chown "${deploy_user}:${deploy_user}" "${application_root}/releases"
chmod 0755 "${application_root}/releases"
chmod 0700 "${application_root}/.ssh"
chmod 0750 "${application_root}/repository" "${application_root}/backups"
if [[ -d "${application_root}/deploy-backups" ]]; then
  chmod 0750 "${application_root}/deploy-backups"
fi

# The runtime account is not a member of the deployment group. Existing group
# write bits can therefore remain available for deployment without granting
# write access to the website process. World-writable release content is denied.
if find "$active_release" -xdev -perm -0002 -print -quit | grep -q .; then
  fail "active release contains world-writable content"
fi
runuser -u "$runtime_user" -- test -r "$active_release/node_modules/next/dist/bin/next" || fail "runtime account cannot read the active release"

install -o root -g root -m 0600 "$unit_path" "$unit_backup"
unit_backup_created=1
systemd-analyze verify "$unit_source"
install -o root -g root -m 0644 "$unit_source" "$unit_path"
systemctl daemon-reload
systemctl restart "$service_name"

for _attempt in $(seq 1 20); do
  if curl --silent --fail --output /dev/null --max-time 2 http://127.0.0.1:3000/login; then
    break
  fi
  sleep 1
done

"$verification_script"
rollback_needed=0
trap - EXIT
printf 'OPS-01 migration completed. Keep %s until rollback validation is finished.\n' "$unit_backup"
