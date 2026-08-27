#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/etc/data-statistics/app.env"

if [[ "${EUID}" -ne 0 ]]; then
  printf '请使用 root 运行这个配置工具。\n' >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  printf '没有找到生产环境配置：%s\n' "${ENV_FILE}" >&2
  exit 1
fi

printf '此工具只在服务器本机保存密钥，输入内容不会显示在屏幕上。\n'
read -r -s -p '新的 Telegram Bot Token：' telegram_token
printf '\n'
read -r -s -p '新的 DeepSeek API Key：' deepseek_key
printf '\n'

if [[ ! "${telegram_token}" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
  printf 'Telegram Bot Token 格式不正确。\n' >&2
  exit 1
fi

if [[ ! "${deepseek_key}" =~ ^sk-[A-Za-z0-9_-]+$ ]]; then
  printf 'DeepSeek API Key 格式不正确。\n' >&2
  exit 1
fi

bot_result="$(curl -fsS --max-time 20 "https://api.telegram.org/bot${telegram_token}/getMe")"
if [[ "$(jq -r '.ok // false' <<<"${bot_result}")" != "true" ]]; then
  printf 'Telegram Bot Token 验证失败。\n' >&2
  exit 1
fi
bot_name="$(jq -r '.result.username' <<<"${bot_result}")"
printf '已识别机器人：@%s\n' "${bot_name}"

printf '公开频道请输入 @频道用户名。\n'
printf '私密频道请先把机器人设为管理员，并在频道发一条新消息，然后这里直接回车。\n'
read -r -p '频道标识：' channel_target

if [[ -z "${channel_target}" ]]; then
  updates="$(curl -fsS --max-time 20 "https://api.telegram.org/bot${telegram_token}/getUpdates")"
  channel_target="$(jq -r '[.result[] | .channel_post.chat? | select(.type == "channel")][-1].id // empty' <<<"${updates}")"
  channel_title="$(jq -r '[.result[] | .channel_post.chat? | select(.type == "channel")][-1].title // empty' <<<"${updates}")"
  if [[ -z "${channel_target}" ]]; then
    printf '还没有检测到频道消息。请确认机器人是管理员，再在频道发一条新消息后重试。\n' >&2
    exit 1
  fi
  printf '已识别私密频道：%s（%s）\n' "${channel_title}" "${channel_target}"
fi

if [[ ! "${channel_target}" =~ ^@[A-Za-z0-9_]{5,}$ && ! "${channel_target}" =~ ^-100[0-9]+$ ]]; then
  printf '频道标识格式不正确，应为 @频道用户名 或 -100 开头的频道 ID。\n' >&2
  exit 1
fi

test_result="$(curl -fsS --max-time 30 \
  --data-urlencode "chat_id=${channel_target}" \
  --data-urlencode 'text=✅ 数据统计机器人连接成功。每日经营简报和加密备份将发送到本频道。' \
  "https://api.telegram.org/bot${telegram_token}/sendMessage")"
if [[ "$(jq -r '.ok // false' <<<"${test_result}")" != "true" ]]; then
  printf '机器人无法向频道发消息，请检查管理员的“发布消息”权限。\n' >&2
  exit 1
fi

env_tmp="$(mktemp)"
trap 'rm -f "${env_tmp}"' EXIT
grep -vE '^(TELEGRAM_BOT_TOKEN|TELEGRAM_BOSS_CHAT_ID|DEEPSEEK_API_KEY)=' "${ENV_FILE}" > "${env_tmp}"
{
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "${telegram_token}"
  printf 'TELEGRAM_BOSS_CHAT_ID=%s\n' "${channel_target}"
  printf 'DEEPSEEK_API_KEY=%s\n' "${deepseek_key}"
} >> "${env_tmp}"
install -o root -g root -m 0600 "${env_tmp}" "${ENV_FILE}"
systemctl restart data-statistics

printf '配置已安全保存，机器人测试消息已经发送。\n'
