#!/usr/bin/env bash
set -euo pipefail

port="${1:-3001}"
deploy_root="${DEPLOY_ROOT:-/opt/data-statistics}"

if [[ ! "$port" =~ ^[0-9]+$ ]] || ((port < 1 || port > 65535)); then
  echo "ERROR: port must be an integer between 1 and 65535" >&2
  exit 2
fi

echo "Listening process on TCP ${port}:"
sudo -n ss -H -lntp "sport = :${port}" || true

pids=()
while IFS= read -r pid; do
  [[ -n "$pid" ]] && pids+=("$pid")
done < <(sudo -n ss -H -lntp "sport = :${port}" | grep -Eo 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)
if ((${#pids[@]} == 0)); then
  echo "No listener found."
else
  for pid in "${pids[@]}"; do
    echo
    echo "PID ${pid}:"
    sudo -n ps -o user=,pid=,ppid=,lstart=,etimes=,args= -p "$pid"
    printf 'cwd: '
    sudo -n readlink -f "/proc/${pid}/cwd"
    printf 'cgroup: '
    sudo -n cat "/proc/${pid}/cgroup" | tr '\n' ' '
    echo
    printf 'starttime_ticks: '
    sudo -n sed -E 's/^[0-9]+ \(.*\) //' "/proc/${pid}/stat" | awk '{print $20}'
    # Do not print journal lines here: historical launch commands may contain secrets.
    unit="$(sudo -n awk -F/ 'NR == 1 { print $NF }' "/proc/${pid}/cgroup")"
    if [[ -n "$unit" ]]; then
      sudo -n systemctl show "$unit" \
        -p Id -p Names -p Description -p LoadState -p ActiveState -p SubState -p FragmentPath || true
    fi
  done
fi

echo
echo "Established connections involving TCP ${port}:"
connections="$(sudo -n ss -H -ntp | awk -v suffix=":${port}" '$4 ~ suffix "$" || $5 ~ suffix "$"')"
if [[ -n "$connections" ]]; then
  printf '%s\n' "$connections"
else
  echo "None at inspection time."
fi

echo
echo "Nginx references to TCP ${port} (including upstream server entries):"
nginx_refs="$(sudo -n nginx -T 2>/dev/null | grep -Ev '^[[:space:]]*#' | grep -E "(^|[^0-9])${port}([^0-9]|$)" || true)"
if [[ -n "$nginx_refs" ]]; then
  printf '%s\n' "$nginx_refs"
else
  echo "None."
fi

echo
echo "Release inventory:"
sudo -n find "${deploy_root}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr
printf 'release_count: '
sudo -n find "${deploy_root}/releases" -mindepth 1 -maxdepth 1 -type d -printf x | wc -c
sudo -n du -sh "${deploy_root}/releases"
printf 'current_release: '
sudo -n readlink -f "${deploy_root}/app"

echo
echo "Possible persistent startup entries (file names only; command contents are not printed):"
startup_files="$(sudo -n grep -RIlE \
  '(^|[^0-9])3001([^0-9]|$)|next[[:space:]]+(start|dev)' \
  /etc/systemd/system /usr/lib/systemd/system /lib/systemd/system \
  /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly \
  /etc/crontab /etc/rc.local 2>/dev/null || true)"
if [[ -n "$startup_files" ]]; then
  printf '%s\n' "$startup_files"
else
  echo "None in system units or system cron files."
fi
if ! sudo -n -u data-statistics true 2>/dev/null; then
  echo "WARNING: unable to inspect data-statistics user startup entries."
else
  if sudo -n -u data-statistics crontab -l 2>/dev/null | grep -Eq '(^|[^0-9])3001([^0-9]|$)|next[[:space:]]+(start|dev)'; then
    echo "WARNING: data-statistics user crontab contains a possible startup entry (content suppressed)."
  else
    echo "No matching data-statistics user crontab entry."
  fi
  user_home="$(getent passwd data-statistics | cut -d: -f6)"
  profile_files="$(sudo -n grep -IlE '(^|[^0-9])3001([^0-9]|$)|next[[:space:]]+(start|dev)' \
    "${user_home}/.profile" "${user_home}/.bash_profile" "${user_home}/.bashrc" \
    "${user_home}/.zprofile" "${user_home}/.zshrc" 2>/dev/null || true)"
  if [[ -n "$profile_files" ]]; then
    printf 'WARNING: possible user profile startup entries (content suppressed):\n%s\n' "$profile_files"
  else
    echo "No matching data-statistics login profile entry."
  fi
fi
linger="$(sudo -n loginctl show-user data-statistics -p Linger --value 2>/dev/null || true)"
echo "data-statistics user lingering: ${linger:-unknown}"
