#!/usr/bin/env python3
"""Atomically archive passed restore evidence outside rotating rehearsal runs."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path


REHEARSAL_ROOT = Path("/var/lib/postgresql/dr-rehearsal")
EVIDENCE_ROOT = Path("/var/lib/data-statistics/dr-evidence")
RUN_ID = re.compile(r"^20[0-9]{6}T[0-9]{6}Z-[0-9]+$")


def require_regular(path: Path, uid: int, mode: int) -> None:
    stat_result = path.lstat()
    if not path.is_file() or path.is_symlink() or stat_result.st_uid != uid or stat_result.st_mode & 0o777 != mode:
        raise ValueError(f"unsafe evidence input: {path}")


def atomic_evidence_file(path: Path, content: bytes, owner_uid: int) -> None:
    if path.exists():
        require_regular(path, owner_uid, 0o600)
        if path.read_bytes() != content:
            raise ValueError(f"immutable evidence already differs: {path.name}")
        return
    descriptor, temporary_name = tempfile.mkstemp(prefix=".dr-evidence.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chown(temporary, owner_uid, os.stat(path.parent).st_gid)
        os.chmod(temporary, 0o600)
        os.link(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        temporary.unlink(missing_ok=True)


def archive(
    rehearsal_root: Path = REHEARSAL_ROOT,
    evidence_root: Path = EVIDENCE_ROOT,
    evidence_owner_uid: int = 0,
) -> tuple[Path, Path]:
    root_stat = rehearsal_root.lstat()
    evidence_stat = evidence_root.lstat()
    if rehearsal_root.is_symlink() or not rehearsal_root.is_dir():
        raise ValueError("unsafe rehearsal root")
    if evidence_root.is_symlink() or not evidence_root.is_dir() or evidence_stat.st_uid != evidence_owner_uid or evidence_stat.st_mode & 0o777 != 0o700:
        raise ValueError("evidence root must be root-owned mode 0700")
    pointer = rehearsal_root / "last-passed-result-path"
    require_regular(pointer, root_stat.st_uid, 0o600)
    result_path = Path(pointer.read_text(encoding="utf-8").strip())
    if not result_path.is_absolute() or result_path.name != "result.json":
        raise ValueError("invalid restore evidence pointer")
    run_dir = result_path.parent
    if (run_dir.parent != rehearsal_root or not RUN_ID.fullmatch(run_dir.name)
            or run_dir.is_symlink() or not run_dir.is_dir()):
        raise ValueError("restore evidence is outside the fixed rehearsal root")
    require_regular(result_path, root_stat.st_uid, 0o600)
    raw = result_path.read_bytes()
    result = json.loads(raw)
    if not isinstance(result, dict) or result.get("status") != "passed" or result.get("runId") != run_dir.name:
        raise ValueError("restore evidence is not a matching passed result")
    digest = hashlib.sha256(raw).hexdigest()
    archived = evidence_root / f"{run_dir.name}-result.json"
    checksum = evidence_root / f"{run_dir.name}-result.json.sha256"
    atomic_evidence_file(archived, raw, evidence_owner_uid)
    atomic_evidence_file(checksum, f"{digest}  {archived.name}\n".encode(), evidence_owner_uid)
    return archived, checksum


if __name__ == "__main__":
    archive()
