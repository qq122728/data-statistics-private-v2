#!/usr/bin/env bash
set -Eeuo pipefail

runtime_user="data-statistics-runtime"
deploy_user="data-statistics"
service_name="data-statistics.service"
application_root="/opt/data-statistics"
application_link="${application_root}/app"
repository_path="${application_root}/repository"
backup_path="${application_root}/backups"
deploy_key="${application_root}/.ssh/data_statistics_deploy_ed25519"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$1"
}

[[ $(id -u) -eq 0 ]] || fail "must run as root"
id "$runtime_user" >/dev/null 2>&1 || fail "runtime account is missing"
id "$deploy_user" >/dev/null 2>&1 || fail "deployment account is missing"
if id -nG "$runtime_user" | tr ' ' '\n' | grep -Fxq "$deploy_user"; then
  fail "runtime account is a member of the deployment group"
fi
pass "runtime account is outside the deployment group"

[[ $(systemctl show "$service_name" -p User --value) == "$runtime_user" ]] || fail "service is not using the runtime account"
systemctl is-active --quiet "$service_name" || fail "website service is not active"
pass "website is managed by systemd under the runtime account"

if runuser -u "$runtime_user" -- test -r "$deploy_key"; then
  fail "runtime account can read the deployment private key"
fi
pass "runtime account cannot read the deployment private key"

if runuser -u "$runtime_user" -- test -w "$repository_path"; then
  fail "runtime account can write the deployment repository"
fi
pass "runtime account cannot write the deployment repository"

if runuser -u "$runtime_user" -- test -w "$application_link"; then
  fail "runtime account can write the active release"
fi
pass "runtime account cannot write the active release"

if runuser -u "$runtime_user" -- test -r "$backup_path"; then
  fail "runtime account can read the backup directory"
fi
pass "runtime account cannot read the backup directory"

main_pid=$(systemctl show "$service_name" -p MainPID --value)
[[ "$main_pid" =~ ^[1-9][0-9]*$ ]] || fail "website service has no running main process"
cache_probe="/opt/data-statistics/app/.next/cache/.ops01-write-probe-${main_pid}"
nsenter --mount="/proc/${main_pid}/ns/mnt" -- \
  runuser -u "$runtime_user" -- sh -c 'umask 077; : > "$1"; rm -f "$1"' sh "$cache_probe" \
  || fail "runtime account cannot write the isolated Next.js cache"
pass "runtime account can write only the isolated Next.js cache"

runuser -u "$deploy_user" -- test -r "$deploy_key" || fail "deployment account cannot read its private key"
runuser -u "$deploy_user" -- test -w "$repository_path" || fail "deployment account cannot update its repository"
runuser -u "$deploy_user" -- test -w "${application_root}/releases" || fail "deployment account cannot create a release"
pass "deployment account retains repository and release access"

http_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 5 http://127.0.0.1:3000/login)
[[ "$http_status" =~ ^(2|3) ]] || fail "website health request returned HTTP ${http_status}"
pass "website responds on the local production port"

business_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 5 http://127.0.0.1:3000/performance-leaderboard)
[[ "$business_status" =~ ^(2|3) ]] || fail "business route returned HTTP ${business_status}"
pass "a protected business route is reachable or redirects to login"

systemd-analyze security "$service_name" --no-pager | sed -n '1,12p'
