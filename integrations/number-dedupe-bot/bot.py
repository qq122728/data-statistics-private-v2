"""Telegram long-polling worker for the independent number library."""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from core import (
    ImportErrorForUser,
    MAX_INPUT_BYTES,
    latest_result,
    looks_like_record_template,
    normalize_phone,
    open_database,
    process_file,
)


class TelegramError(RuntimeError):
    pass


class Telegram:
    def __init__(self, token: str):
        self.api_url = f"https://api.telegram.org/bot{token}/"
        self.file_url = f"https://api.telegram.org/file/bot{token}/"

    def call(self, method: str, payload: dict) -> object:
        request = urllib.request.Request(
            self.api_url + method,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=40) as response:
                result = json.load(response)
        except (urllib.error.URLError, TimeoutError) as exc:
            raise TelegramError(f"Telegram {method} 请求失败") from exc
        if not result.get("ok"):
            raise TelegramError(f"Telegram {method} 返回失败")
        return result["result"]

    def download(self, file_id: str, expected_size: int | None) -> bytes:
        if expected_size is not None and expected_size > MAX_INPUT_BYTES:
            raise ImportErrorForUser("文件超过 20 MB，请拆成多个文件再上传。")
        file_info = self.call("getFile", {"file_id": file_id})
        path = file_info.get("file_path")
        if not path:
            raise TelegramError("Telegram 没有返回文件路径")
        url = self.file_url + urllib.parse.quote(path, safe="/")
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read(MAX_INPUT_BYTES + 1)
        except (urllib.error.URLError, TimeoutError) as exc:
            raise TelegramError("Telegram 文件下载失败") from exc
        if len(data) > MAX_INPUT_BYTES:
            raise ImportErrorForUser("文件超过 20 MB，请拆成多个文件再上传。")
        return data

    def send_message(self, chat_id: int, message: str) -> None:
        self.call("sendMessage", {"chat_id": chat_id, "text": message})

    def send_document(self, chat_id: int, path: Path, filename: str, caption: str) -> None:
        if not path.is_file():
            raise TelegramError("结果文件不存在")
        boundary = "numberbot" + uuid.uuid4().hex
        parts = []
        for key, value in (("chat_id", str(chat_id)), ("caption", caption)):
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"{key}\"\r\n\r\n".encode()
                + value.encode("utf-8") + b"\r\n"
            )
        safe_filename = re.sub(r"[\x00-\x1f/\\\"]", "_", filename)
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"{safe_filename}\"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n".encode()
            + path.read_bytes() + b"\r\n"
        )
        parts.append(f"--{boundary}--\r\n".encode())
        request = urllib.request.Request(
            self.api_url + "sendDocument",
            data=b"".join(parts),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                result = json.load(response)
        except (urllib.error.URLError, TimeoutError) as exc:
            raise TelegramError("Telegram sendDocument 请求失败") from exc
        if not result.get("ok"):
            raise TelegramError("Telegram sendDocument 返回失败")


class Bot:
    def __init__(self):
        token = os.environ.get("NUMBER_BOT_TOKEN", "").strip()
        chat = os.environ.get("NUMBER_BOT_ALLOWED_CHAT_ID", "").strip()
        if not token or not re.fullmatch(r"-\d+", chat):
            raise RuntimeError("需要配置 NUMBER_BOT_TOKEN 和负数的 NUMBER_BOT_ALLOWED_CHAT_ID")
        self.chat_id = int(chat)
        self.data_dir = Path(os.environ.get("NUMBER_BOT_DATA_DIR", "/var/lib/number-dedupe-bot"))
        self.data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.data_dir, 0o700)
        self.db = open_database(self.data_dir / "numbers.sqlite3")
        self.telegram = Telegram(token)
        self.offset_path = self.data_dir / "telegram-offset.json"
        self.offset = self._read_offset()

    def _set_mode(self, user_id: int, mode: str) -> None:
        self.db.execute(
            "INSERT INTO user_settings(chat_id, user_id, mode, mode_expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id, user_id) DO UPDATE SET mode=excluded.mode, mode_expires_at=excluded.mode_expires_at",
            (self.chat_id, user_id, mode, int(time.time()) + 900),
        )
        self.db.commit()

    def _get_mode(self, user_id: int) -> str:
        row = self.db.execute(
            "SELECT mode, mode_expires_at FROM user_settings WHERE chat_id=? AND user_id=?",
            (self.chat_id, user_id),
        ).fetchone()
        return row[0] if row and row[0] and row[1] and row[1] > time.time() else "check"

    def _clear_mode(self, user_id: int) -> None:
        self.db.execute(
            "UPDATE user_settings SET mode=NULL, mode_expires_at=NULL, column_name=NULL WHERE chat_id=? AND user_id=?",
            (self.chat_id, user_id),
        )
        self.db.commit()

    def _set_column(self, user_id: int, column: str) -> None:
        self.db.execute(
            "INSERT INTO user_settings(chat_id, user_id, column_name) VALUES (?, ?, ?) ON CONFLICT(chat_id, user_id) DO UPDATE SET column_name=excluded.column_name",
            (self.chat_id, user_id, column),
        )
        self.db.commit()

    def _get_column(self, user_id: int) -> str | None:
        row = self.db.execute(
            "SELECT column_name FROM user_settings WHERE chat_id=? AND user_id=?",
            (self.chat_id, user_id),
        ).fetchone()
        return row[0] if row else None

    def _read_offset(self) -> int | None:
        try:
            return int(json.loads(self.offset_path.read_text())["offset"])
        except (FileNotFoundError, ValueError, KeyError):
            return None

    def _save_offset(self, offset: int) -> None:
        temporary = self.offset_path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"offset": offset}))
        os.chmod(temporary, 0o600)
        temporary.replace(self.offset_path)
        self.offset = offset

    def _is_admin(self, user_id: int) -> bool:
        member = self.telegram.call("getChatMember", {"chat_id": self.chat_id, "user_id": user_id})
        return member.get("status") in ("creator", "administrator")

    def _send_results(self, result, chat_id: int, update_id: int) -> None:
        summary = (
            f"总行数：{result.total_rows}；新号码：{result.new_rows}；"
            f"本文件内重号排除：{result.repeated_rows} 行；"
            f"原始库已有：{result.existing_rows} 行；无效号码：{result.invalid_rows} 行。"
        )
        sent = self.db.execute("SELECT delivery_index FROM imports WHERE update_id=?", (update_id,)).fetchone()[0]
        if sent == 0:
            prefix = "原始库导入完成。" if not result.output_files else ""
            self.telegram.send_message(chat_id, prefix + summary)
            self.db.execute("UPDATE imports SET delivery_index=1 WHERE update_id=?", (update_id,))
            self.db.commit()
            sent = 1
        for index, (country, path) in enumerate(result.output_files, start=1):
            if sent > index:
                continue
            time.sleep(3.2)
            self.telegram.send_document(chat_id, path, f"{country}.xlsx", f"国家：{country}｜去重结果")
            self.db.execute("UPDATE imports SET delivery_index=? WHERE update_id=?", (index + 1, update_id))
            self.db.commit()

    def _import(self, update_id: int, chat_id: int, user_id: int, data: bytes, filename: str, mode: str) -> None:
        if mode == "base" and not self._is_admin(user_id):
            self.telegram.send_message(chat_id, "只有本群管理员可以导入原始库。")
            return
        result = process_file(
            self.db, data, filename, mode, self.data_dir / "results", chat_id, user_id,
            self._get_column(user_id), update_id=update_id,
        )
        self._send_results(result, chat_id, update_id)
        self._clear_mode(user_id)

    def handle(self, update: dict) -> None:
        message = update.get("message")
        if not message:
            return
        chat = message.get("chat", {})
        sender = message.get("from") or {}
        if chat.get("id") != self.chat_id or chat.get("type") not in ("group", "supergroup"):
            return
        if not sender.get("id") or sender.get("is_bot"):
            return
        user_id = sender["id"]
        text = (message.get("text") or "").strip()
        caption = (message.get("caption") or "").strip()
        command = (caption or text).split(maxsplit=1)[0].split("@", 1)[0].lower() if (caption or text) else ""

        if text and command in ("/start", "/help"):
            self.telegram.send_message(
                self.chat_id,
                "上传原始库：群管理员发送 /base，再上传 .xlsx/.csv/.txt；也可给文件加 /base 说明。\n"
                "新数据去重：直接上传文件，或发送 /numbers 后换行粘贴号码。"
                "也可直接发送带“编号、客户电话号码、客户姓名”等字段的多行资料。"
                "文件内重复号码全部排除，库里已有的号码也排除；结果按国家分成多个 Excel。\n"
                "找不到号码列时，先发送 /column 列名。/countries 看国家分类；/last 重发上次结果。",
            )
            return
        if text and command == "/base":
            if not self._is_admin(user_id):
                self.telegram.send_message(self.chat_id, "只有本群管理员可以导入原始库。")
                return
            self._set_mode(user_id, "base")
            self.telegram.send_message(self.chat_id, "请在 15 分钟内上传原始库文件；你的下一份文件会加入独立号码库。")
            return
        if text and command == "/check":
            self._set_mode(user_id, "check")
            self.telegram.send_message(self.chat_id, "请上传新数据文件，我会自动去重并按国家发回 Excel。")
            return
        if text and command == "/column":
            parts = text.split(maxsplit=1)
            if len(parts) < 2 or not parts[1].strip():
                self.telegram.send_message(self.chat_id, "用法：/column 你的号码列名")
                return
            self._set_column(user_id, parts[1].strip()[:100])
            self.telegram.send_message(self.chat_id, "已记住你的号码列名，请上传文件。")
            return
        if text and command == "/last":
            files = latest_result(self.db, self.chat_id, user_id)
            if not files:
                self.telegram.send_message(self.chat_id, "还没有可以重发的结果文件。")
            for index, (country, path) in enumerate(files, start=1):
                self.telegram.send_document(self.chat_id, path, f"{country}.xlsx", f"重发｜国家：{country}")
                if index < len(files):
                    time.sleep(3.2)
            return
        if text and command == "/countries":
            countries = self.db.execute(
                "SELECT country, COUNT(*) FROM known_numbers GROUP BY country ORDER BY COUNT(*) DESC, country"
            ).fetchall()
            if not countries:
                self.telegram.send_message(self.chat_id, "号码库目前为空。")
            else:
                lines = [f"{country}：{count} 个" for country, count in countries[:80]]
                self.telegram.send_message(self.chat_id, "原始库按国家分类：\n" + "\n".join(lines))
            return
        if text and command == "/count":
            count = self.db.execute("SELECT COUNT(*) FROM known_numbers").fetchone()[0]
            self.telegram.send_message(self.chat_id, f"当前独立号码库：{count} 个号码。")
            return

        if message.get("document"):
            document = message["document"]
            filename = document.get("file_name") or "upload"
            mode = "base" if command == "/base" else self._get_mode(user_id)
            data = self.telegram.download(document["file_id"], document.get("file_size"))
            self._import(update["update_id"], self.chat_id, user_id, data, filename, mode)
            return

        if text and looks_like_record_template(text):
            self._import(
                update["update_id"], self.chat_id, user_id, text.encode(), "records.txt",
                self._get_mode(user_id),
            )
            return

        if text and (command == "/numbers" or (
            "\n" in text and all(normalize_phone(line.strip()) for line in text.splitlines() if line.strip())
        )):
            data_text = text.split("\n", 1)[1] if command == "/numbers" and "\n" in text else text
            if not data_text.strip():
                self.telegram.send_message(self.chat_id, "在 /numbers 后换行，每行放一个号码。")
                return
            self._import(
                update["update_id"], self.chat_id, user_id, data_text.encode(), "numbers.txt",
                self._get_mode(user_id),
            )

    def run(self) -> None:
        while True:
            try:
                payload = {"timeout": 25, "limit": 20, "allowed_updates": ["message"]}
                if self.offset is not None:
                    payload["offset"] = self.offset
                updates = self.telegram.call("getUpdates", payload)
                for update in updates:
                    try:
                        self.handle(update)
                    except ImportErrorForUser as exc:
                        self.telegram.send_message(self.chat_id, str(exc))
                    self._save_offset(update["update_id"] + 1)
            except (TelegramError, urllib.error.URLError) as exc:
                # Never print full exception details: request URLs contain the bot token.
                print(type(exc).__name__ + ": Telegram 暂时不可用，稍后重试。", file=sys.stderr)
                time.sleep(5)


if __name__ == "__main__":
    os.umask(0o077)
    Bot().run()
