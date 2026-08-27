#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("security-production-preflight.py")
SPEC = importlib.util.spec_from_file_location("security_production_preflight", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def database_payload(**overrides):
    value = {
        "migrationCount": MODULE.EXPECTED_MIGRATION_COUNT,
        "migrationTotalCount": MODULE.EXPECTED_MIGRATION_COUNT,
        "latestMigration": MODULE.EXPECTED_LATEST_MIGRATION,
        "archiveMode": "on",
        "rolesReady": True,
        "membershipViolations": 0,
        "databaseAclReady": True,
        "schemaAclReady": True,
        "ownerViolations": 0,
        "runtimeObjectOwnerViolations": 0,
        "tableAclViolations": 0,
        "sequenceAclViolations": 0,
        "functionAclViolations": 0,
        "defaultAclReady": True,
        "legacyAclViolations": 0,
    }
    value.update(overrides)
    return value


class SecurityProductionPreflightTests(unittest.TestCase):
    def test_command_scrubs_environment_and_never_repeats_stderr(self):
        captured = {}

        def runner(arguments, **options):
            captured.update(options)
            return subprocess.CompletedProcess(arguments, 1, stdout="", stderr="secret-marker")

        with self.assertRaises(MODULE.PreflightError) as failure:
            MODULE.command(["/bin/false"], runner=runner)
        self.assertNotIn("secret-marker", str(failure.exception))
        self.assertEqual(captured["env"], {
            "PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"
        })

    def test_release_evidence_requires_exact_sha_version_and_protected_files(self):
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory)
            package = release / "node_modules" / "next" / "package.json"
            package.parent.mkdir(parents=True)
            package.write_text(json.dumps({"version": MODULE.EXPECTED_NEXT_VERSION}), encoding="utf-8")
            sha = release / MODULE.RELEASE_SHA_FILE
            expected = "a" * 40
            sha.write_text(expected + "\n", encoding="ascii")
            package.chmod(0o644)
            sha.chmod(0o644)
            self.assertEqual(MODULE.read_release_evidence(release, expected), {
                "nextVersion": MODULE.EXPECTED_NEXT_VERSION,
                "nextVersionMatches": True,
                "releaseShaMatches": True,
            })
            sha.chmod(0o666)
            with self.assertRaises(MODULE.PreflightError):
                MODULE.read_release_evidence(release, expected)

    def test_database_query_uses_fixed_local_socket_without_credentials(self):
        captured = {}
        payload = database_payload()

        def runner(arguments, **options):
            captured["arguments"] = arguments
            captured["options"] = options
            return subprocess.CompletedProcess(arguments, 0, stdout=json.dumps(payload), stderr="")

        self.assertTrue(all(MODULE.database_evidence(runner=runner).values()))
        joined = " ".join(captured["arguments"])
        self.assertIn("/var/run/postgresql", joined)
        self.assertIn("data_statistics", joined)
        self.assertNotIn("postgresql://", joined)
        self.assertNotIn("PGPASSWORD", captured["options"]["env"])
        self.assertIn("BEGIN READ ONLY", MODULE.DB_QUERY)
        self.assertIn("rolbypassrls", MODULE.DB_QUERY)
        self.assertIn("defaultAclReady", MODULE.DB_QUERY)

    def test_database_mismatch_is_reported_only_as_booleans(self):
        payload = database_payload(
            migrationCount=16, migrationTotalCount=20, latestMigration="old", archiveMode="off", rolesReady=False,
            membershipViolations=1, databaseAclReady=False, schemaAclReady=False, ownerViolations=25,
            runtimeObjectOwnerViolations=1, tableAclViolations=1, sequenceAclViolations=1,
            functionAclViolations=1, defaultAclReady=False, legacyAclViolations=1,
        )

        def runner(arguments, **_options):
            return subprocess.CompletedProcess(arguments, 0, stdout=json.dumps(payload), stderr="")

        self.assertFalse(any(MODULE.database_evidence(runner=runner).values()))

    def test_firewall_parser_exposes_only_gate_results(self):
        with tempfile.TemporaryDirectory() as directory:
            defaults = Path(directory) / "ufw"
            defaults.write_text("IPV6=yes\n", encoding="utf-8")

            def runner(arguments, **_options):
                return subprocess.CompletedProcess(
                    arguments, 0,
                    stdout="Status: active\nDefault: deny (incoming), allow (outgoing), disabled (routed)\n22/tcp ALLOW IN 192.0.2.1\n",
                    stderr="",
                )

            self.assertEqual(MODULE.firewall_evidence(runner=runner, ufw_defaults=defaults), {
                "active": True, "defaultDenyIncoming": True, "ipv6Enabled": True,
                "webAllowsRestrictedToApprovedSources": True,
            })

    def test_service_rejects_rogue_3000_listener_outside_systemd_cgroup(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / "release"
            release.mkdir()
            for pid, group in (("100", "/system.slice/data-statistics.service"), ("200", "/user.slice/rogue.service")):
                process = root / pid
                process.mkdir()
                (process / "cgroup").write_text(f"0::{group}\n", encoding="ascii")
            os.symlink(release, root / "100" / "cwd")
            properties = {
                "User": MODULE.EXPECTED_RUNTIME_USER, "Group": MODULE.EXPECTED_RUNTIME_USER,
                "NoNewPrivileges": "yes", "PrivateTmp": "yes", "ProtectSystem": "strict",
                "ProtectHome": "yes", "ReadWritePaths": "/var/lib/data-statistics-runtime /var/cache/data-statistics-runtime",
                "InaccessiblePaths": "/opt/data-statistics/.ssh /opt/data-statistics/repository /opt/data-statistics/backups /opt/data-statistics/deploy-backups",
                "ExecStart": "/usr/local/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000",
                "ControlGroup": "/system.slice/data-statistics.service", "MainPID": "100",
            }

            def runner(arguments, **_options):
                if "is-active" in arguments:
                    output = "active"
                elif "show" in arguments:
                    output = properties[arguments[arguments.index("--property") + 1]]
                elif "sport = :3000" in arguments:
                    output = 'LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=200,fd=1))'
                else:
                    output = ""
                return subprocess.CompletedProcess(arguments, 0, stdout=output + "\n", stderr="")

            with mock.patch.object(MODULE, "runtime_account_evidence", return_value={"account": True}):
                evidence = MODULE.service_evidence(release, runner=runner, proc_root=root)
            self.assertFalse(evidence["port3000OwnedByServiceOnLoopback"])
            self.assertTrue(evidence["port3001Closed"])

    def test_runtime_account_rejects_a_writable_nested_release_file(self):
        with tempfile.TemporaryDirectory() as directory:
            deploy_root = Path(directory)
            release = deploy_root / "releases" / "current"
            for path in (deploy_root / ".ssh", deploy_root / "backups", deploy_root / "repository", release):
                path.mkdir(parents=True, exist_ok=True)
            (deploy_root / ".ssh" / "data_statistics_deploy_ed25519").write_text("test-only", encoding="ascii")
            writable = release / "writable.js"
            writable.write_text("test-only", encoding="ascii")
            writable.chmod(0o666)

            def runner(arguments, **_options):
                return subprocess.CompletedProcess(arguments, 1, stdout="", stderr="")

            account = mock.Mock(pw_uid=4242, pw_gid=42, pw_shell="/usr/sbin/nologin")
            group = mock.Mock(gr_name=MODULE.EXPECTED_RUNTIME_USER)
            with mock.patch.object(MODULE, "DEPLOY_ROOT", deploy_root), \
                 mock.patch.object(MODULE.pwd, "getpwnam", return_value=account), \
                 mock.patch.object(MODULE.grp, "getgrgid", return_value=group), \
                 mock.patch.object(MODULE.os, "getgrouplist", return_value=[42]):
                evidence = MODULE.runtime_account_evidence(release, runner=runner)
            self.assertTrue(evidence["runtimeCannotReadProtectedData"])
            self.assertFalse(evidence["runtimeCannotModifyDeployments"])

    def test_firewall_fails_closed_when_exact_lockdown_audit_rejects_broad_allow(self):
        with tempfile.TemporaryDirectory() as directory:
            defaults = Path(directory) / "ufw"
            defaults.write_text("IPV6=yes\n", encoding="utf-8")

            def runner(arguments, **_options):
                if arguments[0] == str(MODULE.CLOUDFLARE_AUDIT):
                    return subprocess.CompletedProcess(arguments, 1, stdout="", stderr="80 ALLOW IN Anywhere")
                return subprocess.CompletedProcess(arguments, 0, stdout="Status: active\nDefault: deny (incoming)\n", stderr="")

            with self.assertRaises(MODULE.PreflightError):
                MODULE.firewall_evidence(runner=runner, ufw_defaults=defaults)

    def test_timer_evidence_requires_enabled_and_active(self):
        def runner(arguments, **_options):
            if "show" in arguments:
                property_name = arguments[arguments.index("--property") + 1]
                values = {"Result": "success", "ExecMainStatus": "0", "LastTriggerUSec": "Tue 2026-08-25"}
                return subprocess.CompletedProcess(arguments, 0, stdout=values[property_name] + "\n", stderr="")
            state = "disabled" if arguments[-1] == MODULE.TIMERS[-1] and "is-enabled" in arguments else "active"
            if "is-enabled" in arguments and state != "disabled":
                state = "enabled"
            return subprocess.CompletedProcess(arguments, 1 if state == "disabled" else 0, stdout=state + "\n", stderr="")

        evidence = MODULE.timer_evidence(runner=runner)
        self.assertFalse(evidence[MODULE.TIMERS[-1]])
        self.assertTrue(all(value for key, value in evidence.items() if key != MODULE.TIMERS[-1]))

    def test_collect_never_claims_external_or_business_acceptance(self):
        release = Path("/opt/data-statistics/releases/release")
        with mock.patch.object(MODULE, "current_release", return_value=release), \
             mock.patch.object(MODULE, "read_release_evidence", return_value={"release": True}), \
             mock.patch.object(MODULE, "service_evidence", return_value={"service": True}), \
             mock.patch.object(MODULE, "database_evidence", return_value={"database": True}), \
             mock.patch.object(MODULE, "firewall_evidence", return_value={"firewall": True}), \
             mock.patch.object(MODULE, "timer_evidence", return_value={"timer": True}):
            report = MODULE.collect("a" * 40)
        self.assertTrue(report["allPreflightGatesPassed"])
        self.assertIn("does not prove business authorization behavior", report["limitations"][0])
        rendered = json.dumps(report)
        for forbidden in ("DATABASE_URL", "password", "customer", "phone", "token"):
            self.assertNotIn(forbidden.lower(), rendered.lower())

    def test_collect_fails_closed_when_a_section_cannot_be_collected(self):
        with mock.patch.object(MODULE, "current_release", return_value=Path("/tmp/release")), \
             mock.patch.object(MODULE, "read_release_evidence", side_effect=ValueError("sensitive local detail")), \
             mock.patch.object(MODULE, "service_evidence", return_value={"service": True}), \
             mock.patch.object(MODULE, "database_evidence", return_value={"database": True}), \
             mock.patch.object(MODULE, "firewall_evidence", return_value={"firewall": True}), \
             mock.patch.object(MODULE, "timer_evidence", return_value={"timer": True}):
            report = MODULE.collect("a" * 40)
        self.assertFalse(report["allPreflightGatesPassed"])
        self.assertEqual(report["collectionErrors"], ["release"])

    def test_cli_rejects_unapproved_input_without_reflecting_it(self):
        marker = "postgresql://user:secret@example.invalid/database"
        result = subprocess.run(
            ["python3", str(MODULE_PATH), "--database-url", marker],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(marker, result.stdout + result.stderr)
        self.assertIn("invalid arguments", result.stderr)


if __name__ == "__main__":
    unittest.main()
