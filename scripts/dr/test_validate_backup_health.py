#!/usr/bin/env python3

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("validate-backup-health.py")
SPEC = importlib.util.spec_from_file_location("validate_backup_health", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ArchiveOrderingTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 8, 25, 12, 0, 1, tzinfo=timezone.utc)
        epoch = int(self.now.timestamp())
        self.info = [{
            "status": {"code": 0},
            "backup": [{"type": "full", "timestamp": {"stop": epoch - 10}}],
        }]

    def test_failure_later_in_same_second_is_rejected(self):
        archiver = {
            "lastArchivedTime": "2026-08-25T12:00:00.100000+00:00",
            "lastFailedTime": "2026-08-25T12:00:00.900000+00:00",
        }
        with self.assertRaisesRegex(ValueError, "failed after"):
            MODULE.evaluate_health(100, 100, 100, self.info, archiver, self.now)

    def test_success_later_in_same_second_is_accepted(self):
        archiver = {
            "lastArchivedTime": "2026-08-25T12:00:00.900000+00:00",
            "lastFailedTime": "2026-08-25T12:00:00.100000+00:00",
        }
        result = MODULE.evaluate_health(100, 100, 100, self.info, archiver, self.now)
        self.assertEqual(result["event"], "backup-wal-health-ok")


if __name__ == "__main__":
    unittest.main()
