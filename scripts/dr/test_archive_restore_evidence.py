#!/usr/bin/env python3

import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("archive-restore-evidence.py")
SPEC = importlib.util.spec_from_file_location("archive_restore_evidence", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class RestoreEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.rehearsal = root / "rehearsal"
        self.evidence = root / "evidence"
        self.rehearsal.mkdir(mode=0o700)
        self.evidence.mkdir(mode=0o700)
        self.run_id = "20260825T120000Z-123"
        self.run = self.rehearsal / self.run_id
        self.run.mkdir(mode=0o700)
        self.result = self.run / "result.json"
        self.raw = (json.dumps({"runId": self.run_id, "status": "passed"}, separators=(",", ":")) + "\n").encode()
        self.result.write_bytes(self.raw)
        self.result.chmod(0o600)
        pointer = self.rehearsal / "last-passed-result-path"
        pointer.write_text(str(self.result) + "\n", encoding="utf-8")
        pointer.chmod(0o600)

    def test_archives_immutable_root_style_result_and_checksum(self):
        archived, checksum = MODULE.archive(self.rehearsal, self.evidence, os.getuid())
        self.assertEqual(archived.read_bytes(), self.raw)
        self.assertEqual(archived.stat().st_mode & 0o777, 0o600)
        self.assertEqual(checksum.stat().st_mode & 0o777, 0o600)
        self.assertEqual(checksum.read_text(), f"{hashlib.sha256(self.raw).hexdigest()}  {archived.name}\n")
        self.run.rename(self.rehearsal / "rotated-away")
        self.assertEqual(archived.read_bytes(), self.raw)

    def test_refuses_to_overwrite_different_immutable_evidence(self):
        archived, _ = MODULE.archive(self.rehearsal, self.evidence, os.getuid())
        archived.write_text("different\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "immutable evidence already differs"):
            MODULE.archive(self.rehearsal, self.evidence, os.getuid())


if __name__ == "__main__":
    unittest.main()
