#!/usr/bin/env python3
"""Read-only, privacy-safe production security rollout preflight."""

from __future__ import annotations

import argparse
import grp
import json
import os
import pwd
import re
import subprocess
from pathlib import Path
from typing import Callable


EXPECTED_NEXT_VERSION = "16.3.3"
EXPECTED_MIGRATION_COUNT = 39
EXPECTED_LATEST_MIGRATION = "20260830022000_backfill_legacy_account_structure"
EXPECTED_RUNTIME_USER = "data-statistics-runtime"
EXPECTED_RELEASE_SHA = re.compile(r"^[0-9a-f]{40}$")

DEPLOY_ROOT = Path("/opt/data-statistics")
RELEASES_ROOT = DEPLOY_ROOT / "releases"
CURRENT_LINK = DEPLOY_ROOT / "app"
RELEASE_SHA_FILE = ".release-commit"
POSTGRES_SOCKET = Path("/var/run/postgresql")
DATABASE_NAME = "data_statistics"

SYSTEMCTL = Path("/usr/bin/systemctl")
SS = Path("/usr/bin/ss")
RUNUSER = Path("/usr/sbin/runuser")
PSQL = Path("/usr/bin/psql")
UFW = Path("/usr/sbin/ufw")
TEST = Path("/usr/bin/test")
CLOUDFLARE_AUDIT = Path("/usr/local/sbin/sync-data-statistics-cloudflare-ufw")

TIMERS = (
    "data-statistics-cloudflare-ufw.timer",
    "data-statistics-net02-deadman.timer",
    "data-statistics-net02-emergency-expiry.timer",
    "data-statistics-log-capacity-check.timer",
    "data-statistics-journal-suppression-check.timer",
    "data-statistics-pgbackrest-full.timer",
    "data-statistics-pgbackrest-diff.timer",
    "data-statistics-pgbackrest-check.timer",
    "data-statistics-pgbackrest-verify.timer",
    "data-statistics-restore-rehearsal.timer",
)

DB_QUERY = r"""
BEGIN READ ONLY;
SELECT json_build_object(
  'migrationCount', (SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
  'migrationTotalCount', (SELECT count(*) FROM public._prisma_migrations),
  'latestMigration', (SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1),
  'archiveMode', current_setting('archive_mode'),
  'rolesReady',
    (SELECT count(*) = 2 AND bool_and(rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
       FROM pg_roles WHERE rolname IN ('data_statistics_runtime','data_statistics_migrator'))
    AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname='data_statistics' AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls),
  'membershipViolations', (SELECT count(*) FROM pg_auth_members m JOIN pg_roles g ON g.oid=m.roleid JOIN pg_roles r ON r.oid=m.member
    WHERE r.rolname IN ('data_statistics_runtime','data_statistics_migrator','data_statistics') OR g.rolname IN ('data_statistics_runtime','data_statistics_migrator','data_statistics')),
  'databaseAclReady',
    pg_get_userbyid((SELECT datdba FROM pg_database WHERE datname=current_database()))='data_statistics_migrator'
    AND has_database_privilege('data_statistics_runtime',current_database(),'CONNECT')
    AND NOT has_database_privilege('data_statistics_runtime',current_database(),'CREATE')
    AND NOT has_database_privilege('data_statistics_runtime',current_database(),'TEMPORARY')
    AND NOT EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a
      WHERE d.datname=current_database() AND a.grantee=0 AND a.privilege_type IN ('CONNECT','CREATE','TEMPORARY')),
  'schemaAclReady',
    pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname='public'))='data_statistics_migrator'
    AND has_schema_privilege('data_statistics_runtime','public','USAGE')
    AND NOT has_schema_privilege('data_statistics_runtime','public','CREATE')
    AND NOT EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) a
      WHERE n.nspname='public' AND a.grantee=0 AND a.privilege_type IN ('USAGE','CREATE')),
  'ownerViolations', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','S') AND pg_get_userbyid(c.relowner)<>'data_statistics_migrator'),
  'runtimeObjectOwnerViolations', (SELECT count(*) FROM (
      SELECT c.relowner owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL SELECT t.typowner FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'
      UNION ALL SELECT p.proowner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    ) objects WHERE pg_get_userbyid(owner)='data_statistics_runtime'),
  'tableAclViolations', (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND (
      (table_name<>'_prisma_migrations' AND (NOT has_table_privilege('data_statistics_runtime',format('%I.%I',table_schema,table_name),'SELECT')
        OR NOT has_table_privilege('data_statistics_runtime',format('%I.%I',table_schema,table_name),'INSERT')
        OR NOT has_table_privilege('data_statistics_runtime',format('%I.%I',table_schema,table_name),'UPDATE')
        OR NOT has_table_privilege('data_statistics_runtime',format('%I.%I',table_schema,table_name),'DELETE')))
      OR has_table_privilege('data_statistics_runtime',format('%I.%I',table_schema,table_name),'TRUNCATE,TRIGGER,REFERENCES')
      OR (table_name='_prisma_migrations' AND has_table_privilege('data_statistics_runtime',format('%I.%I',table_schema,table_name),'SELECT,INSERT,UPDATE,DELETE')))),
  'sequenceAclViolations', (SELECT count(*) FROM information_schema.sequences WHERE sequence_schema='public' AND (
      NOT has_sequence_privilege('data_statistics_runtime',format('%I.%I',sequence_schema,sequence_name),'USAGE')
      OR NOT has_sequence_privilege('data_statistics_runtime',format('%I.%I',sequence_schema,sequence_name),'SELECT')
      OR has_sequence_privilege('data_statistics_runtime',format('%I.%I',sequence_schema,sequence_name),'UPDATE'))),
  'functionAclViolations', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND (has_function_privilege('data_statistics_runtime',p.oid,'EXECUTE')
      OR has_function_privilege('data_statistics',p.oid,'EXECUTE')
      OR EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))),
  'defaultAclReady', EXISTS (SELECT 1 FROM pg_default_acl d
      WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='data_statistics_migrator') AND d.defaclnamespace=0 AND d.defaclobjtype='f')
    AND NOT EXISTS (SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='data_statistics_migrator')
        AND (a.grantee=(SELECT oid FROM pg_roles WHERE rolname='data_statistics_runtime') OR (d.defaclobjtype='f' AND a.grantee=0 AND a.privilege_type='EXECUTE'))),
  'legacyAclViolations',
    (CASE WHEN has_database_privilege('data_statistics',current_database(),'CONNECT') OR has_database_privilege('data_statistics',current_database(),'CREATE')
      OR has_database_privilege('data_statistics',current_database(),'TEMPORARY') OR has_schema_privilege('data_statistics','public','USAGE')
      OR has_schema_privilege('data_statistics','public','CREATE') THEN 1 ELSE 0 END)
    + (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND (
      pg_get_userbyid(c.relowner)='data_statistics' OR (c.relkind IN ('r','p','v','m','f') AND has_table_privilege('data_statistics',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      OR (c.relkind='S' AND has_sequence_privilege('data_statistics',c.oid,'USAGE,SELECT,UPDATE'))))
)::text;
COMMIT;
"""


class PreflightError(RuntimeError):
    """An error message that is safe to include in a redacted preflight."""


class SafeArgumentParser(argparse.ArgumentParser):
    def error(self, _message: str) -> None:
        self.exit(2, "ERROR: invalid arguments; use --help for approved options\n")


def command(
    arguments: list[str],
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    timeout: int = 15,
    allowed_returncodes: tuple[int, ...] = (0,),
) -> str:
    try:
        result = runner(
            arguments,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"},
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise PreflightError("approved read-only command could not run") from error
    if result.returncode not in allowed_returncodes:
        # stderr can contain paths, addresses, configuration, or connection details.
        raise PreflightError("approved read-only command returned a failure")
    return result.stdout.strip()


def protected_regular_file(path: Path, forbidden_write_mask: int = 0o022) -> bool:
    try:
        details = path.lstat()
    except OSError:
        return False
    return path.is_file() and not path.is_symlink() and not (details.st_mode & forbidden_write_mask)


def current_release() -> Path:
    if not CURRENT_LINK.is_symlink():
        raise PreflightError("current release link is missing or unsafe")
    try:
        releases_root = RELEASES_ROOT.resolve(strict=True)
        release = CURRENT_LINK.resolve(strict=True)
    except OSError as error:
        raise PreflightError("current release link could not be resolved") from error
    if release.parent != releases_root or not release.is_dir():
        raise PreflightError("current release is outside the approved release root")
    return release


def read_release_evidence(release: Path, expected_sha: str) -> dict[str, bool | str]:
    try:
        approved_release = release.resolve(strict=True)
        package_path = release / "node_modules" / "next" / "package.json"
        sha_path = release / RELEASE_SHA_FILE
        resolved_package = package_path.resolve(strict=True)
        resolved_sha = sha_path.resolve(strict=True)
        if approved_release not in resolved_package.parents or approved_release not in resolved_sha.parents:
            raise PreflightError("release evidence resolves outside the release")
        if any(candidate.is_symlink() for candidate in (release / "node_modules", release / "node_modules" / "next")):
            raise PreflightError("release evidence uses an unsafe intermediate link")
        if not protected_regular_file(package_path) or not protected_regular_file(sha_path):
            raise PreflightError("release evidence files are missing or writable")
        package = json.loads(package_path.read_text(encoding="utf-8"))
        release_sha = sha_path.read_text(encoding="ascii").strip().lower()
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise PreflightError("release evidence could not be parsed") from error
    version = package.get("version") if isinstance(package, dict) else None
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?", version):
        raise PreflightError("release version metadata is invalid")
    return {
        "nextVersion": version,
        "nextVersionMatches": version == EXPECTED_NEXT_VERSION,
        "releaseShaMatches": release_sha == expected_sha,
    }


def service_property(name: str, *, runner=subprocess.run) -> str:
    return command([str(SYSTEMCTL), "show", "data-statistics.service", "--property", name, "--value"], runner=runner)


def service_property_for(unit: str, name: str, *, runner=subprocess.run) -> str:
    return command([str(SYSTEMCTL), "show", unit, "--property", name, "--value"], runner=runner)


def runtime_account_evidence(release: Path, *, runner=subprocess.run) -> dict[str, bool]:
    protected_read = (
        DEPLOY_ROOT / ".ssh" / "data_statistics_deploy_ed25519",
        DEPLOY_ROOT / "backups",
    )
    protected_write = (DEPLOY_ROOT / "repository", release)
    try:
        account = pwd.getpwnam(EXPECTED_RUNTIME_USER)
        primary_group = grp.getgrgid(account.pw_gid).gr_name
        groups = os.getgrouplist(EXPECTED_RUNTIME_USER, account.pw_gid)
    except (KeyError, OSError):
        return {"runtimeAccountNonLogin": False, "runtimeHasNoSupplementaryGroups": False,
                "runtimeCannotReadProtectedData": False, "runtimeCannotModifyDeployments": False}

    def access_exists(flag: str, target: Path) -> bool:
        try:
            result = runner(
                [str(RUNUSER), "--user", EXPECTED_RUNTIME_USER, "--", str(TEST), flag, str(target)],
                check=False, capture_output=True, text=True, timeout=15,
                env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"},
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise PreflightError("approved account-boundary check could not run") from error
        if result.returncode not in (0, 1):
            raise PreflightError("approved account-boundary check returned a failure")
        return result.returncode == 0

    def tree_is_runtime_immutable(target: Path) -> bool:
        try:
            root_device = target.stat().st_dev
            pending = [target]
            while pending:
                candidate = pending.pop()
                details = candidate.lstat()
                if details.st_dev != root_device or candidate.is_symlink():
                    continue
                runtime_can_write = (
                    (details.st_uid == account.pw_uid and details.st_mode & 0o200)
                    or (details.st_gid in groups and details.st_mode & 0o020)
                    or details.st_mode & 0o002
                )
                # Fail closed on access ACLs rather than attempting to interpret
                # platform-specific ACL encodings as ordinary mode bits.
                list_xattrs = getattr(os, "listxattr", None)
                has_access_acl = bool(list_xattrs) and "system.posix_acl_access" in list_xattrs(candidate)
                if runtime_can_write or has_access_acl:
                    return False
                if candidate.is_dir():
                    pending.extend(Path(entry.path) for entry in os.scandir(candidate))
        except (OSError, UnicodeError):
            return False
        return True

    return {
        "runtimeAccountNonLogin": account.pw_shell in ("/usr/sbin/nologin", "/sbin/nologin", "/bin/false"),
        "runtimeHasNoSupplementaryGroups": primary_group == EXPECTED_RUNTIME_USER and set(groups) == {account.pw_gid},
        "runtimeCannotReadProtectedData": all(path.exists() for path in protected_read)
        and not any(access_exists("-r", path) for path in protected_read),
        "runtimeCannotModifyDeployments": all(path.exists() for path in protected_write)
        and all(tree_is_runtime_immutable(path) for path in protected_write),
    }


def service_evidence(release: Path, *, runner=subprocess.run, proc_root: Path = Path("/proc")) -> dict[str, bool]:
    active = command(
        [str(SYSTEMCTL), "is-active", "data-statistics.service"],
        runner=runner,
        allowed_returncodes=(0, 3, 4),
    ) == "active"
    user_matches = service_property("User", runner=runner) == EXPECTED_RUNTIME_USER
    group_matches = service_property("Group", runner=runner) == EXPECTED_RUNTIME_USER
    hardening_matches = all((
        service_property("NoNewPrivileges", runner=runner) == "yes",
        service_property("PrivateTmp", runner=runner) == "yes",
        service_property("ProtectSystem", runner=runner) == "strict",
        service_property("ProtectHome", runner=runner) == "yes",
        service_property("ReadWritePaths", runner=runner) == "/var/lib/data-statistics-runtime /var/cache/data-statistics-runtime",
        all(path in service_property("InaccessiblePaths", runner=runner).split() for path in (
            "/opt/data-statistics/.ssh", "/opt/data-statistics/repository",
            "/opt/data-statistics/backups", "/opt/data-statistics/deploy-backups")),
    ))
    exec_matches = "/usr/local/bin/node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000" in service_property("ExecStart", runner=runner)
    control_group = service_property("ControlGroup", runner=runner)
    main_pid = service_property("MainPID", runner=runner)
    cwd_matches = False
    if re.fullmatch(r"[1-9][0-9]*", main_pid):
        try:
            cwd = (proc_root / main_pid / "cwd").resolve(strict=True)
            cwd_matches = cwd == release or release in cwd.parents
        except OSError:
            cwd_matches = False
    listeners_3000 = [line for line in command([str(SS), "-H", "-lntp", "sport = :3000"], runner=runner).splitlines() if line.strip()]
    listeners_3001 = [line for line in command([str(SS), "-H", "-lntp", "sport = :3001"], runner=runner).splitlines() if line.strip()]
    socket_owned = False
    if len(listeners_3000) == 1 and re.search(r"\b127\.0\.0\.1:3000\b", listeners_3000[0]):
        pids = re.findall(r"pid=([1-9][0-9]*)", listeners_3000[0])
        try:
            socket_owned = bool(pids) and control_group.startswith("/") and all(
                any((value := line.partition("::")[2].strip()) == control_group or value.startswith(control_group + "/")
                    for line in (proc_root / pid / "cgroup").read_text(encoding="ascii").splitlines())
                for pid in pids
            )
        except (OSError, UnicodeError):
            socket_owned = False
    evidence = {
        "active": active, "runtimeUserMatches": user_matches, "runtimeGroupMatches": group_matches,
        "unitHardeningMatches": hardening_matches, "execStartMatches": exec_matches,
        "processUsesCurrentRelease": cwd_matches, "port3000OwnedByServiceOnLoopback": socket_owned,
        "port3001Closed": not listeners_3001,
    }
    evidence.update(runtime_account_evidence(release, runner=runner))
    return evidence


def database_evidence(*, runner=subprocess.run) -> dict[str, object]:
    output = command([
        str(RUNUSER), "--user", "postgres", "--", str(PSQL),
        "--no-psqlrc", "--no-password", "--quiet", "--tuples-only", "--no-align",
        "--set", "ON_ERROR_STOP=1", "--host", str(POSTGRES_SOCKET),
        "--dbname", DATABASE_NAME, "--command", DB_QUERY,
    ], runner=runner, timeout=30)
    try:
        value = json.loads(output)
    except (json.JSONDecodeError, UnicodeError) as error:
        raise PreflightError("database returned invalid preflight metadata") from error
    expected_keys = {
        "migrationCount", "migrationTotalCount", "latestMigration", "archiveMode", "rolesReady", "membershipViolations",
        "databaseAclReady", "schemaAclReady", "ownerViolations", "runtimeObjectOwnerViolations",
        "tableAclViolations", "sequenceAclViolations", "functionAclViolations", "defaultAclReady", "legacyAclViolations",
    }
    if not isinstance(value, dict) or set(value) != expected_keys:
        raise PreflightError("database returned unexpected preflight metadata")
    return {
        "migrationCountMatches": value["migrationCount"] == EXPECTED_MIGRATION_COUNT
        and value["migrationTotalCount"] == EXPECTED_MIGRATION_COUNT,
        "latestMigrationMatches": value["latestMigration"] == EXPECTED_LATEST_MIGRATION,
        "archiveModeOn": value["archiveMode"] == "on",
        "rolesReady": value["rolesReady"] is True,
        "roleMembershipsReady": value["membershipViolations"] == 0,
        "databaseAclReady": value["databaseAclReady"] is True,
        "schemaAclReady": value["schemaAclReady"] is True,
        "objectOwnershipReady": value["ownerViolations"] == 0 and value["runtimeObjectOwnerViolations"] == 0,
        "tableAclReady": value["tableAclViolations"] == 0,
        "sequenceAclReady": value["sequenceAclViolations"] == 0,
        "functionAclReady": value["functionAclViolations"] == 0,
        "defaultAclReady": value["defaultAclReady"] is True,
        "legacyRoleDisabled": value["legacyAclViolations"] == 0,
    }


def firewall_evidence(*, runner=subprocess.run, ufw_defaults: Path = Path("/etc/default/ufw")) -> dict[str, bool]:
    output = command([str(UFW), "status", "verbose"], runner=runner)
    try:
        defaults = ufw_defaults.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise PreflightError("UFW defaults could not be read") from error
    return {
        "active": bool(re.search(r"^Status:\s+active$", output, re.MULTILINE)),
        "defaultDenyIncoming": bool(re.search(r"^Default:\s+deny \(incoming\)", output, re.MULTILINE)),
        "ipv6Enabled": bool(re.search(r"^IPV6=yes\s*$", defaults, re.MULTILINE)),
        "webAllowsRestrictedToApprovedSources": command(
            [str(CLOUDFLARE_AUDIT), "--audit-lockdown"], runner=runner, timeout=60
        ) != "__impossible__",
    }


def timer_evidence(*, runner=subprocess.run) -> dict[str, bool]:
    return {
        timer: command(
            [str(SYSTEMCTL), "is-enabled", timer], runner=runner, allowed_returncodes=(0, 1, 3, 4)
        ) == "enabled"
        and command(
            [str(SYSTEMCTL), "is-active", timer], runner=runner, allowed_returncodes=(0, 3, 4)
        ) == "active"
        and service_property_for(timer.removesuffix(".timer") + ".service", "Result", runner=runner) == "success"
        and service_property_for(timer.removesuffix(".timer") + ".service", "ExecMainStatus", runner=runner) == "0"
        and service_property_for(timer, "LastTriggerUSec", runner=runner) not in ("", "n/a")
        for timer in TIMERS
    }


def collect(expected_sha: str, *, runner=subprocess.run, proc_root: Path = Path("/proc")) -> dict[str, object]:
    release = current_release()
    sections: dict[str, object] = {}
    errors: list[str] = []
    checks = (
        ("release", lambda: read_release_evidence(release, expected_sha)),
        ("service", lambda: service_evidence(release, runner=runner, proc_root=proc_root)),
        ("database", lambda: database_evidence(runner=runner)),
        ("firewall", lambda: firewall_evidence(runner=runner)),
        ("timers", lambda: timer_evidence(runner=runner)),
    )
    for name, check in checks:
        try:
            sections[name] = check()
        except Exception:
            # A programming, parsing, race, or platform error must fail closed
            # without reflecting paths, command output, or database details.
            sections[name] = None
            errors.append(name)

    def all_true(value: object) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, dict):
            return bool(value) and all(all_true(item) for item in value.values())
        return False

    passed = not errors and all(all_true(value) for value in sections.values())
    return {
        "schemaVersion": 1,
        "mode": "read-only-no-business-rows",
        "expectedReleaseSha": expected_sha,
        "allPreflightGatesPassed": passed,
        "collectionErrors": errors,
        "gates": sections,
        "limitations": [
            "This preflight does not prove business authorization behavior, log contents, external alerts, Cloudflare reachability, backup object immutability, or a successful restore.",
            "Complete the production acceptance runbook before closing any remediation item.",
        ],
    }


def main() -> None:
    parser = SafeArgumentParser(description="Run privacy-safe, read-only production security rollout preflight.")
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--inventory", action="store_true", help="return zero when collection succeeds even if rollout gates are pending")
    args = parser.parse_args()
    expected_sha = args.expected_sha
    if not EXPECTED_RELEASE_SHA.fullmatch(expected_sha):
        raise SystemExit("ERROR: --expected-sha must be a full lowercase 40-character commit SHA")
    if os.geteuid() != 0:
        raise SystemExit("ERROR: run locally as root; this tool performs read-only system and peer-authenticated database checks")
    report = collect(expected_sha)
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    if report["collectionErrors"]:
        raise SystemExit(2)
    if not args.inventory and not report["allPreflightGatesPassed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except PreflightError as error:
        raise SystemExit(f"ERROR: {error}") from error
    except Exception:
        raise SystemExit("ERROR: production preflight failed safely") from None
