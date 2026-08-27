#!/usr/bin/env python3
"""Export a validated production Prisma migration ledger without DB secrets."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Callable


DATABASE_NAME = "data_statistics"
EXPECTED_MIGRATION_COUNT = 24
BASELINE_MIGRATION = "20260818150000_postgres_baseline"
BASELINE_EXCEPTION_REASON = "trailing-newline-only"
PSQL = Path("/usr/bin/psql")
RUNUSER = Path("/usr/sbin/runuser")
POSTGRES_SOCKET = Path("/var/run/postgresql")
MANIFEST = Path("/usr/local/share/data-statistics-dr/migration-manifest.sha256")
OUTPUT = Path("/etc/data-statistics/dr-production-migration-ledger.json")
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$")
CHECKSUM = re.compile(r"^[0-9a-f]{64}$")

QUERY = r"""
SELECT COALESCE(
  json_agg(
    json_build_object(
      'name', migration_name,
      'checksum', lower(checksum),
      'finished', finished_at IS NOT NULL,
      'rolledBack', rolled_back_at IS NOT NULL
    ) ORDER BY migration_name
  ),
  '[]'::json
)::text
FROM public._prisma_migrations;
"""


class ExportError(ValueError):
    """A safe, non-secret-bearing export failure."""


class SafeArgumentParser(argparse.ArgumentParser):
    """Reject unexpected CLI input without reflecting a possible secret."""

    def error(self, _message: str) -> None:
        self.exit(2, "ERROR: invalid arguments; use --help for the approved non-secret options\n")


def require_identifier(value: str, label: str) -> None:
    if not IDENTIFIER.fullmatch(value) or value.startswith("replace-with-"):
        raise ExportError(f"{label} must be a non-placeholder approval identifier")


def require_protected_file(path: Path, owner_uid: int, required_mode: int | None = None) -> None:
    try:
        details = path.lstat()
    except OSError as error:
        raise ExportError(f"required protected file is unavailable: {path}") from error
    if path.is_symlink() or not path.is_file() or details.st_uid != owner_uid:
        raise ExportError(f"protected file has an unsafe owner or type: {path}")
    mode = details.st_mode & 0o777
    if required_mode is not None and mode != required_mode:
        raise ExportError(f"protected file must have mode {required_mode:04o}: {path}")
    if mode & 0o022:
        raise ExportError(f"protected file must not be group/world writable: {path}")


def require_protected_directory(path: Path, owner_uid: int) -> None:
    try:
        details = path.lstat()
    except OSError as error:
        raise ExportError(f"required protected directory is unavailable: {path}") from error
    if path.is_symlink() or not path.is_dir() or details.st_uid != owner_uid or details.st_mode & 0o022:
        raise ExportError(f"protected directory has an unsafe owner, mode, or type: {path}")


def parse_manifest(path: Path, owner_uid: int = 0) -> dict[str, str]:
    require_protected_file(path, owner_uid)
    migrations: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise ExportError("repository migration manifest could not be read") from error
    for line_number, line in enumerate(lines, 1):
        match = re.fullmatch(r"([0-9a-f]{64}) ([A-Za-z0-9_-]{1,200})", line)
        if not match:
            raise ExportError(f"repository migration manifest line {line_number} is invalid")
        checksum, name = match.groups()
        if name in migrations:
            raise ExportError("repository migration manifest contains a duplicate name")
        migrations[name] = checksum
    if len(migrations) != EXPECTED_MIGRATION_COUNT or BASELINE_MIGRATION not in migrations:
        raise ExportError("repository migration manifest is not the approved 24-migration release")
    return migrations


def query_local_migrations(
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    *,
    psql: Path = PSQL,
    runuser: Path = RUNUSER,
    socket_directory: Path = POSTGRES_SOCKET,
) -> list[object]:
    for executable in (psql, runuser):
        if not executable.is_file() or not os.access(executable, os.X_OK):
            raise ExportError(f"required local executable is unavailable: {executable}")
    if not socket_directory.is_dir() or socket_directory.is_symlink():
        raise ExportError("the fixed local PostgreSQL socket directory is unavailable")

    command = [
        str(runuser),
        "--user",
        "postgres",
        "--",
        str(psql),
        "--no-psqlrc",
        "--no-password",
        "--tuples-only",
        "--no-align",
        "--set",
        "ON_ERROR_STOP=1",
        "--host",
        str(socket_directory),
        "--dbname",
        DATABASE_NAME,
        "--command",
        QUERY,
    ]
    try:
        result = runner(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ExportError("local PostgreSQL migration query could not be executed") from error
    if result.returncode != 0:
        # Do not echo psql stderr: operational configuration or unexpected input
        # must never be copied into an audit report by this exporter.
        raise ExportError("local PostgreSQL migration query failed")
    try:
        parsed = json.loads(result.stdout.strip())
    except (json.JSONDecodeError, UnicodeError) as error:
        raise ExportError("local PostgreSQL returned an invalid migration ledger") from error
    if not isinstance(parsed, list):
        raise ExportError("local PostgreSQL returned an invalid migration ledger")
    return parsed


def build_ledger(
    manifest: dict[str, str],
    rows: list[object],
    approval_id: str,
    baseline_evidence_id: str,
) -> dict[str, object]:
    require_identifier(approval_id, "approvalId")
    require_identifier(baseline_evidence_id, "baseline evidenceId")
    if len(manifest) != EXPECTED_MIGRATION_COUNT or BASELINE_MIGRATION not in manifest:
        raise ExportError("repository migration manifest is not the approved 24-migration release")

    actual: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"name", "checksum", "finished", "rolledBack"}:
            raise ExportError("database migration ledger contains an invalid row")
        name = row["name"]
        checksum = row["checksum"]
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", name):
            raise ExportError("database migration ledger contains an invalid name")
        if name in actual:
            raise ExportError("database migration ledger contains a duplicate name")
        if not isinstance(checksum, str) or not CHECKSUM.fullmatch(checksum):
            raise ExportError("database migration ledger contains an invalid checksum")
        if row["finished"] is not True or row["rolledBack"] is not False:
            raise ExportError("database migration ledger contains an unfinished or rolled-back migration")
        actual[name] = checksum

    if set(actual) != set(manifest) or len(actual) != EXPECTED_MIGRATION_COUNT:
        raise ExportError("database migration names do not exactly match the approved 24-migration manifest")
    mismatches = [name for name in manifest if manifest[name] != actual[name]]
    if mismatches != [BASELINE_MIGRATION]:
        raise ExportError("database checksums do not contain exactly the approved baseline newline exception")

    return {
        "version": 1,
        "algorithm": "sha256",
        "approvalId": approval_id,
        "exceptions": [{
            "migrationName": BASELINE_MIGRATION,
            "reason": BASELINE_EXCEPTION_REASON,
            "evidenceId": baseline_evidence_id,
        }],
        "migrations": {name: actual[name] for name in manifest},
    }


def atomic_write_ledger(
    path: Path,
    ledger: dict[str, object],
    *,
    owner_uid: int = 0,
    replace_existing: bool = False,
) -> None:
    require_protected_directory(path.parent, owner_uid)
    if path.exists() or path.is_symlink():
        if not replace_existing:
            raise ExportError("production ledger already exists; preserve it or pass --replace-existing after approval")
        require_protected_file(path, owner_uid, 0o600)

    content = (json.dumps(ledger, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")
    descriptor = -1
    temporary: Path | None = None
    try:
        descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        temporary = Path(temporary_name)
        os.fchmod(descriptor, 0o600)
        os.fchown(descriptor, owner_uid, path.parent.stat().st_gid)
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = -1
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError as error:
        raise ExportError("production ledger could not be written atomically") from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main() -> None:
    parser = SafeArgumentParser(
        description="Export the validated local production migration ledger without connection credentials.",
    )
    parser.add_argument("--approval-id", required=True)
    parser.add_argument("--baseline-evidence-id", required=True)
    parser.add_argument(
        "--replace-existing",
        action="store_true",
        help="atomically replace an existing root-owned mode-0600 ledger after preserving prior evidence",
    )
    args = parser.parse_args()

    if os.geteuid() != 0:
        raise SystemExit("ERROR: run locally as root; the exporter uses peer-authenticated local psql as postgres")
    require_protected_file(Path(__file__), 0)
    manifest = parse_manifest(MANIFEST)
    rows = query_local_migrations()
    ledger = build_ledger(manifest, rows, args.approval_id, args.baseline_evidence_id)
    atomic_write_ledger(OUTPUT, ledger, replace_existing=args.replace_existing)
    print(f"PASS: wrote validated {EXPECTED_MIGRATION_COUNT}-migration production ledger to {OUTPUT}")
    print("The independent baseline checksum approval was not created or modified.")


if __name__ == "__main__":
    try:
        main()
    except ExportError as error:
        raise SystemExit(f"ERROR: {error}") from error
