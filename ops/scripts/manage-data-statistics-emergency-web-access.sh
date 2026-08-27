#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${NET02_STATE_DIR:-/var/lib/data-statistics/net-02}"
STATE_FILE="$STATE_DIR/emergency-web-access.tsv"
LOCK_FILE="$STATE_DIR/sync.lock"
UFW_BIN="${NET02_UFW_BIN:-/usr/sbin/ufw}"
SYSTEMCTL_BIN="${NET02_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
APPROVAL_FILE="${NET02_EMERGENCY_APPROVAL_FILE:-/etc/data-statistics/net02-emergency-cidrs.txt}"
ACTION="${1:---expire}"
CIDR="${2:-}"
MINUTES="${3:-}"

[[ ${EUID} -eq 0 ]] || { echo "ERROR: emergency access management must run as root" >&2; exit 1; }
[[ -x "$UFW_BIN" ]] || { echo "ERROR: UFW is unavailable" >&2; exit 1; }
[[ -x "$SYSTEMCTL_BIN" ]] || { echo "ERROR: systemctl is unavailable" >&2; exit 1; }
APPROVAL_DIR="$(dirname "$APPROVAL_FILE")"
[[ -d "$APPROVAL_DIR" && ! -L "$APPROVAL_DIR" && "$(stat -c '%u:%g' "$APPROVAL_DIR")" == "0:0" \
  && "$(stat -c '%a' "$APPROVAL_DIR")" =~ ^(700|750|755)$ ]] || {
  echo "ERROR: emergency CIDR approval directory must be a real root-owned directory" >&2
  exit 1
}
[[ -f "$APPROVAL_FILE" && ! -L "$APPROVAL_FILE" \
  && "$(stat -c '%u:%g:%a' "$APPROVAL_FILE")" == "0:0:600" ]] || {
  echo "ERROR: emergency CIDR approval file must be root:root mode 0600 and not a symlink" >&2
  exit 1
}
[[ -d "$STATE_DIR" && ! -L "$STATE_DIR" && "$(stat -c '%u:%g:%a' "$STATE_DIR")" == "0:0:750" ]] || {
  echo "ERROR: NET-02 state directory is unsafe; run the normal sync first" >&2
  exit 1
}
if [[ ( -e "$LOCK_FILE" || -L "$LOCK_FILE" ) && ( ! -f "$LOCK_FILE" || -L "$LOCK_FILE" || "$(stat -c '%u:%g:%a' "$LOCK_FILE")" != "0:0:640" ) ]]; then
  echo "ERROR: NET-02 lock file is unsafe" >&2
  exit 1
fi
if [[ ! -e "$LOCK_FILE" ]]; then
  (umask 0027; : >>"$LOCK_FILE")
  chown root:root "$LOCK_FILE"
  chmod 0640 "$LOCK_FILE"
fi
exec 9>>"$LOCK_FILE"
flock -n 9 || { echo "ERROR: another NET-02 firewall operation is running" >&2; exit 1; }
if [[ -e "$STATE_FILE" || -L "$STATE_FILE" ]]; then
  [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" && "$(stat -c '%u:%g:%a' "$STATE_FILE")" == "0:0:640" ]] || {
    echo "ERROR: emergency state file is unsafe" >&2
    exit 1
  }
fi

work_file="$(mktemp)"
rule_status_file="$(mktemp)"
rule_number_file="$(mktemp)"
trap 'rm -f -- "$work_file" "$rule_status_file" "$rule_number_file"' EXIT
touch "$STATE_FILE"
chown root:root "$STATE_FILE"
chmod 0640 "$STATE_FILE"

atomic_state_install() {
  local source="$1" state_temp
  state_temp="$(mktemp "$STATE_DIR/.net02-emergency.XXXXXX")" || return 1
  if ! install -o root -g root -m 0640 "$source" "$state_temp"; then
    rm -f -- "$state_temp"
    return 1
  fi
  if ! mv -f -- "$state_temp" "$STATE_FILE"; then
    rm -f -- "$state_temp"
    return 1
  fi
}

normalize_cidr() {
  python3 - "$1" <<'PY'
import ipaddress
import sys
network = ipaddress.ip_network(sys.argv[1], strict=True)
if network.is_private or network.is_loopback or network.is_link_local or network.is_multicast or network.is_unspecified:
    raise SystemExit("emergency CIDR must be public unicast")
minimum = 24 if network.version == 4 else 64
if network.prefixlen < minimum:
    raise SystemExit(f"emergency CIDR is too broad: {network}")
print(network)
PY
}

validate_cidr() {
  python3 - "$1" "$APPROVAL_FILE" <<'PY'
import ipaddress
import pathlib
import sys

def parse(raw):
    network = ipaddress.ip_network(raw, strict=True)
    if network.is_private or network.is_loopback or network.is_link_local or network.is_multicast or network.is_unspecified:
        raise SystemExit("emergency CIDR must be public unicast")
    minimum = 24 if network.version == 4 else 64
    if network.prefixlen < minimum:
        raise SystemExit(f"emergency CIDR is too broad: {network}")
    return network

network = parse(sys.argv[1])
raw_lines = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8").splitlines()
if len(raw_lines) > 128 or any(not line or line != line.strip() for line in raw_lines):
    raise SystemExit("emergency approval file is oversized or malformed")
approved = [parse(line) for line in raw_lines]
if len(approved) != len(set(approved)):
    raise SystemExit("duplicate CIDR in emergency approval file")
if network not in approved:
    raise SystemExit(f"emergency CIDR lacks exact root-approved allowlist entry: {network}")
print(network)
PY
}

alert_state_failure() {
  logger -p authpriv.err -t data-statistics-net02 -- "emergency firewall state write failed; exact UFW rollback attempted" || true
  "$SYSTEMCTL_BIN" --no-block start data-statistics-net02-alert@emergency-state-write.service >/dev/null 2>&1 || true
}

load_managed_rule_numbers() {
  local cidr="$1"
  MANAGED_RULE_NUMBERS=()
  LANG=C "$UFW_BIN" status numbered >"$rule_status_file"
  if ! python3 - "$rule_status_file" "$cidr" >"$rule_number_file" <<'PY'
import ipaddress
import re
import sys

path, expected_raw = sys.argv[1:]
expected = ipaddress.ip_network(expected_raw, strict=True)
numbers = []
for raw in open(path, encoding="utf-8").read().splitlines():
    match = re.match(r"^\[\s*(\d+)\]\s+(.*?)\s+ALLOW\s+IN\s+(.*)$", raw)
    if not match:
        continue
    number, target, source_and_comment = match.groups()
    source, separator, comment = source_and_comment.rpartition(" # ")
    if not separator or "#" in source or "#" in comment or comment != "NET-02 emergency expiring":
        continue
    normalized_target = re.sub(r"\s+\(v6\)$", "", target.strip(), flags=re.I)
    if not re.fullmatch(r"(?:80,443|443,80)/tcp", normalized_target, flags=re.I):
        continue
    source = re.sub(r"\s+\(v6\)$", "", source.strip(), flags=re.I)
    try:
        actual = ipaddress.ip_network(source, strict=True)
    except ValueError:
        continue
    if actual == expected:
        numbers.append(int(number))
for number in sorted(numbers):
    print(number)
PY
  then
    echo "ERROR: could not safely parse numbered UFW rules" >&2
    return 1
  fi
  mapfile -t MANAGED_RULE_NUMBERS <"$rule_number_file"
}

delete_managed_rules_by_number() {
  local cidr="$1" index number failed=0
  load_managed_rule_numbers "$cidr" || return 1
  for (( index=${#MANAGED_RULE_NUMBERS[@]} - 1; index >= 0; index-- )); do
    number="${MANAGED_RULE_NUMBERS[$index]}"
    if ! "$UFW_BIN" --force delete "$number" >/dev/null; then
      failed=1
      break
    fi
  done
  load_managed_rule_numbers "$cidr" || return 1
  if (( failed )) || (( ${#MANAGED_RULE_NUMBERS[@]} != 0 )); then
    echo "ERROR: managed emergency UFW rule could not be removed and verified by number for $cidr" >&2
    return 1
  fi
}

expire_rules() {
  local now expiry network failed=0
  now="$(date -u +%s)"
  : >"$work_file"
  while IFS=$'\t' read -r expiry network; do
    [[ -z "$expiry$network" ]] && continue
    [[ "$expiry" =~ ^[0-9]{10}$ ]] || { echo "ERROR: malformed emergency expiry state" >&2; return 1; }
    network="$(normalize_cidr "$network")"
    if (( expiry <= now )) || ! validate_cidr "$network" >/dev/null 2>&1; then
      if ! delete_managed_rules_by_number "$network"; then
        echo "ERROR: could not remove expired emergency rule for $network" >&2
        printf '%s\t%s\n' "$expiry" "$network" >>"$work_file"
        failed=1
      fi
    else
      printf '%s\t%s\n' "$expiry" "$network" >>"$work_file"
    fi
  done <"$STATE_FILE"
  atomic_state_install "$work_file"
  (( failed == 0 ))
}

expire_rules
case "$ACTION" in
  --expire)
    ;;
  --add)
    [[ "$MINUTES" =~ ^[0-9]+$ && "$MINUTES" -ge 5 && "$MINUTES" -le 480 ]] || {
      echo "ERROR: emergency access must expire in 5 to 480 minutes" >&2
      exit 2
    }
    CIDR="$(validate_cidr "$CIDR")"
    if awk -F '\t' -v cidr="$CIDR" '$2 == cidr { found=1 } END { exit !found }' "$STATE_FILE"; then
      echo "ERROR: emergency CIDR is already active; remove it before changing expiry" >&2
      exit 1
    fi
    expiry=$(( $(date -u +%s) + MINUTES * 60 ))
    cp -- "$STATE_FILE" "$work_file"
    printf '%s\t%s\n' "$expiry" "$CIDR" >>"$work_file"
    load_managed_rule_numbers "$CIDR"
    (( ${#MANAGED_RULE_NUMBERS[@]} == 0 )) || {
      echo "ERROR: an identically managed emergency UFW rule already exists outside state" >&2
      exit 1
    }
    if ! "$UFW_BIN" allow proto tcp from "$CIDR" to any port 80,443 comment 'NET-02 emergency expiring' >/dev/null; then
      delete_managed_rules_by_number "$CIDR" >/dev/null 2>&1 || true
      alert_state_failure
      echo "ERROR: UFW did not confirm the emergency rule; exact cleanup was attempted" >&2
      exit 1
    fi
    load_managed_rule_numbers "$CIDR"
    if (( ${#MANAGED_RULE_NUMBERS[@]} != 1 )); then
      delete_managed_rules_by_number "$CIDR" >/dev/null 2>&1 || true
      alert_state_failure
      echo "ERROR: UFW did not expose exactly one numbered rule with the approved CIDR, ports, and comment" >&2
      exit 1
    fi
    if ! atomic_state_install "$work_file"; then
      rollback_failed=0
      delete_managed_rules_by_number "$CIDR" >/dev/null || rollback_failed=1
      alert_state_failure
      if (( rollback_failed )); then
        echo "ERROR: emergency state write and exact UFW rollback both failed; immediate manual isolation is required" >&2
      else
        echo "ERROR: emergency state write failed; the newly added exact UFW rule was rolled back" >&2
      fi
      exit 1
    fi
    echo "Emergency access for $CIDR expires automatically in $MINUTES minutes."
    ;;
  --remove)
    CIDR="$(validate_cidr "$CIDR")"
    awk -F '\t' -v cidr="$CIDR" '$2 == cidr { found=1 } END { exit !found }' "$STATE_FILE" || {
      echo "ERROR: emergency CIDR is not managed" >&2
      exit 1
    }
    delete_managed_rules_by_number "$CIDR"
    awk -F '\t' -v cidr="$CIDR" '$2 != cidr' "$STATE_FILE" >"$work_file"
    atomic_state_install "$work_file"
    ;;
  *)
    echo "Usage: $0 --add <public-cidr> <5..480-minutes> | --remove <public-cidr> | --expire" >&2
    exit 2
    ;;
esac
