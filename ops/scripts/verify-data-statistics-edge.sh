#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <public-domain> <origin-ipv4> <origin-ipv6> [additional-origin-ip ...]" >&2
  exit 2
fi

domain="$1"
shift
origin_ips=("$@")
curl_common=(--noproxy '*' --silent --show-error --connect-timeout 5 --max-time 15)

[[ "$domain" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$ && "$domain" == *.* ]] || {
  echo "ERROR: invalid public domain" >&2
  exit 2
}

headers="$(mktemp)"
body="$(mktemp)"
validated_file="$(mktemp)"
trap 'rm -f -- "$headers" "$body" "$validated_file"' EXIT

python3 - "${origin_ips[@]}" >"$validated_file" <<'PY'
import ipaddress
import sys

addresses = []
for raw in sys.argv[1:]:
    address = ipaddress.ip_address(raw)
    if address.is_private or address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified:
        raise SystemExit(f"origin address must be a public unicast address: {raw}")
    addresses.append(address)
if not any(address.version == 4 for address in addresses) or not any(address.version == 6 for address in addresses):
    raise SystemExit("both origin IPv4 and IPv6 addresses are required")
for address in addresses:
    print(address.compressed)
PY
mapfile -t validated_origins <"$validated_file"

for family in 4 6; do
  curl "${curl_common[@]}" "-${family}" --fail --output /dev/null "http://${domain}/"
  curl "${curl_common[@]}" "-${family}" --fail --location --dump-header "$headers" \
    --output "$body" "https://${domain}/login"
  for header in \
    strict-transport-security \
    content-security-policy-report-only \
    permissions-policy \
    x-content-type-options \
    referrer-policy; do
    grep -Eqi "^${header}:" "$headers" || {
      echo "ERROR: missing ${header} on IPv${family} login response" >&2
      exit 1
    }
  done

  if grep -Eqi '^server:[[:space:]]*nginx/' "$headers"; then
    echo "ERROR: Nginx version is exposed on IPv${family}" >&2
    exit 1
  fi

  static_path="$(grep -Eo '/_next/static/[^"? ]+' "$body" | head -n 1 || true)"
  [[ -n "$static_path" ]] || { echo "ERROR: no Next.js static asset found over IPv${family}" >&2; exit 1; }
  curl "${curl_common[@]}" "-${family}" --fail --output /dev/null "https://${domain}${static_path}"

  api_status="$(curl "${curl_common[@]}" "-${family}" --output /dev/null --write-out '%{http_code}' \
    "https://${domain}/api/auth/login")"
  if [[ "$api_status" == 000 || "$api_status" -ge 500 ]]; then
    echo "ERROR: IPv${family} API smoke test returned ${api_status}" >&2
    exit 1
  fi
done

for origin_ip in "${validated_origins[@]}"; do
  resolve_ip="$origin_ip"
  [[ "$origin_ip" == *:* ]] && resolve_ip="[$origin_ip]"
  for port in 80 443; do
    scheme=http
    [[ "$port" == 443 ]] && scheme=https
    if curl "${curl_common[@]}" --output /dev/null \
      --resolve "${domain}:${port}:${resolve_ip}" "${scheme}://${domain}:${port}/" 2>/dev/null; then
      echo "ERROR: origin ${origin_ip}:${port} remains directly reachable" >&2
      exit 1
    fi
  done
done

echo "PASS: public IPv4/IPv6 paths, app/API/headers, and every origin IPv4/IPv6 port are verified."
