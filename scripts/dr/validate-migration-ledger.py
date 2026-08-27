#!/usr/bin/env python3
"""Compare restored Prisma migrations with repository and production evidence."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path


BASELINE_MIGRATION = "20260818150000_postgres_baseline"
BASELINE_EXCEPTION_REASON = "trailing-newline-only"
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$")


def parse_repo_manifest(path: Path) -> tuple[dict[str, str], bytes]:
    raw_bytes = path.read_bytes()
    result: dict[str, str] = {}
    for line_number, raw in enumerate(raw_bytes.decode("utf-8").splitlines(), 1):
        if not raw:
            continue
        match = re.fullmatch(r"([0-9a-f]{64}) ([A-Za-z0-9_-]{1,200})", raw)
        if not match:
            raise ValueError(f"invalid repository migration manifest line {line_number}")
        checksum, name = match.groups()
        if name in result:
            raise ValueError(f"duplicate repository migration name: {name}")
        result[name] = checksum
    return result, raw_bytes


def parse_production_ledger(path: Path, approval_id: str) -> tuple[dict[str, str], list[dict[str, str]], bytes]:
    raw_bytes = path.read_bytes()
    def no_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate production migration ledger key: {key}")
            result[key] = value
        return result

    ledger = json.loads(raw_bytes, object_pairs_hook=no_duplicate_keys)
    required_keys = {"version", "algorithm", "approvalId", "exceptions", "migrations"}
    if not isinstance(ledger, dict) or set(ledger) != required_keys:
        raise ValueError("production migration ledger has an invalid schema")
    if ledger["version"] != 1 or ledger["algorithm"] != "sha256":
        raise ValueError("production migration ledger version/algorithm is invalid")
    if ledger["approvalId"] != approval_id or not IDENTIFIER.fullmatch(approval_id) or approval_id.startswith("replace-with-"):
        raise ValueError("production migration ledger approval identifier mismatch")
    migrations = ledger["migrations"]
    exceptions = ledger["exceptions"]
    if not isinstance(migrations, dict) or not isinstance(exceptions, list):
        raise ValueError("production migration ledger migrations/exceptions are invalid")
    normalized: dict[str, str] = {}
    for name, checksum in migrations.items():
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", name):
            raise ValueError("production migration ledger contains an invalid name")
        if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise ValueError(f"production migration ledger checksum is invalid: {name}")
        normalized[name] = checksum
    return normalized, exceptions, raw_bytes


def parse_baseline_checksum_approval(
    path: Path,
    ledger_approval_id: str,
) -> tuple[str, str, bytes]:
    raw_bytes = path.read_bytes()

    def no_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate baseline checksum approval key: {key}")
            result[key] = value
        return result

    approval = json.loads(raw_bytes, object_pairs_hook=no_duplicate_keys)
    required_keys = {
        "version",
        "algorithm",
        "migrationName",
        "productionChecksum",
        "evidenceId",
        "ledgerApprovalId",
    }
    if not isinstance(approval, dict) or set(approval) != required_keys:
        raise ValueError("baseline checksum approval has an invalid schema")
    if approval["version"] != 1 or approval["algorithm"] != "sha256":
        raise ValueError("baseline checksum approval version/algorithm is invalid")
    if approval["migrationName"] != BASELINE_MIGRATION:
        raise ValueError("baseline checksum approval migration name is invalid")
    checksum = approval["productionChecksum"]
    evidence_id = approval["evidenceId"]
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise ValueError("approved production baseline checksum is invalid")
    if (not isinstance(evidence_id, str)
            or not IDENTIFIER.fullmatch(evidence_id)
            or evidence_id.startswith("replace-with-")):
        raise ValueError("baseline checksum approval evidence identifier is invalid")
    if approval["ledgerApprovalId"] != ledger_approval_id:
        raise ValueError("baseline checksum approval is not bound to the production ledger approval")
    return checksum, evidence_id, raw_bytes


def validate_migrations(
    validation: dict[str, object],
    repo_manifest_path: Path,
    production_ledger_path: Path,
    expected_count: int,
    expected_latest: str,
    ledger_approval_id: str,
    baseline_checksum_approval_path: Path,
) -> dict[str, object]:
    repository, repo_bytes = parse_repo_manifest(repo_manifest_path)
    ledger, exceptions, ledger_bytes = parse_production_ledger(production_ledger_path, ledger_approval_id)
    approved_baseline_checksum, approved_baseline_evidence_id, baseline_approval_bytes = (
        parse_baseline_checksum_approval(baseline_checksum_approval_path, ledger_approval_id)
    )
    if len(repository) != expected_count or not repository or list(repository)[-1] != expected_latest:
        raise ValueError("repository migration manifest does not match approved release metadata")
    if set(repository) != set(ledger):
        raise ValueError(json.dumps({
            "productionLedgerSetMismatch": True,
            "missingFromLedger": sorted(set(repository) - set(ledger)),
            "unexpectedInLedger": sorted(set(ledger) - set(repository)),
        }, separators=(",", ":")))

    repository_differences = sorted(name for name in repository if repository[name] != ledger[name])
    if repository_differences:
        if repository_differences != [BASELINE_MIGRATION]:
            raise ValueError(f"unapproved repository/production checksum differences: {repository_differences}")
        if len(exceptions) != 1 or not isinstance(exceptions[0], dict) or set(exceptions[0]) != {"migrationName", "reason", "evidenceId"}:
            raise ValueError("baseline checksum difference lacks one strict ledger exception")
        exception = exceptions[0]
        evidence_id = exception.get("evidenceId")
        if (exception.get("migrationName") != BASELINE_MIGRATION
                or exception.get("reason") != BASELINE_EXCEPTION_REASON
                or not isinstance(evidence_id, str)
                or not IDENTIFIER.fullmatch(evidence_id)
                or evidence_id.startswith("replace-with-")
                or evidence_id != approved_baseline_evidence_id
                or ledger[BASELINE_MIGRATION] != approved_baseline_checksum):
            raise ValueError("baseline checksum exception is not the recorded trailing-newline exception")
    elif exceptions:
        raise ValueError("production ledger declares an exception but no checksum differs")

    rows = validation.pop("migrationRows", None)
    if not isinstance(rows, list):
        raise ValueError("database migration rows were not returned")
    actual: dict[str, str] = {}
    invalid_states: list[str] = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("name"), str) or not isinstance(row.get("checksum"), str):
            raise ValueError("database returned an invalid migration row")
        name = row["name"]
        if name in actual:
            raise ValueError(f"duplicate database migration name: {name}")
        actual[name] = row["checksum"].lower()
        if row.get("finished") is not True or row.get("rolledBack") is not False:
            invalid_states.append(name)
    missing = sorted(set(ledger) - set(actual))
    unexpected = sorted(set(actual) - set(ledger))
    checksum_mismatches = sorted(name for name in set(ledger) & set(actual) if ledger[name] != actual[name])
    if missing or unexpected or checksum_mismatches or invalid_states:
        raise ValueError(json.dumps({
            "productionMigrationMismatch": True,
            "missing": missing,
            "unexpected": unexpected,
            "checksumMismatches": checksum_mismatches,
            "invalidStates": sorted(invalid_states),
        }, separators=(",", ":")))

    result = dict(validation)
    result["migrationCheckPassed"] = True
    result["repositoryManifestSha256"] = hashlib.sha256(repo_bytes).hexdigest()
    result["productionLedgerSha256"] = hashlib.sha256(ledger_bytes).hexdigest()
    result["baselineChecksumApprovalSha256"] = hashlib.sha256(baseline_approval_bytes).hexdigest()
    result["baselineChecksumApprovalEvidenceId"] = approved_baseline_evidence_id
    result["productionLedgerApprovalId"] = ledger_approval_id
    result["migrationManifestCount"] = len(repository)
    result["migrationLatestName"] = expected_latest
    result["recordedChecksumExceptions"] = repository_differences
    return result


def main() -> None:
    if len(sys.argv) != 8:
        raise SystemExit("usage: validate-migration-ledger.py VALIDATION_JSON REPO_MANIFEST PRODUCTION_LEDGER EXPECTED_COUNT EXPECTED_LATEST LEDGER_APPROVAL_ID BASELINE_CHECKSUM_APPROVAL")
    try:
        result = validate_migrations(
            json.loads(sys.argv[1]),
            Path(sys.argv[2]),
            Path(sys.argv[3]),
            int(sys.argv[4]),
            sys.argv[5],
            sys.argv[6],
            Path(sys.argv[7]),
        )
    except (OSError, UnicodeError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit(str(error)) from error
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
