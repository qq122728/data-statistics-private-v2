#!/usr/bin/env python3
"""Validate pgBackRest backup age and PostgreSQL WAL archiver ordering."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone


def parse_timestamp(value: object, field: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{field} is missing")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def evaluate_health(
    max_any: int,
    max_full: int,
    max_archive: int,
    data: list[dict[str, object]],
    archiver: dict[str, object],
    now: datetime | None = None,
) -> dict[str, object]:
    if len(data) != 1 or data[0].get("status", {}).get("code") != 0:  # type: ignore[union-attr]
        raise ValueError("pgBackRest repository status is not ok")
    backups = [item for item in data[0].get("backup", []) if not item.get("error")]  # type: ignore[union-attr]
    if not backups:
        raise ValueError("no valid pgBackRest backup found")
    full = [item for item in backups if item.get("type") == "full"]
    if not full:
        raise ValueError("no valid full backup found")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    newest = max(int(item["timestamp"]["stop"]) for item in backups)
    newest_full = max(int(item["timestamp"]["stop"]) for item in full)
    newest_age = int(current.timestamp()) - newest
    newest_full_age = int(current.timestamp()) - newest_full
    if newest_age < 0 or newest_full_age < 0:
        raise ValueError("backup timestamp is in the future; check clock synchronization")
    if newest_age > max_any:
        raise ValueError("newest backup exceeds age threshold")
    if newest_full_age > max_full:
        raise ValueError("newest full backup exceeds age threshold")

    last_archived = parse_timestamp(archiver.get("lastArchivedTime"), "lastArchivedTime")
    seconds_since_archive = (current - last_archived).total_seconds()
    if seconds_since_archive < 0:
        raise ValueError("WAL archive timestamp is in the future; check clock synchronization")
    if seconds_since_archive > max_archive:
        raise ValueError("WAL archive success is missing or stale after pgBackRest check")
    if archiver.get("lastFailedTime") is not None:
        last_failed = parse_timestamp(archiver.get("lastFailedTime"), "lastFailedTime")
        if last_failed > last_archived:
            raise ValueError("latest WAL archive attempt failed after the latest success")

    return {
        "service": "data-statistics-dr",
        "event": "backup-wal-health-ok",
        "newestBackupAgeSeconds": newest_age,
        "newestFullAgeSeconds": newest_full_age,
        "secondsSinceLastArchive": int(seconds_since_archive),
    }


def main() -> None:
    if len(sys.argv) != 6:
        raise SystemExit("usage: validate-backup-health.py MAX_ANY MAX_FULL MAX_ARCHIVE INFO_JSON ARCHIVER_JSON")
    try:
        result = evaluate_health(
            int(sys.argv[1]),
            int(sys.argv[2]),
            int(sys.argv[3]),
            json.loads(sys.argv[4]),
            json.loads(sys.argv[5]),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
