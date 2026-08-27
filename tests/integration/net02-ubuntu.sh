#!/usr/bin/env bash
set -euo pipefail

[[ "$(uname -s)" == Linux ]] || { echo "SKIP: NET-02 Ubuntu integration test"; exit 0; }
[[ ${EUID} -eq 0 ]] || { echo "ERROR: NET-02 Ubuntu integration test must run as root" >&2; exit 1; }
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
test_dir="$(mktemp -d /run/net02-ci.XXXXXX)"
ci_unit_installed=false
ci_state_created=false
cleanup() {
  if [[ "$ci_unit_installed" == true ]]; then
    systemctl stop data-statistics-cloudflare-ufw.service >/dev/null 2>&1 || true
    rm -rf -- /etc/systemd/system/data-statistics-cloudflare-ufw.service.d
    rm -f -- /etc/systemd/system/data-statistics-cloudflare-ufw.service
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  if [[ "$ci_state_created" == true ]]; then
    rm -rf -- /var/lib/data-statistics/net-02
  fi
  rm -rf -- "$test_dir"
}
trap cleanup EXIT
mock_bin="$test_dir/bin"
mkdir -p "$mock_bin" "$test_dir/nginx" "$test_dir/log" "$test_dir/applications.d"
chmod 0755 "$test_dir" "$mock_bin" "$test_dir/nginx" "$test_dir/log" "$test_dir/applications.d"
printf '%s\n' '[Custom Web]' 'title=Custom Web' 'description=CI custom profile' 'ports=8080/tcp|443/tcp' >"$test_dir/applications.d/custom-web"
printf '%s\n' '[Custom Web on eth0]' 'title=Ambiguous interface-style name' 'ports=443/tcp' >>"$test_dir/applications.d/custom-web"
printf '%s\n' '[Custom Web (v6)]' 'title=Ambiguous IPv6-style name' 'ports=443/tcp' >>"$test_dir/applications.d/custom-web"
chmod 0644 "$test_dir/applications.d/custom-web"

python3 - "$test_dir/v4" "$test_dir/v6" <<'PY'
import ipaddress
import pathlib
import sys
pathlib.Path(sys.argv[1]).write_text("".join(f"{ipaddress.ip_network('8.0.0.0/8').subnets(new_prefix=24).__next__().network_address + i * 256}/24\n" for i in range(15)))
pathlib.Path(sys.argv[2]).write_text("".join(f"{ipaddress.IPv6Address(int(ipaddress.IPv6Address('2606:4700::')) + i * 2**64)}/64\n" for i in range(7)))
PY

cat >"$mock_bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
url="${*: -1}"
if [[ "$url" == *ips-v4 ]]; then cat "$MOCK_V4"; else cat "$MOCK_V6"; fi
SH
cat >"$mock_bin/ufw" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$MOCK_LOG/ufw.log"
if [[ "$*" == "status verbose" ]]; then
  if [[ "${MOCK_UFW_MODE:-ok}" == inactive ]]; then echo 'Status: inactive'; exit 0; fi
  echo 'Status: active'
  if [[ "${MOCK_UFW_MODE:-ok}" == allow ]]; then echo 'Default: allow (incoming), allow (outgoing), disabled (routed)'; else echo 'Default: deny (incoming), allow (outgoing), disabled (routed)'; fi
elif [[ "$*" == "status numbered" ]]; then
  echo 'Status: active'
  if [[ -n "${MOCK_UFW_RULES_FILE:-}" ]]; then cat "$MOCK_UFW_RULES_FILE"; fi
  if [[ "${MOCK_UFW_MODE:-ok}" == broad ]]; then echo "[ 1] ${MOCK_BROAD_TARGET:-80/tcp} ALLOW IN Anywhere # unmanaged"; fi
fi
SH
cat >"$mock_bin/nginx" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$MOCK_LOG/nginx.log"
[[ "${MOCK_NGINX_FAIL:-no}" != yes ]] || exit 1
if [[ "$1" == -T ]]; then
  cat "$MOCK_REAL_IP"
  echo 'proxy_set_header X-Real-IP $remote_addr;'
fi
SH
cat >"$mock_bin/systemctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$MOCK_LOG/systemctl.log"
if [[ "${MOCK_RELOAD_FAIL_ONCE:-no}" == yes && "$*" == 'reload nginx' ]]; then
  count=0
  [[ ! -f "$MOCK_RELOAD_COUNT_FILE" ]] || count="$(cat "$MOCK_RELOAD_COUNT_FILE")"
  count=$((count + 1))
  printf '%s\n' "$count" >"$MOCK_RELOAD_COUNT_FILE"
  (( count > 1 )) || exit 1
fi
SH
chmod 0755 "$mock_bin"/*

defaults="$test_dir/ufw-defaults"
printf 'IPV6=yes\n' >"$defaults"
real_ip="$test_dir/nginx/real-ip.conf"
state="$test_dir/state"
approval="$test_dir/emergency-cidrs.txt"
install -o root -g root -m 0600 /dev/null "$approval"
common=(PATH="$mock_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" MOCK_V4="$test_dir/v4" MOCK_V6="$test_dir/v6" MOCK_LOG="$test_dir/log" MOCK_REAL_IP="$real_ip" NET02_STATE_DIR="$state" NET02_REAL_IP_INCLUDE="$real_ip" NET02_UFW_DEFAULTS_FILE="$defaults" NET02_UFW_APPLICATIONS_DIR="$test_dir/applications.d" NET02_UFW_BIN="$mock_bin/ufw" NET02_NGINX_BIN="$mock_bin/nginx" NET02_SYSTEMCTL_BIN="$mock_bin/systemctl" NET02_EMERGENCY_APPROVAL_FILE="$approval")

sudo env "${common[@]}" "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" --apply
grep -Fq 'set_real_ip_from' "$real_ip"
grep -Fq 'reload nginx' "$test_dir/log/systemctl.log"
sudo test "$(sudo stat -c '%u:%g:%a' "$state/cloudflare-cidrs.txt")" = '0:0:640'
sudo test "$(sudo stat -c '%u:%g:%a' "$state/last-success-epoch")" = '0:0:640'

if sudo env "${common[@]}" MOCK_UFW_MODE=inactive "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" --apply; then
  echo 'ERROR: inactive UFW was accepted' >&2; exit 1
fi
if sudo env "${common[@]}" MOCK_UFW_MODE=allow "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" --apply; then
  echo 'ERROR: default-allow UFW was accepted' >&2; exit 1
fi
printf 'IPV6=no\n' >"$defaults"
if sudo env "${common[@]}" "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" --apply; then
  echo 'ERROR: disabled UFW IPv6 was accepted' >&2; exit 1
fi
printf 'IPV6=yes\n' >"$defaults"
for broad_target in '80/tcp' '443/tcp' 'Nginx Full' 'Apache Full' '70:450/tcp'; do
  if sudo env "${common[@]}" MOCK_UFW_MODE=broad MOCK_BROAD_TARGET="$broad_target" CONFIRM_NET02_LOCKDOWN=YES "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" --apply --activate-lockdown; then
    echo "ERROR: broad public web rule was accepted: $broad_target" >&2; exit 1
  fi
done

rules_file="$test_dir/ufw-rules.txt"
cf_v4="$(head -n 1 "$test_dir/v4")"
printf '[ 1] 80,443/tcp ALLOW IN %s # NET-02 Cloudflare origin\n' "$cf_v4" >"$rules_file"
sudo env "${common[@]}" MOCK_UFW_RULES_FILE="$rules_file" "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" --apply
printf '[ 1] Custom Web ALLOW IN %s # NET-02 Cloudflare origin\n' "$cf_v4" >"$rules_file"
sudo env "${common[@]}" MOCK_UFW_RULES_FILE="$rules_file" "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" --apply

expect_rule_rejected() {
  printf '%s\n' "$1" >"$rules_file"
  if sudo env "${common[@]}" MOCK_UFW_RULES_FILE="$rules_file" "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" --apply; then
    echo "ERROR: unsafe UFW rule was accepted: $1" >&2
    exit 1
  fi
}
expect_rule_rejected "[ 1] 80,443/tcp ALLOW IN $cf_v4"
expect_rule_rejected "[ 1] 80,443/tcp ALLOW IN $cf_v4 # NET-02 Cloudflare origin # forged"
expect_rule_rejected '[ 1] 80,443/tcp ALLOW IN 128.0.0.0/1 # NET-02 Cloudflare origin'
expect_rule_rejected '[ 1] 443/tcp ALLOW IN 9.9.10.0/24 # NET-02 Cloudflare origin'
expect_rule_rejected '[ 1] 443/tcp (v6) ALLOW IN 2001:4860::/32 # NET-02 Cloudflare origin'
expect_rule_rejected '[ 1] 80/tcp ALLOW IN Anywhere # NET-02 Cloudflare origin'
expect_rule_rejected '[ 1] 80/tcp LIMIT IN Anywhere # unmanaged'
expect_rule_rejected '[ 1] Custom Web ALLOW IN 9.9.10.0/24 # NET-02 Cloudflare origin'
expect_rule_rejected "[ 1] Deleted Web Profile ALLOW IN $cf_v4 # NET-02 Cloudflare origin"
expect_rule_rejected "[ 1] Custom Web on eth0 ALLOW IN $cf_v4 # NET-02 Cloudflare origin"
expect_rule_rejected "[ 1] Custom Web (v6) ALLOW IN $cf_v4 # NET-02 Cloudflare origin"

printf '9.9.9.0/24\n' >"$approval"
chmod 0600 "$approval"
future_expiry=$(( $(date -u +%s) + 3600 ))
printf '%s\t9.9.9.0/24\n' "$future_expiry" >"$state/emergency-web-access.tsv"
chmod 0640 "$state/emergency-web-access.tsv"
printf '[ 1] 80,443/tcp ALLOW IN 9.9.9.0/24 # NET-02 emergency expiring\n' >"$rules_file"
sudo env "${common[@]}" MOCK_UFW_RULES_FILE="$rules_file" "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" --apply
printf '%s\t9.9.9.0/24\n' "$(( $(date -u +%s) - 1 ))" >"$state/emergency-web-access.tsv"
expect_rule_rejected '[ 1] 80,443/tcp ALLOW IN 9.9.9.0/24 # NET-02 emergency expiring'
rm -f -- "$state/emergency-web-access.tsv"
: >"$rules_file"

old_content='old safe content'
printf '%s\n' "$old_content" >"$real_ip"
state_hash_before="$(sha256sum "$state/cloudflare-cidrs.txt")"
success_hash_before="$(sha256sum "$state/last-success-epoch")"
reload_count="$test_dir/reload-count"
if sudo env "${common[@]}" MOCK_UFW_RULES_FILE="$rules_file" MOCK_RELOAD_FAIL_ONCE=yes MOCK_RELOAD_COUNT_FILE="$reload_count" "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" --apply; then
  echo 'ERROR: failed nginx reload was accepted' >&2; exit 1
fi
grep -Fqx "$old_content" "$real_ip"
[[ "$(cat "$reload_count")" == 2 ]]
[[ "$(sha256sum "$state/cloudflare-cidrs.txt")" == "$state_hash_before" ]]
[[ "$(sha256sum "$state/last-success-epoch")" == "$success_hash_before" ]]

real_mv="$(command -v mv)"
cat >"$mock_bin/mv" <<SH
#!/usr/bin/env bash
set -euo pipefail
target="\${*: -1}"
if [[ "\$target" == "\${MOCK_FAIL_TARGET:-}" ]]; then
  count=0
  [[ ! -f "\$MOCK_MV_COUNT_FILE" ]] || count="\$(cat "\$MOCK_MV_COUNT_FILE")"
  count=\$((count + 1))
  printf '%s\\n' "\$count" >"\$MOCK_MV_COUNT_FILE"
  (( count != 2 )) || exit 73
fi
exec "$real_mv" "\$@"
SH
chmod 0755 "$mock_bin/mv"
cat >"$mock_bin/ufw-stateful" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$MOCK_LOG/ufw.log"
if [[ "$*" == 'status numbered' ]]; then
  number=0
  while IFS= read -r rule; do
    [[ -z "$rule" ]] && continue
    number=$((number + 1))
    printf '[ %s] %s\n' "$number" "$rule"
  done <"$MOCK_UFW_STATE_FILE"
elif [[ "$1" == allow ]]; then
  cidr=''
  for ((index=1; index<=$#; index++)); do
    if [[ "${!index}" == from ]]; then next=$((index + 1)); cidr="${!next}"; fi
  done
  printf '80,443/tcp ALLOW IN %s # NET-02 emergency expiring\n' "$cidr" >>"$MOCK_UFW_STATE_FILE"
elif [[ "$1" == --force && "$2" == delete && "$3" =~ ^[0-9]+$ ]]; then
  awk -v remove="$3" 'NF { seen++; if (seen != remove) print }' "$MOCK_UFW_STATE_FILE" >"$MOCK_UFW_STATE_FILE.tmp"
  mv -f -- "$MOCK_UFW_STATE_FILE.tmp" "$MOCK_UFW_STATE_FILE"
fi
SH
chmod 0755 "$mock_bin/ufw-stateful"
rm -f -- "$state/emergency-web-access.tsv"
: >"$test_dir/log/ufw.log"
: >"$test_dir/log/systemctl.log"
ufw_state="$test_dir/ufw-state"
printf '80,443/tcp ALLOW IN 9.9.9.0/24 # preserve-other-rule\n' >"$ufw_state"
mv_count="$test_dir/mv-count"
if sudo env "${common[@]}" NET02_UFW_BIN="$mock_bin/ufw-stateful" MOCK_UFW_STATE_FILE="$ufw_state" MOCK_FAIL_TARGET="$state/emergency-web-access.tsv" MOCK_MV_COUNT_FILE="$mv_count" "$repo_root/ops/scripts/manage-data-statistics-emergency-web-access.sh" --add 9.9.9.0/24 60; then
  echo 'ERROR: emergency state write failure was accepted' >&2; exit 1
fi
grep -Fq "allow proto tcp from 9.9.9.0/24 to any port 80,443 comment NET-02 emergency expiring" "$test_dir/log/ufw.log"
grep -Eq -- '--force delete [0-9]+' "$test_dir/log/ufw.log"
! grep -Fq -- '--force delete allow' "$test_dir/log/ufw.log"
grep -Fq 'data-statistics-net02-alert@emergency-state-write.service' "$test_dir/log/systemctl.log"
[[ ! -s "$state/emergency-web-access.tsv" ]]
[[ "$(cat "$ufw_state")" == '80,443/tcp ALLOW IN 9.9.9.0/24 # preserve-other-rule' ]]
rm -f -- "$mock_bin/mv"

sudo env "${common[@]}" NET02_UFW_BIN="$mock_bin/ufw-stateful" MOCK_UFW_STATE_FILE="$ufw_state" "$repo_root/ops/scripts/manage-data-statistics-emergency-web-access.sh" --add 9.9.9.0/24 60
sudo env "${common[@]}" NET02_UFW_BIN="$mock_bin/ufw-stateful" MOCK_UFW_STATE_FILE="$ufw_state" "$repo_root/ops/scripts/manage-data-statistics-emergency-web-access.sh" --remove 9.9.9.0/24
[[ ! -s "$state/emergency-web-access.tsv" ]]
[[ "$(cat "$ufw_state")" == '80,443/tcp ALLOW IN 9.9.9.0/24 # preserve-other-rule' ]]
sudo env "${common[@]}" NET02_UFW_BIN="$mock_bin/ufw-stateful" MOCK_UFW_STATE_FILE="$ufw_state" "$repo_root/ops/scripts/manage-data-statistics-emergency-web-access.sh" --add 9.9.9.0/24 5
printf '%s\t9.9.9.0/24\n' "$(( $(date -u +%s) - 1 ))" >"$state/emergency-web-access.tsv"
sudo env "${common[@]}" NET02_UFW_BIN="$mock_bin/ufw-stateful" MOCK_UFW_STATE_FILE="$ufw_state" "$repo_root/ops/scripts/manage-data-statistics-emergency-web-access.sh" --expire
[[ ! -s "$state/emergency-web-access.tsv" ]]
[[ "$(cat "$ufw_state")" == '80,443/tcp ALLOW IN 9.9.9.0/24 # preserve-other-rule' ]]
! grep -Fq -- '--force delete allow' "$test_dir/log/ufw.log"

nginx_conf="$test_dir/nginx.conf"
cat >"$nginx_conf" <<EOF
pid $test_dir/nginx.pid;
error_log $test_dir/error.log;
events {}
http {
  include $repo_root/ops/nginx/data-statistics-cloudflare-real-ip.conf;
  server {
    listen 127.0.0.1:8088;
    include $repo_root/ops/nginx/data-statistics-security-headers.conf;
    location / { proxy_set_header X-Real-IP \$remote_addr; return 200; }
  }
}
EOF
sudo nginx -t -c "$nginx_conf"

sudo install -d -m 0755 /usr/local/sbin /usr/local/lib/data-statistics
sudo install -m 0755 "$repo_root/ops/scripts/sync-data-statistics-cloudflare-ufw.sh" /usr/local/sbin/sync-data-statistics-cloudflare-ufw
sudo install -m 0755 "$repo_root/ops/scripts/manage-data-statistics-emergency-web-access.sh" /usr/local/sbin/manage-data-statistics-emergency-web-access
sudo install -m 0755 "$repo_root/ops/scripts/send-data-statistics-net02-alert.sh" /usr/local/lib/data-statistics/send-data-statistics-net02-alert
sudo install -m 0755 "$repo_root/ops/scripts/check-data-statistics-cloudflare-sync.sh" /usr/local/lib/data-statistics/check-data-statistics-cloudflare-sync
# LOG-02 contributes this unit to the same directory. Install its executable so
# verifying the integrated unit set checks configuration instead of failing on
# a deliberately absent production deployment path.
sudo install -m 0755 "$repo_root/ops/scripts/check-log-capacity.sh" /usr/local/sbin/data-statistics-check-log-capacity
sudo install -m 0755 "$repo_root/ops/scripts/check-journal-suppression.sh" /usr/local/sbin/data-statistics-check-journal-suppression
sudo install -m 0755 "$repo_root/ops/scripts/send-data-statistics-log-alert.sh" /usr/local/lib/data-statistics/send-data-statistics-log-alert
sudo install -d -o root -g root -m 0755 /etc/data-statistics
sudo install -o root -g root -m 0600 "$repo_root/ops/systemd/net02-monitor.env.example" /etc/data-statistics/net02-monitor.env
sudo install -o root -g root -m 0600 "$repo_root/ops/systemd/log-monitor.env.example" /etc/data-statistics/log-monitor.env
systemd-analyze verify "$repo_root"/ops/systemd/*.service "$repo_root"/ops/systemd/*.timer

bad_monitor_env="$test_dir/bad-monitor.env"
install -o root -g root -m 0644 "$repo_root/ops/systemd/net02-monitor.env.example" "$bad_monitor_env"
if NET02_MONITOR_ENV_FILE="$bad_monitor_env" "$repo_root/ops/scripts/send-data-statistics-net02-alert.sh" ci-test ci-test 2>"$test_dir/bad-monitor.err"; then
  echo 'ERROR: insecure monitor EnvironmentFile mode was accepted' >&2; exit 1
fi
grep -Fq 'root:root mode 0600' "$test_dir/bad-monitor.err"

[[ ! -e /etc/systemd/system/data-statistics-cloudflare-ufw.service ]]
[[ ! -e /etc/systemd/system/data-statistics-cloudflare-ufw.service.d ]]
[[ ! -e /var/lib/data-statistics/net-02 ]]
install -o root -g root -m 0644 "$repo_root/ops/systemd/data-statistics-cloudflare-ufw.service" /etc/systemd/system/data-statistics-cloudflare-ufw.service
install -d -o root -g root -m 0755 /etc/systemd/system/data-statistics-cloudflare-ufw.service.d
cat >/etc/systemd/system/data-statistics-cloudflare-ufw.service.d/ci.conf <<EOF
[Service]
Environment=PATH=$mock_bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=MOCK_V4=$test_dir/v4
Environment=MOCK_V6=$test_dir/v6
Environment=MOCK_LOG=$test_dir/log
Environment=MOCK_REAL_IP=$test_dir/nginx/systemd-real-ip.conf
Environment=NET02_REAL_IP_INCLUDE=$test_dir/nginx/systemd-real-ip.conf
Environment=NET02_UFW_DEFAULTS_FILE=$defaults
Environment=NET02_UFW_APPLICATIONS_DIR=$test_dir/applications.d
Environment=NET02_UFW_BIN=$mock_bin/ufw
Environment=NET02_NGINX_BIN=$mock_bin/nginx
Environment=NET02_SYSTEMCTL_BIN=$mock_bin/systemctl
Environment=NET02_EMERGENCY_APPROVAL_FILE=$approval
EOF
ci_unit_installed=true
ci_state_created=true
systemctl daemon-reload
systemctl start data-statistics-cloudflare-ufw.service
[[ "$(systemctl show -p Result --value data-statistics-cloudflare-ufw.service)" == success ]]
[[ "$(stat -c '%u:%g:%a' /var/lib/data-statistics/net-02)" == '0:0:750' ]]
[[ "$(stat -c '%u:%g:%a' /var/lib/data-statistics/net-02/cloudflare-cidrs.txt)" == '0:0:640' ]]

echo 'PASS: NET-02 Ubuntu mocks, nginx -t, and systemd unit verification succeeded.'
