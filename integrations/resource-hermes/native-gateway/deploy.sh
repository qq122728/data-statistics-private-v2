#!/usr/bin/env bash
# Run as root with a staged standalone bridge and checked native profile files.
set -euo pipefail
umask 077
stage=${1:?staging directory required}
release_name=${2:?release name required}
[[ "$release_name" =~ ^[a-zA-Z0-9-]+$ ]]
exec 9>/run/lock/resource-bot-deploy.lock
flock -n 9
base=/opt/data-statistics-resource-bot
old=$(readlink -f "$base/current")
new=$base/releases/$release_name
backup=$base/backups/pre-$release_name
profile=/var/lib/hermes-resource/.hermes
[ ! -e "$new" ] && [ ! -e "$backup" ]
mkdir -p "$backup"
printf '%s\n' "$old" > "$backup/previous-release.txt"
cp -a "$profile/config.yaml" "$profile/INSTRUCTIONS.md" "$profile/plugins" "$backup/"
cp -a /etc/systemd/system/hermes-resource.service "$backup/"
cp -a /etc/systemd/system/data-statistics-resource-bot.service.d/hermes.conf "$backup/bridge-previous.conf"
[ ! -f /etc/data-statistics/resource-native-telegram.env ] || cp -a /etc/data-statistics/resource-native-telegram.env "$backup/"
cp -a --reflink=auto "$old" "$new"
install -o root -g data-statistics -m 640 "$stage/bridge.cjs" "$new/bridge.cjs"
install -d -m 2750 -o data-statistics -g hermes-resource /var/lib/resource-reports
rollback() {
  systemctl stop hermes-resource data-statistics-resource-bot || true
  cp -a "$backup/config.yaml" "$backup/INSTRUCTIONS.md" "$profile/"
  rm -rf "$profile/plugins/resource-reports"
  cp -a "$backup/plugins/resource-reports" "$profile/plugins/"
  cp -a "$backup/hermes-resource.service" /etc/systemd/system/hermes-resource.service
  cp -a "$backup/bridge-previous.conf" /etc/systemd/system/data-statistics-resource-bot.service.d/hermes.conf
  ln -s "$old" "$base/current.native-rollback"; mv -Tf "$base/current.native-rollback" "$base/current"
  if [ -f "$backup/resource-native-telegram.env" ]; then
    cp -a "$backup/resource-native-telegram.env" /etc/data-statistics/resource-native-telegram.env
  else
    rm -f /etc/data-statistics/resource-native-telegram.env
  fi
  systemctl daemon-reload
  systemctl start hermes-resource data-statistics-resource-bot
  echo RESOURCE_NATIVE_DEPLOY_ROLLED_BACK
}
trap rollback ERR
# Shut down the only existing Telegram poller before switching to the native gateway.
systemctl stop data-statistics-resource-bot hermes-resource
cp "$stage/config.yaml" "$profile/config.yaml"
cp "$stage/INSTRUCTIONS.md" "$profile/INSTRUCTIONS.md"
cat "$stage/prompt-addendum.md" >> "$profile/INSTRUCTIONS.md"
for f in __init__.py native.py query-schema.json plugin.yaml; do
  install -o hermes-resource -g hermes-resource -m 600 "$stage/$f" "$profile/plugins/resource-reports/$f"
done
python3 - "$base/shared" "$profile" <<'PY'
import json, os, pathlib, sys
shared, profile=map(pathlib.Path,sys.argv[1:])
c=json.loads((shared/'config.json').read_text()); access=json.loads((shared/'private-access.json').read_text())
assert c['enabled'] and c['chatId'] and access['botId']==c['botId']
assert c['username']=='ziyuanfeicanmou_bot', 'Unexpected bot identity'
uids=access['userIds']; assert uids and all(str(x).isdigit() for x in uids)
assert str(c['chatId']).startswith('-')
# Credentials are copied within the server, never passed on a command line or printed.
values={'TELEGRAM_BOT_TOKEN':c['token'], 'TELEGRAM_ALLOWED_USERS':','.join(uids),
 'TELEGRAM_ALLOWED_CHATS':','.join([c['chatId'],*uids]), 'TELEGRAM_GROUP_ALLOWED_CHATS':c['chatId'],
 'RESOURCE_PRIVATE_USER_IDS':','.join(uids),'RESOURCE_GROUP_CHAT_ID':c['chatId'],
 'RESOURCE_NATIVE_GATEWAY':'1','GATEWAY_ALLOW_ALL_USERS':'false','TELEGRAM_ALLOW_ALL_USERS':'false',
 'HERMES_MEDIA_DELIVERY_STRICT':'1','HERMES_MEDIA_TRUST_RECENT_FILES':'0',
 'HERMES_MEDIA_ALLOW_DIRS':'/var/lib/resource-reports'}
assert all('\n' not in v and '\r' not in v and '"' not in v for v in values.values())
p=pathlib.Path('/etc/data-statistics/resource-native-telegram.env')
p.write_text(''.join(k+'="'+v+'"\n' for k,v in values.items()));p.chmod(0o600)
# Config allowlists must match the existing binding exactly.
p=profile/'config.yaml';text=p.read_text()
text=text.replace("allowed_chats: ['-5133647199', '8387614254']",'allowed_chats: '+json.dumps([c['chatId'],*uids]))
text=text.replace("group_allowed_chats: ['-5133647199']",'group_allowed_chats: '+json.dumps([c['chatId']]))
text=text.replace("allow_from: ['8387614254']",'allow_from: '+json.dumps(uids))
p.write_text(text)
PY
chown hermes-resource:hermes-resource "$profile/config.yaml" "$profile/INSTRUCTIONS.md"
chmod 600 "$profile/config.yaml" "$profile/INSTRUCTIONS.md"
install -o root -g root -m 644 "$stage/hermes-resource.service" /etc/systemd/system/hermes-resource.service
install -o root -g root -m 644 "$stage/bridge-override.conf" /etc/systemd/system/data-statistics-resource-bot.service.d/hermes.conf
ln -s "$new" "$base/current.native-next"; mv -Tf "$base/current.native-next" "$base/current"
systemctl daemon-reload
systemctl start data-statistics-resource-bot
for attempt in {1..15}; do
  if python3 - <<'PY'
import socket
s=socket.create_connection(('127.0.0.1',4187),2);s.close()
PY
  then break; fi
  sleep 1
done
systemctl is-active --quiet data-statistics-resource-bot
systemctl start hermes-resource
sleep 10
systemctl is-active --quiet hermes-resource
# Confirm ownership of the polling process; no wrapper or second Telegram worker remains.
pid=$(systemctl show hermes-resource -p MainPID --value)
tr '\0' ' ' < "/proc/$pid/cmdline" | grep -q 'hermes gateway run'
trap - ERR
echo RESOURCE_NATIVE_DEPLOY_STARTED
printf 'Rollback backup: %s\n' "$backup"
