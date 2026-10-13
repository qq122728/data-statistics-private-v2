"""Deliver each group's report first, then its country analysis. Silent Hermes job."""
import fcntl
import json
import os
import pathlib
import tempfile
import urllib.request


def save_state(path, state):
    fd, temp = tempfile.mkstemp(prefix="group-daily-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
        parent = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def deliver_ready(payload, state, persist, send):
    sent = state.setdefault("sent", {})
    ready = sorted((r for r in payload.get("results", []) + payload.get("analyses", []) if r.get("ready") and r.get("text")), key=lambda r: r["groupId"].startswith("country:"))
    for row in ready:
        key = row["groupId"] + ":" + row["date"]
        if key in sent:
            continue
        if any(sent.get(k, {}).get("status") != "sent" for k in row.get("dependencies", [])):
            continue
        sent[key] = {"status": "sending", "at": payload.get("generatedAt")}
        persist(state)
        try:
            result = send({"groupId": row["groupId"], "date": row["date"]})
            if not result.get("delivered"):
                raise RuntimeError("delivery not confirmed")
        except Exception:
            sent[key]["status"] = "uncertain"
            persist(state)
            raise
        sent[key] = {"status": "sent", "at": payload.get("generatedAt"), "format": result.get("format")}
        persist(state)


def main():
    home = pathlib.Path(os.environ.get("HERMES_HOME", pathlib.Path.home() / ".hermes"))
    token = os.environ.get("BOSS_QUERY_TOKEN", "")
    if not token:
        for line in (home / "boss-query.env").read_text().splitlines():
            if line.startswith("BOSS_QUERY_TOKEN="):
                token = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
    if not token:
        raise RuntimeError("BOSS_QUERY_TOKEN is not configured")

    def request(route, body):
        req = urllib.request.Request("http://127.0.0.1:4179/" + route,
            data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=180) as response:
            return json.load(response)

    directory = home / "state"
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "group-daily-reports.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        path = directory / "group-daily-reports.json"
        # Corrupt state must stop delivery, never erase deduplication history.
        state = json.loads(path.read_text()) if path.exists() else {"sent": {}}
        payload = request("daily-report-ready", {})
        deliver_ready(payload, state, lambda value: save_state(path, value), lambda body: request("daily-report-deliver", body))


if __name__ == "__main__":
    main()
