#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("export-production-migration-ledger.py")
SPEC = importlib.util.spec_from_file_location("export_production_migration_ledger", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ExportProductionMigrationLedgerTests(unittest.TestCase):
    def setUp(self):
        self.manifest = {
            MODULE.BASELINE_MIGRATION: "a" * 64,
            **{f"migration_{index:02d}": f"{index:064x}" for index in range(1, MODULE.EXPECTED_MIGRATION_COUNT)},
        }
        self.rows = [
            {"name": name, "checksum": checksum, "finished": True, "rolledBack": False}
            for name, checksum in self.manifest.items()
        ]
        self.rows[0]["checksum"] = "f" * 64

    def build(self, rows=None):
        return MODULE.build_ledger(
            self.manifest,
            self.rows if rows is None else rows,
            "DBA-LEDGER-2026-001",
            "DB02-BASELINE-NEWLINE-2026-001",
        )

    def test_exports_exact_actual_checksums_and_one_strict_baseline_exception(self):
        ledger = self.build()
        self.assertEqual(ledger["migrations"][MODULE.BASELINE_MIGRATION], "f" * 64)
        self.assertEqual(ledger["exceptions"], [{
            "migrationName": MODULE.BASELINE_MIGRATION,
            "reason": "trailing-newline-only",
            "evidenceId": "DB02-BASELINE-NEWLINE-2026-001",
        }])

    def test_rejects_missing_extra_duplicate_unfinished_and_rolled_back_rows(self):
        cases = [
            self.rows[:-1],
            [*self.rows, {"name": "unexpected", "checksum": "1" * 64, "finished": True, "rolledBack": False}],
            [*self.rows, dict(self.rows[0])],
            [{**row, "finished": False} if index == 1 else row for index, row in enumerate(self.rows)],
            [{**row, "rolledBack": True} if index == 1 else row for index, row in enumerate(self.rows)],
        ]
        for rows in cases:
            with self.subTest(rows=len(rows)), self.assertRaises(MODULE.ExportError):
                self.build(rows)

    def test_rejects_any_checksum_pattern_other_than_the_one_baseline_difference(self):
        no_difference = [dict(row) for row in self.rows]
        no_difference[0]["checksum"] = self.manifest[MODULE.BASELINE_MIGRATION]
        extra_difference = [dict(row) for row in self.rows]
        extra_difference[1]["checksum"] = "e" * 64
        for rows in (no_difference, extra_difference):
            with self.assertRaisesRegex(MODULE.ExportError, "exactly the approved baseline"):
                self.build(rows)

    def test_rejects_placeholder_or_malformed_approval_identifiers(self):
        for approval, evidence in [
            ("replace-with-ticket", "DB02-BASELINE-NEWLINE-2026-001"),
            ("DBA-LEDGER-2026-001", "bad id with spaces"),
        ]:
            with self.assertRaises(MODULE.ExportError):
                MODULE.build_ledger(self.manifest, self.rows, approval, evidence)

    def test_manifest_parser_requires_the_approved_number_of_unique_byte_checksums(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest_path = Path(directory) / "migration-manifest.sha256"
            manifest_path.write_text(
                "".join(f"{checksum} {name}\n" for name, checksum in self.manifest.items()),
                encoding="utf-8",
            )
            manifest_path.chmod(0o644)
            self.assertEqual(
                MODULE.parse_manifest(manifest_path, owner_uid=os.getuid()),
                self.manifest,
            )
            with manifest_path.open("a", encoding="utf-8") as handle:
                handle.write(f"{'1' * 64} {MODULE.BASELINE_MIGRATION}\n")
            with self.assertRaisesRegex(MODULE.ExportError, "duplicate"):
                MODULE.parse_manifest(manifest_path, owner_uid=os.getuid())

    def test_atomic_write_is_mode_0600_and_failure_leaves_no_temporary_file(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            parent.chmod(0o700)
            target = parent / "ledger.json"
            ledger = self.build()
            MODULE.atomic_write_ledger(target, ledger, owner_uid=os.getuid())
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), ledger)

            target.unlink()
            with mock.patch.object(MODULE.os, "replace", side_effect=OSError("simulated")):
                with self.assertRaisesRegex(MODULE.ExportError, "atomically"):
                    MODULE.atomic_write_ledger(target, ledger, owner_uid=os.getuid())
            self.assertFalse(target.exists())
            self.assertEqual(list(parent.iterdir()), [])

    def test_existing_ledger_requires_explicit_replace_and_must_be_protected(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            parent.chmod(0o700)
            target = parent / "ledger.json"
            target.write_text("old\n", encoding="utf-8")
            target.chmod(0o600)
            with self.assertRaisesRegex(MODULE.ExportError, "already exists"):
                MODULE.atomic_write_ledger(target, self.build(), owner_uid=os.getuid())
            target.chmod(0o644)
            with self.assertRaisesRegex(MODULE.ExportError, "mode 0600"):
                MODULE.atomic_write_ledger(
                    target,
                    self.build(),
                    owner_uid=os.getuid(),
                    replace_existing=True,
                )

    def test_local_query_uses_fixed_socket_database_and_scrubbed_environment(self):
        captured = {}

        def runner(command, **options):
            captured["command"] = command
            captured["options"] = options
            return subprocess.CompletedProcess(command, 0, stdout="[]\n", stderr="")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            psql = root / "psql"
            runuser = root / "runuser"
            socket_directory = root / "postgresql"
            psql.write_text("", encoding="utf-8")
            runuser.write_text("", encoding="utf-8")
            psql.chmod(0o755)
            runuser.chmod(0o755)
            socket_directory.mkdir()
            self.assertEqual(MODULE.query_local_migrations(
                runner,
                psql=psql,
                runuser=runuser,
                socket_directory=socket_directory,
            ), [])
        command = captured["command"]
        self.assertTrue(any(value.endswith("/postgresql") for value in command))
        self.assertIn("data_statistics", command)
        self.assertNotIn("DATABASE_URL", captured["options"]["env"])
        self.assertNotIn("PGPASSWORD", captured["options"]["env"])
        self.assertEqual(captured["options"]["env"], {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"})

    def test_local_query_failure_never_repeats_psql_stderr(self):
        secret_marker = "should-not-be-repeated"

        def runner(command, **_options):
            return subprocess.CompletedProcess(command, 2, stdout="", stderr=secret_marker)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            psql = root / "psql"
            runuser = root / "runuser"
            socket_directory = root / "postgresql"
            psql.write_text("", encoding="utf-8")
            runuser.write_text("", encoding="utf-8")
            psql.chmod(0o755)
            runuser.chmod(0o755)
            socket_directory.mkdir()
            with self.assertRaises(MODULE.ExportError) as failure:
                MODULE.query_local_migrations(
                    runner,
                    psql=psql,
                    runuser=runuser,
                    socket_directory=socket_directory,
                )
        self.assertNotIn(secret_marker, str(failure.exception))

    def test_unapproved_cli_input_is_not_reflected(self):
        secret_marker = "postgresql://user:should-not-be-repeated@example.test/database"
        result = subprocess.run(
            [sys.executable, str(MODULE_PATH), "--database-url", secret_marker],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(secret_marker, result.stdout + result.stderr)
        self.assertIn("invalid arguments", result.stderr)


if __name__ == "__main__":
    unittest.main()
