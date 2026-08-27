#!/usr/bin/env bash
set -euo pipefail

readonly REPO_ROOT="${1:?repository root is required}"
readonly SECURITY_LOG="/var/log/nginx/security.log"
readonly ACCESS_LOG="/var/log/nginx/access.log"
readonly TEST_USERNAME="LOG02_USERNAME_MARKER_83b6a1"
readonly TEST_PASSWORD="harmless-test-password"
readonly TEST_PREFIX="$(mktemp -d /tmp/data-statistics-nginx.XXXXXX)"
backend_pid=""
headers_file=""
nginx_started=false

cleanup() {
  if [[ "$nginx_started" == true ]]; then
    nginx -p "$TEST_PREFIX/" -c verify-LOG-02.conf -s stop 2>/dev/null || true
  fi
  [[ -z "$backend_pid" ]] || kill "$backend_pid" 2>/dev/null || true
  [[ -z "$headers_file" ]] || rm -f -- "$headers_file"
  case "$TEST_PREFIX" in
    /tmp/data-statistics-nginx.??????) rm -rf -- "$TEST_PREFIX" ;;
    *) echo "ERROR: refusing to remove unsafe Nginx test prefix: $TEST_PREFIX" >&2 ;;
  esac
}
trap cleanup EXIT

chmod 0755 "$TEST_PREFIX"
for source in verify-LOG-02.conf data-statistics-logging.conf verify-LOG-02.htpasswd; do
  install -m 0644 "$REPO_ROOT/ops/nginx/$source" "$TEST_PREFIX/$source"
  cmp -s "$REPO_ROOT/ops/nginx/$source" "$TEST_PREFIX/$source"
done
python3 - "$TEST_PREFIX" <<'PY'
import pathlib
import stat
import sys

prefix = pathlib.Path(sys.argv[1])
if stat.S_IMODE(prefix.stat().st_mode) != 0o755:
    raise SystemExit("Nginx test prefix is not traversable by the unprivileged worker")
for name in ("verify-LOG-02.conf", "data-statistics-logging.conf", "verify-LOG-02.htpasswd"):
    path = prefix / name
    if path.is_symlink() or not path.is_file() or stat.S_IMODE(path.stat().st_mode) != 0o644:
        raise SystemExit(f"unsafe Nginx test fixture permissions: {name}")
PY

python3 -c '
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        request_path = urlsplit(self.path).path
        self.send_response(204 if request_path == "/ok" else 403)
        if request_path == "/marked": self.send_header("X-Security-Audit", "app")
        self.end_headers()
    def log_message(self, *_): pass
HTTPServer(("127.0.0.1", 18081), Handler).serve_forever()
' &
backend_pid=$!
headers_file="$(mktemp)"

wait_for_status() {
  local url="$1"
  local expected="$2"
  local status=""
  for _ in $(seq 1 50); do
    status="$(curl --noproxy '*' --silent --show-error --user "${TEST_USERNAME}:${TEST_PASSWORD}" \
      --output /dev/null --write-out '%{http_code}' "$url" || true)"
    if [[ "$status" == "$expected" ]]; then
      return 0
    fi
    sleep 0.1
  done
  echo "expected HTTP $expected from $url, got ${status:-no response}" >&2
  return 1
}

wait_for_status http://127.0.0.1:18081/ok 204
nginx -p "$TEST_PREFIX/" -c verify-LOG-02.conf
nginx_started=true
wait_for_status http://127.0.0.1:18080/ok 204

: > "$ACCESS_LOG"
: > "$SECURITY_LOG"
query_marker="LOG02_QUERY_MARKER_7d31c8"
username_marker="$TEST_USERNAME"
referer_marker="LOG02_REFERER_MARKER_61ad29"
user_agent_marker="LOG02_USER_AGENT_MARKER_0c42ef"
curl --noproxy '*' --silent --show-error --fail --output /dev/null \
  --user "${username_marker}:${TEST_PASSWORD}" \
  --header "Referer: https://example.invalid/${referer_marker}" \
  --user-agent "$user_agent_marker" \
  "http://127.0.0.1:18080/ok?marker=${query_marker}&username=${username_marker}"
wait_for_status http://127.0.0.1:18080/marked 403
wait_for_status http://127.0.0.1:18080/unmarked 403
wait_for_status http://127.0.0.1:18080/ok 204

python3 - "$ACCESS_LOG" "$query_marker" "$username_marker" "$referer_marker" "$user_agent_marker" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
markers = sys.argv[2:]
raw = path.read_text(encoding="utf-8")
if not raw.strip():
    raise SystemExit("privacy access log is empty")
for marker in [*markers, "127.0.0.1"]:
    if marker in raw:
        raise SystemExit(f"privacy access log leaked controlled marker: {marker}")
required_keys = {"timestamp", "requestId", "method", "path", "protocol", "status", "bytesSent", "requestTime"}
entries = []
for number, line in enumerate(raw.splitlines(), 1):
    try:
        entry = json.loads(line)
    except json.JSONDecodeError as error:
        raise SystemExit(f"privacy access log line {number} is not valid JSON: {error}") from error
    if set(entry) != required_keys:
        raise SystemExit(f"privacy access log line {number} has unexpected fields: {sorted(entry)}")
    if "?" in entry["path"]:
        raise SystemExit(f"privacy access log line {number} contains a query string")
    entries.append(entry)
if not any(entry["path"] == "/ok" and entry["status"] == 204 for entry in entries):
    raise SystemExit("privacy access log lacks the controlled /ok request")
PY

test "$(wc -l < "$SECURITY_LOG")" -eq 1
grep -F '"event":"AUTHORIZATION_DENIED"' "$SECURITY_LOG" >/dev/null
grep -F '"userId":null' "$SECURITY_LOG" >/dev/null
grep -F '"teamId":null' "$SECURITY_LOG" >/dev/null
curl --noproxy '*' --silent --show-error --dump-header "$headers_file" --output /dev/null \
  --user "${TEST_USERNAME}:${TEST_PASSWORD}" \
  http://127.0.0.1:18080/marked
if grep -qi '^X-Security-Audit:' "$headers_file"; then
  echo "internal audit marker leaked through Nginx" >&2
  exit 1
fi
