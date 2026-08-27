#!/usr/bin/env bash
set -euo pipefail

IPV4_URL="${CLOUDFLARE_IPV4_URL:-https://www.cloudflare.com/ips-v4}"
IPV6_URL="${CLOUDFLARE_IPV6_URL:-https://www.cloudflare.com/ips-v6}"
STATE_DIR="${NET02_STATE_DIR:-/var/lib/data-statistics/net-02}"
STATE_FILE="$STATE_DIR/cloudflare-cidrs.txt"
LOCK_FILE="$STATE_DIR/sync.lock"
LOCKDOWN_MARKER="$STATE_DIR/lockdown-active"
LAST_SUCCESS_FILE="$STATE_DIR/last-success-epoch"
EMERGENCY_STATE_FILE="$STATE_DIR/emergency-web-access.tsv"
EMERGENCY_APPROVAL_FILE="${NET02_EMERGENCY_APPROVAL_FILE:-/etc/data-statistics/net02-emergency-cidrs.txt}"
REAL_IP_INCLUDE="${NET02_REAL_IP_INCLUDE:-/etc/nginx/snippets/data-statistics-cloudflare-real-ip.conf}"
UFW_DEFAULTS_FILE="${NET02_UFW_DEFAULTS_FILE:-/etc/default/ufw}"
UFW_APPLICATIONS_DIR="${NET02_UFW_APPLICATIONS_DIR:-/etc/ufw/applications.d}"
UFW_BIN="${NET02_UFW_BIN:-/usr/sbin/ufw}"
NGINX_BIN="${NET02_NGINX_BIN:-/usr/sbin/nginx}"
SYSTEMCTL_BIN="${NET02_SYSTEMCTL_BIN:-/usr/bin/systemctl}"
MODE=check
ACTIVATE_LOCKDOWN=false

usage() {
  echo "Usage: $0 [--check | --audit-lockdown | --apply] [--activate-lockdown]" >&2
  echo "--apply synchronizes Cloudflare firewall and Nginx real-IP ranges." >&2
  echo "--activate-lockdown also removes the pre-existing public Nginx Full rule." >&2
}

while (($#)); do
  case "$1" in
    --check) MODE=check ;;
    --audit-lockdown) MODE=audit ;;
    --apply) MODE=apply ;;
    --activate-lockdown) ACTIVATE_LOCKDOWN=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage; exit 2 ;;
  esac
  shift
done

if [[ "$ACTIVATE_LOCKDOWN" == true && "$MODE" != apply ]]; then
  echo "ERROR: --activate-lockdown requires --apply" >&2
  exit 2
fi

for command_name in curl python3 flock install mktemp grep sort wc tr date stat dirname mv chown chmod; do
  command -v "$command_name" >/dev/null || {
    echo "ERROR: required command missing: $command_name" >&2
    exit 1
  }
done
if [[ "$MODE" == apply || "$MODE" == audit ]]; then
  [[ ${EUID} -eq 0 ]] || { echo "ERROR: --apply must run as root" >&2; exit 1; }
  for executable in "$UFW_BIN" "$NGINX_BIN" "$SYSTEMCTL_BIN"; do
    [[ -x "$executable" ]] || { echo "ERROR: required executable missing: $executable" >&2; exit 1; }
  done
fi

work_dir="$(mktemp -d)"
trap 'rm -rf -- "$work_dir"' EXIT

curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 30 "$IPV4_URL" >"$work_dir/ipv4.txt"
curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
  --connect-timeout 10 --max-time 30 "$IPV6_URL" >"$work_dir/ipv6.txt"

python3 - "$work_dir/ipv4.txt" "$work_dir/ipv6.txt" "$work_dir/current.txt" <<'PY'
import ipaddress
import pathlib
import sys

v4_path, v6_path, output_path = map(pathlib.Path, sys.argv[1:])
networks = []
for expected_version, path, minimum, maximum in ((4, v4_path, 15, 64), (6, v6_path, 7, 64)):
    lines = [line.strip() for line in path.read_text().splitlines() if line.strip()]
    if not minimum <= len(lines) <= maximum:
        raise SystemExit(f"refusing unexpected Cloudflare IPv{expected_version} list length: {len(lines)}")
    for value in lines:
        network = ipaddress.ip_network(value, strict=True)
        if network.version != expected_version:
            raise SystemExit(f"wrong address family in IPv{expected_version} list: {value}")
        if network.is_private or network.is_loopback or network.is_link_local or network.is_multicast or network.is_unspecified:
            raise SystemExit(f"unsafe network in Cloudflare list: {value}")
        networks.append(network)
if len(set(networks)) != len(networks):
    raise SystemExit("duplicate network in Cloudflare lists")
output_path.write_text("".join(f"{network}\n" for network in networks))
PY

echo "Validated $(wc -l <"$work_dir/current.txt" | tr -d ' ') Cloudflare networks."
if [[ "$MODE" == check ]]; then
  echo "Check only; UFW and Nginx were not changed."
  exit 0
fi

# The state directory is a root-owned trust boundary: its previous contents
# authorize removal of formerly managed firewall rules.
if [[ ( -e "$STATE_DIR" || -L "$STATE_DIR" ) && ( ! -d "$STATE_DIR" || -L "$STATE_DIR" || "$(stat -c '%u:%g:%a' "$STATE_DIR")" != "0:0:750" ) ]]; then
  echo "ERROR: NET-02 state path is not a real directory" >&2
  exit 1
fi
if [[ "$MODE" == audit && ! -d "$STATE_DIR" ]]; then
  echo "ERROR: NET-02 state directory is missing" >&2
  exit 1
fi
if [[ "$MODE" == apply ]]; then
  install -d -o root -g root -m 0750 "$STATE_DIR"
fi
[[ "$(stat -c '%u:%g:%a' "$STATE_DIR")" == "0:0:750" ]] || {
  echo "ERROR: NET-02 state directory must be root:root mode 0750" >&2
  exit 1
}
if [[ ( -e "$LOCK_FILE" || -L "$LOCK_FILE" ) && ( ! -f "$LOCK_FILE" || -L "$LOCK_FILE" || "$(stat -c '%u:%g:%a' "$LOCK_FILE")" != "0:0:640" ) ]]; then
  echo "ERROR: NET-02 lock file is unsafe" >&2
  exit 1
fi
if [[ ! -e "$LOCK_FILE" && "$MODE" == audit ]]; then
  echo "ERROR: NET-02 lock file is missing" >&2
  exit 1
elif [[ ! -e "$LOCK_FILE" ]]; then
  (umask 0027; : >>"$LOCK_FILE")
  chown root:root "$LOCK_FILE"
  chmod 0640 "$LOCK_FILE"
fi
if [[ "$MODE" == apply ]]; then
  exec 9>>"$LOCK_FILE"
  flock -n 9 || { echo "ERROR: another NET-02 synchronization is running" >&2; exit 1; }
fi

for trusted_state in "$LOCKDOWN_MARKER" "$LAST_SUCCESS_FILE"; do
  if [[ ( -e "$trusted_state" || -L "$trusted_state" ) && ( ! -f "$trusted_state" || -L "$trusted_state" || "$(stat -c '%u:%g:%a' "$trusted_state")" != "0:0:640" ) ]]; then
    echo "ERROR: unsafe NET-02 state file: $trusted_state" >&2
    exit 1
  fi
done

atomic_state_install() {
  local source="$1" target="$2" state_temp
  state_temp="$(mktemp "$STATE_DIR/.net02-state.XXXXXX")"
  install -o root -g root -m 0640 "$source" "$state_temp"
  mv -f -- "$state_temp" "$target"
}

validate_emergency_approval_file() {
  local approval_dir
  approval_dir="$(dirname "$EMERGENCY_APPROVAL_FILE")"
  [[ -d "$approval_dir" && ! -L "$approval_dir" && "$(stat -c '%u:%g' "$approval_dir")" == "0:0" \
    && "$(stat -c '%a' "$approval_dir")" =~ ^(700|750|755)$ ]] || {
    echo "ERROR: emergency CIDR approval directory must be a real root-owned directory" >&2
    return 1
  }
  [[ -f "$EMERGENCY_APPROVAL_FILE" && ! -L "$EMERGENCY_APPROVAL_FILE" \
    && "$(stat -c '%u:%g:%a' "$EMERGENCY_APPROVAL_FILE")" == "0:0:600" ]] || {
    echo "ERROR: emergency CIDR approval file must be root:root mode 0600 and not a symlink" >&2
    return 1
  }
}

audit_web_allow_rules() {
  local audit_file="$work_dir/ufw-numbered.txt"
  local emergency_file="$EMERGENCY_STATE_FILE"
  validate_emergency_approval_file
  [[ -d "$UFW_APPLICATIONS_DIR" && ! -L "$UFW_APPLICATIONS_DIR" \
    && "$(stat -c '%u:%g' "$UFW_APPLICATIONS_DIR")" == "0:0" \
    && "$(stat -c '%a' "$UFW_APPLICATIONS_DIR")" =~ ^(700|750|755)$ ]] || {
    echo "ERROR: UFW applications directory must be a real root-owned directory" >&2
    return 1
  }
  if [[ -e "$EMERGENCY_STATE_FILE" || -L "$EMERGENCY_STATE_FILE" ]]; then
    [[ -f "$EMERGENCY_STATE_FILE" && ! -L "$EMERGENCY_STATE_FILE" \
      && "$(stat -c '%u:%g:%a' "$EMERGENCY_STATE_FILE")" == "0:0:640" ]] || {
      echo "ERROR: emergency state file is unsafe" >&2
      return 1
    }
  else
    : >"$work_dir/empty-emergency.tsv"
    emergency_file="$work_dir/empty-emergency.tsv"
  fi
  LANG=C "$UFW_BIN" status numbered >"$audit_file"
  python3 - "$audit_file" "$work_dir/current.txt" "$emergency_file" "$EMERGENCY_APPROVAL_FILE" "$UFW_APPLICATIONS_DIR" "$(date -u +%s)" <<'PY'
import configparser
import ipaddress
import pathlib
import re
import stat
import sys

rules_path, cf_path, emergency_path, approval_path, applications_path = map(pathlib.Path, sys.argv[1:6])
now = int(sys.argv[6])

def public_network(raw, label):
    try:
        network = ipaddress.ip_network(raw, strict=True)
    except ValueError as error:
        raise SystemExit(f"invalid {label} CIDR: {raw}") from error
    if network.is_private or network.is_loopback or network.is_link_local or network.is_multicast or network.is_unspecified:
        raise SystemExit(f"unsafe {label} CIDR: {raw}")
    return network

def load_lines(path, label, maximum, allow_empty=False):
    lines = path.read_text(encoding="utf-8").splitlines()
    if (not lines and not allow_empty) or len(lines) > maximum or any(not line or line != line.strip() for line in lines):
        raise SystemExit(f"{label} CIDR file is empty, oversized, or malformed")
    networks = [public_network(line, label) for line in lines]
    if len(networks) != len(set(networks)):
        raise SystemExit(f"duplicate {label} CIDR")
    return set(networks)

cloudflare = load_lines(cf_path, "Cloudflare", 128)
approved_emergency = load_lines(approval_path, "approved emergency", 128, allow_empty=True)
for network in approved_emergency:
    minimum = 24 if network.version == 4 else 64
    if network.prefixlen < minimum:
        raise SystemExit(f"approved emergency CIDR is too broad: {network}")

active_emergency = set()
for number, raw in enumerate(emergency_path.read_text(encoding="utf-8").splitlines(), 1):
    if not raw:
        continue
    fields = raw.split("\t")
    if len(fields) != 2 or not fields[0].isdigit() or len(fields[0]) != 10:
        raise SystemExit(f"malformed emergency state line {number}")
    network = public_network(fields[1], "emergency state")
    if network not in approved_emergency:
        raise SystemExit(f"emergency state CIDR lacks exact approval: {network}")
    if int(fields[0]) > now:
        active_emergency.add(network)

application_profiles = {}
for path in sorted(applications_path.iterdir()):
    file_stat = path.lstat()
    if stat.S_ISLNK(file_stat.st_mode) or not stat.S_ISREG(file_stat.st_mode):
        raise SystemExit(f"unsafe UFW application profile file: {path.name}")
    if file_stat.st_uid != 0 or file_stat.st_mode & 0o022:
        raise SystemExit(f"writable or non-root UFW application profile file: {path.name}")
    parser = configparser.ConfigParser(interpolation=None, strict=True)
    parser.optionxform = str.lower
    try:
        parser.read_string(path.read_text(encoding="utf-8"), source=path.name)
    except (UnicodeError, configparser.Error) as error:
        raise SystemExit(f"malformed UFW application profile file: {path.name}") from error
    for section in parser.sections():
        if section in application_profiles:
            raise SystemExit(f"duplicate UFW application profile: {section}")
        ports = parser.get(section, "ports", fallback=None)
        if ports is None:
            raise SystemExit(f"UFW application profile lacks ports: {section}")
        application_profiles[section] = ports

def profile_exposes_web(profile):
    for alternative in profile.split("|"):
        value, separator, protocol = alternative.strip().partition("/")
        if separator and protocol.lower() not in {"tcp", "udp"}:
            raise SystemExit(f"unsupported UFW application protocol: {alternative}")
        if not value:
            raise SystemExit("empty UFW application port expression")
        for token in value.split(","):
            match = re.fullmatch(r"(\d+)(?::(\d+))?", token)
            if not match:
                raise SystemExit(f"malformed UFW application port expression: {alternative}")
            first = int(match.group(1))
            second = int(match.group(2) or first)
            if not (1 <= first <= second <= 65535):
                raise SystemExit(f"out-of-range UFW application port expression: {alternative}")
            if first <= 80 <= second or first <= 443 <= second:
                return True
    return False

def numeric_target_exposes_web(target):
    match = re.fullmatch(r"(\d+(?::\d+)?(?:,\d+(?::\d+)?)*)?(?:/(tcp|udp))?", target, re.I)
    if not match or not match.group(1):
        return None
    exposed = False
    for token in match.group(1).split(","):
        bounds = token.split(":")
        first = int(bounds[0])
        second = int(bounds[-1])
        if not (1 <= first <= second <= 65535):
            raise SystemExit(f"out-of-range numeric UFW target: {target}")
        if first <= 80 <= second or first <= 443 <= second:
            exposed = True
    return exposed

def target_interpretations(target):
    # UFW appends interface and IPv6 markers to the displayed target. Generate
    # every strict suffix interpretation, then require exactly one known base.
    # This prevents a profile literally named "X on eth0" or "X (v6)" from
    # being silently mistaken for a different profile plus a display suffix.
    pending = [(target.strip(), False, False)]
    candidates = set()
    while pending:
        base, removed_interface, removed_v6 = pending.pop()
        candidates.add((base, removed_interface, removed_v6))
        if not removed_interface:
            interface = re.fullmatch(r"(.+?)\s+on\s+([A-Za-z0-9_.:-]+)", base)
            if interface:
                pending.append((interface.group(1), True, removed_v6))
        if not removed_v6:
            ipv6 = re.fullmatch(r"(.+?)\s+\(v6\)", base, re.I)
            if ipv6:
                pending.append((ipv6.group(1), removed_interface, True))

    known = []
    for base, removed_interface, removed_v6 in candidates:
        numeric_web = numeric_target_exposes_web(base)
        if numeric_web is not None:
            known.append(("numeric", base, removed_interface, removed_v6, numeric_web))
        if base in application_profiles:
            known.append((
                "profile", base, removed_interface, removed_v6,
                profile_exposes_web(application_profiles[base]),
            ))
    if not known:
        raise SystemExit(f"unknown or deleted UFW application target: {target}")
    if len(known) != 1:
        raise SystemExit(f"ambiguous UFW target/interface/IPv6 interpretation: {target}")
    return known[0]

for raw in rules_path.read_text(encoding="utf-8").splitlines():
    match = re.match(r"^\[\s*\d+\]\s+(.*?)\s+(?:ALLOW|LIMIT)\s+(?:IN|FWD)\s+(.*)$", raw)
    if not match:
        continue
    target, source_and_comment = match.groups()
    _, _, _, _, exposes_web = target_interpretations(target)
    if not exposes_web:
        continue
    source, separator, comment = source_and_comment.rpartition(" # ")
    if not separator or "#" in source or "#" in comment:
        raise SystemExit(f"web allow rule has a missing or malformed managed comment: {raw}")
    source = re.sub(r"\s+\(v6\)$", "", source.strip())
    network = public_network(source, "UFW web source")
    if comment == "NET-02 Cloudflare origin" and network in cloudflare:
        continue
    if comment == "NET-02 emergency expiring" and network in active_emergency:
        continue
    raise SystemExit(f"unmanaged, expired, or non-approved web allow rule: {raw}")
PY
}

[[ -f "$UFW_DEFAULTS_FILE" && ! -L "$UFW_DEFAULTS_FILE" ]] || {
  echo "ERROR: UFW defaults file is missing or unsafe" >&2
  exit 1
}
[[ "$(stat -c '%u:%g' "$UFW_DEFAULTS_FILE")" == "0:0" ]] || {
  echo "ERROR: UFW defaults file must be root-owned" >&2
  exit 1
}
case "$(stat -c '%a' "$UFW_DEFAULTS_FILE")" in
  600|640|644) ;;
  *) echo "ERROR: UFW defaults file permissions are unsafe" >&2; exit 1 ;;
esac
grep -Eq '^[[:space:]]*IPV6[[:space:]]*=[[:space:]]*yes[[:space:]]*$' "$UFW_DEFAULTS_FILE" || {
  echo "ERROR: UFW IPv6 support must be enabled before origin lockdown" >&2
  exit 1
}
LANG=C "$UFW_BIN" status verbose >"$work_dir/ufw-verbose.txt"
grep -Eq '^Status:[[:space:]]+active$' "$work_dir/ufw-verbose.txt" || {
  echo "ERROR: UFW must be active" >&2
  exit 1
}
grep -Eq '^Default:[[:space:]]+deny \(incoming\)' "$work_dir/ufw-verbose.txt" || {
  echo "ERROR: UFW default incoming policy must be deny" >&2
  exit 1
}

: >"$work_dir/previous.txt"
if [[ -e "$STATE_FILE" || -L "$STATE_FILE" ]]; then
  [[ -f "$STATE_FILE" && ! -L "$STATE_FILE" && "$(stat -c '%u:%g:%a' "$STATE_FILE")" == "0:0:640" ]] || {
    echo "ERROR: managed CIDR state file ownership/type is unsafe" >&2
    exit 1
  }
  cp -- "$STATE_FILE" "$work_dir/previous.txt"
fi

python3 - "$work_dir/previous.txt" "$work_dir/current.txt" <<'PY'
import ipaddress
import pathlib
import sys

previous_path, current_path = map(pathlib.Path, sys.argv[1:])
def load(path):
    values = [line.strip() for line in path.read_text().splitlines() if line.strip()]
    networks = []
    for value in values:
        network = ipaddress.ip_network(value, strict=True)
        if network.is_private or network.is_loopback or network.is_link_local or network.is_multicast or network.is_unspecified:
            raise SystemExit(f"unsafe managed network: {value}")
        networks.append(network)
    if len(networks) != len(set(networks)):
        raise SystemExit("duplicate managed network")
    return set(networks)
previous = load(previous_path)
current = load(current_path)
if previous:
    overlap = len(previous & current) / len(previous)
    if overlap < 0.75 or len(previous ^ current) > 12:
        raise SystemExit("Cloudflare range change exceeds automatic safety threshold")
PY

if [[ -f "$LOCKDOWN_MARKER" ]]; then
  audit_web_allow_rules
elif [[ "$MODE" == audit ]]; then
  echo "ERROR: origin lockdown is not active" >&2
  exit 1
fi

if [[ "$MODE" == audit ]]; then
  echo "PASS: origin lockdown rules allow web traffic only from approved sources."
  exit 0
fi

while IFS= read -r cidr; do
  "$UFW_BIN" allow proto tcp from "$cidr" to any port 80,443 comment 'NET-02 Cloudflare origin' >/dev/null
done <"$work_dir/current.txt"

render_real_ip() {
  local list_file="$1"
  local output_file="$2"
  {
    echo "# NET-02 managed Cloudflare real IPs; do not edit by hand."
    while IFS= read -r cidr; do
      [[ -n "$cidr" ]] && printf 'set_real_ip_from %s;\n' "$cidr"
    done <"$list_file"
    echo "real_ip_header CF-Connecting-IP;"
    echo "real_ip_recursive on;"
  } >"$output_file"
}

install_real_ip() {
  local list_file="$1"
  local rendered="$work_dir/real-ip.conf"
  local backup="$work_dir/real-ip.previous"
  local had_previous=false
  local target_dir target_temp
  target_dir="$(dirname "$REAL_IP_INCLUDE")"
  [[ -d "$target_dir" && ! -L "$target_dir" ]] || { echo "ERROR: Nginx snippet directory is unsafe" >&2; return 1; }
  [[ "$(stat -c '%u:%g' "$target_dir")" == "0:0" ]] || { echo "ERROR: Nginx snippet directory must be root-owned" >&2; return 1; }
  if [[ -e "$REAL_IP_INCLUDE" || -L "$REAL_IP_INCLUDE" ]]; then
    [[ -f "$REAL_IP_INCLUDE" && ! -L "$REAL_IP_INCLUDE" && "$(stat -c '%u:%g:%a' "$REAL_IP_INCLUDE")" == "0:0:644" ]] || { echo "ERROR: real-IP include is unsafe" >&2; return 1; }
    cp -p -- "$REAL_IP_INCLUDE" "$backup"
    had_previous=true
  fi
  render_real_ip "$list_file" "$rendered"
  target_temp="$(mktemp "$target_dir/.net02-real-ip.XXXXXX")"
  install -o root -g root -m 0644 "$rendered" "$target_temp"
  mv -f -- "$target_temp" "$REAL_IP_INCLUDE"
  if ! "$NGINX_BIN" -t >/dev/null 2>&1 \
    || ! "$NGINX_BIN" -T >"$work_dir/nginx-effective.txt" 2>&1 \
    || ! grep -Fq '# NET-02 managed Cloudflare real IPs' "$work_dir/nginx-effective.txt" \
    || ! grep -Eq 'proxy_set_header[[:space:]]+X-Real-IP[[:space:]]+\$remote_addr;' "$work_dir/nginx-effective.txt"; then
    if [[ "$had_previous" == true ]]; then
      target_temp="$(mktemp "$target_dir/.net02-real-ip.XXXXXX")"
      install -o root -g root -m 0644 "$backup" "$target_temp"
      mv -f -- "$target_temp" "$REAL_IP_INCLUDE"
    else rm -f -- "$REAL_IP_INCLUDE"; fi
    echo "ERROR: generated Nginx real-IP include is invalid or not wired to X-Real-IP" >&2
    return 1
  fi
  if ! "$SYSTEMCTL_BIN" reload nginx; then
    if [[ "$had_previous" == true ]]; then
      target_temp="$(mktemp "$target_dir/.net02-real-ip.XXXXXX")"
      install -o root -g root -m 0644 "$backup" "$target_temp"
      mv -f -- "$target_temp" "$REAL_IP_INCLUDE"
    else rm -f -- "$REAL_IP_INCLUDE"; fi
    "$NGINX_BIN" -t >/dev/null 2>&1 && "$SYSTEMCTL_BIN" reload nginx || true
    echo "ERROR: Nginx reload failed; previous real-IP configuration restored" >&2
    return 1
  fi
}

sort -u "$work_dir/previous.txt" "$work_dir/current.txt" >"$work_dir/transition.txt"
install_real_ip "$work_dir/transition.txt"

while IFS= read -r old_cidr; do
  [[ -z "$old_cidr" ]] && continue
  if ! grep -Fqx -- "$old_cidr" "$work_dir/current.txt"; then
    if ! "$UFW_BIN" --force delete allow proto tcp from "$old_cidr" to any port 80,443 >/dev/null; then
      if LANG=C "$UFW_BIN" status | grep -Fq -- "$old_cidr"; then
        echo "ERROR: could not remove stale managed range: $old_cidr" >&2
        exit 1
      fi
    fi
  fi
done <"$work_dir/previous.txt"

install_real_ip "$work_dir/current.txt"
atomic_state_install "$work_dir/current.txt" "$STATE_FILE"

if [[ "$ACTIVATE_LOCKDOWN" == true ]]; then
  [[ "${CONFIRM_NET02_LOCKDOWN:-}" == "YES" ]] || {
    echo "ERROR: set CONFIRM_NET02_LOCKDOWN=YES for the one-time public-rule removal" >&2
    exit 1
  }
  "$UFW_BIN" --force delete allow 'Nginx Full'
  atomic_state_install /dev/null "$LOCKDOWN_MARKER"
fi

if [[ -f "$LOCKDOWN_MARKER" || "$ACTIVATE_LOCKDOWN" == true ]]; then
  audit_web_allow_rules
fi

date -u +%s >"$work_dir/last-success"
atomic_state_install "$work_dir/last-success" "$LAST_SUCCESS_FILE"
if [[ "$ACTIVATE_LOCKDOWN" == true ]]; then
  echo "Public Nginx Full rule removed. Run external IPv4/IPv6 verification immediately."
else
  echo "Cloudflare firewall and Nginx real-IP ranges synchronized."
fi
