#!/usr/bin/env python3

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("validate-migration-ledger.py")
SPEC = importlib.util.spec_from_file_location("validate_migration_ledger", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class MigrationLedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.repo = root / "repo.sha256"
        self.ledger = root / "ledger.json"
        self.baseline_approval = root / "baseline-approval.json"
        self.baseline = MODULE.BASELINE_MIGRATION
        self.latest = "20260826200000_add_group_auto_leave_and_deposit_method"
        self.repo_checksums = {self.baseline: "a" * 64, self.latest: "b" * 64}
        self.ledger_checksums = {self.baseline: "c" * 64, self.latest: "b" * 64}
        self.repo.write_text("".join(f"{value} {name}\n" for name, value in self.repo_checksums.items()), encoding="utf-8")
        self.write_ledger(self.ledger_checksums)
        self.write_baseline_approval(self.ledger_checksums[self.baseline])

    def write_baseline_approval(self, checksum, evidence_id="DB02-BASELINE-NEWLINE-2026-001"):
        value = {
            "version": 1,
            "algorithm": "sha256",
            "migrationName": self.baseline,
            "productionChecksum": checksum,
            "evidenceId": evidence_id,
            "ledgerApprovalId": "DBA-CHANGE-2026-001",
        }
        self.baseline_approval.write_text(json.dumps(value), encoding="utf-8")

    def write_ledger(self, migrations, exceptions=None):
        value = {
            "version": 1,
            "algorithm": "sha256",
            "approvalId": "DBA-CHANGE-2026-001",
            "exceptions": exceptions if exceptions is not None else [{
                "migrationName": self.baseline,
                "reason": MODULE.BASELINE_EXCEPTION_REASON,
                "evidenceId": "DB02-BASELINE-NEWLINE-2026-001",
            }],
            "migrations": migrations,
        }
        self.ledger.write_text(json.dumps(value), encoding="utf-8")

    def validation(self):
        return {
            "migrationRows": [
                {"name": name, "checksum": checksum, "finished": True, "rolledBack": False}
                for name, checksum in self.ledger_checksums.items()
            ],
        }

    def check(self, validation=None):
        return MODULE.validate_migrations(
            validation or self.validation(), self.repo, self.ledger, 2, self.latest,
            "DBA-CHANGE-2026-001", self.baseline_approval,
        )

    def test_recorded_baseline_newline_exception_is_accepted(self):
        result = self.check()
        self.assertEqual(result["recordedChecksumExceptions"], [self.baseline])
        self.assertEqual(result["productionLedgerApprovalId"], "DBA-CHANGE-2026-001")
        self.assertEqual(result["baselineChecksumApprovalEvidenceId"], "DB02-BASELINE-NEWLINE-2026-001")

    def test_arbitrary_baseline_checksum_cannot_use_the_newline_exception(self):
        changed = dict(self.ledger_checksums)
        changed[self.baseline] = "e" * 64
        self.ledger_checksums = changed
        self.write_ledger(changed)
        with self.assertRaisesRegex(ValueError, "not the recorded trailing-newline"):
            self.check()

    def test_baseline_exception_must_match_the_separate_approval_evidence(self):
        self.write_baseline_approval(self.ledger_checksums[self.baseline], "OTHER-APPROVAL-2026-001")
        with self.assertRaisesRegex(ValueError, "not the recorded trailing-newline"):
            self.check()

    def test_production_ledger_approval_mismatch_is_rejected(self):
        value = json.loads(self.ledger.read_text(encoding="utf-8"))
        value["approvalId"] = "DBA-CHANGE-2026-OTHER"
        self.ledger.write_text(json.dumps(value), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "approval identifier mismatch"):
            self.check()

    def test_duplicate_production_ledger_key_is_rejected(self):
        raw = self.ledger.read_text(encoding="utf-8")
        self.ledger.write_text(raw.replace(
            '"version": 1,',
            '"version": 1, "version": 1,',
            1,
        ), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "duplicate production migration ledger key"):
            self.check()

    def test_missing_database_migration_is_rejected(self):
        value = self.validation()
        value["migrationRows"].pop()
        with self.assertRaisesRegex(ValueError, '"missing"'):
            self.check(value)

    def test_unexpected_database_migration_is_rejected(self):
        value = self.validation()
        value["migrationRows"].append({"name": "unexpected", "checksum": "d" * 64, "finished": True, "rolledBack": False})
        with self.assertRaisesRegex(ValueError, '"unexpected"'):
            self.check(value)

    def test_database_checksum_mismatch_is_rejected(self):
        value = self.validation()
        value["migrationRows"][0]["checksum"] = "e" * 64
        with self.assertRaisesRegex(ValueError, '"checksumMismatches"'):
            self.check(value)

    def test_rolled_back_database_migration_is_rejected(self):
        value = self.validation()
        value["migrationRows"][0]["rolledBack"] = True
        with self.assertRaisesRegex(ValueError, '"invalidStates"'):
            self.check(value)

    def test_unfinished_database_migration_is_rejected(self):
        value = self.validation()
        value["migrationRows"][0]["finished"] = False
        with self.assertRaisesRegex(ValueError, '"invalidStates"'):
            self.check(value)

    def test_unknown_repository_ledger_difference_is_rejected(self):
        changed = dict(self.ledger_checksums)
        changed[self.latest] = "f" * 64
        self.write_ledger(changed)
        with self.assertRaisesRegex(ValueError, "unapproved repository/production"):
            self.check()

    def test_baseline_exception_with_unknown_reason_is_rejected(self):
        self.write_ledger(self.ledger_checksums, [{
            "migrationName": self.baseline,
            "reason": "semantic-change",
            "evidenceId": "DB02-BASELINE-NEWLINE-2026-001",
        }])
        with self.assertRaisesRegex(ValueError, "not the recorded trailing-newline"):
            self.check()

    def test_exception_is_rejected_when_checksums_match(self):
        self.ledger_checksums = dict(self.repo_checksums)
        self.write_ledger(self.ledger_checksums)
        with self.assertRaisesRegex(ValueError, "declares an exception"):
            self.check()


if __name__ == "__main__":
    unittest.main()
