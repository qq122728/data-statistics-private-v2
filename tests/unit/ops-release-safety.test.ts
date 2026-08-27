import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const pruneScript = join(process.cwd(), "scripts/ops/prune-releases.sh");
const stopScript = join(process.cwd(), "scripts/ops/stop-orphan-next.sh");
const inspectScript = join(process.cwd(), "scripts/ops/inspect-runtime-processes.sh");
const lockScript = join(process.cwd(), "scripts/ops/with-release-lock.sh");
const postDeployScript = join(process.cwd(), "scripts/ops/post-deploy-release-cleanup.sh");

function executable(root: string, name: string, contents: string) {
  const path = join(root, name);
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${contents}\n`);
  chmodSync(path, 0o755);
  return path;
}

function createFlockMock(root: string, succeeds = true) {
  return executable(root, succeeds ? "flock-ok" : "flock-busy", `exit ${succeeds ? 0 : 1}`);
}

describe("OPS-02 operational safeguards", () => {
  it("keeps every operational shell script syntactically valid in CI", () => {
    const result = spawnSync("bash", ["-n", inspectScript, stopScript, pruneScript, lockScript, postDeployScript], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });

  it("keeps automatic post-deploy cleanup behind health checks and a separate confirmation", () => {
    const script = readFileSync(postDeployScript, "utf8");
    expect(script).toContain("OPS-02-POST-DEPLOY");
    expect(script).toContain("is-active data-statistics.service");
    expect(script).toContain("--property MainPID --value");
    expect(script).toContain('sport = :3001');
    expect(script).toContain("http://127.0.0.1:3000/login");
    expect(script).toContain("OPS-02-PRUNE-RELEASES");
    expect(script).toContain('prune_script="/usr/local/sbin/prune-data-statistics-releases"');
    expect(script).toContain('root:root:755');
  });

  it("previews post-deploy retention only after the formal service, release, port, and login checks pass", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-02-post-deploy-"));
    const releases = join(root, "releases");
    const proc = join(root, "proc");
    mkdirSync(releases);
    mkdirSync(join(proc, "321"), { recursive: true });
    for (let index = 1; index <= 6; index += 1) {
      const release = join(releases, `release-${index}`);
      mkdirSync(release);
      execFileSync("touch", ["-t", `2026080${index}1200`, release]);
    }
    symlinkSync(join(releases, "release-6"), join(root, "app"));
    symlinkSync(join(releases, "release-6"), join(proc, "321", "cwd"));
    const systemctl = executable(root, "systemctl-post-deploy", `
if [[ "$1" == "is-active" ]]; then echo active; exit 0; fi
if [[ "$1" == "show" ]]; then echo 321; exit 0; fi
exit 1`);
    const curl = executable(root, "curl-post-deploy", "exit 0");
    const ss = executable(root, "ss-post-deploy", "exit 0");
    const flock = createFlockMock(root);
    const environment = {
      ...process.env,
      DEPLOY_ROOT: root,
      RELEASES_ROOT: releases,
      CURRENT_LINK: join(root, "app"),
      OPS02_PROC_ROOT: proc,
      OPS02_SYSTEMCTL_BIN: systemctl,
      OPS02_CURL_BIN: curl,
      OPS02_SS_BIN: ss,
      OPS02_RELEASE_LOCK_FILE: join(root, "release.lock"),
      OPS02_FLOCK_BIN: flock,
    };

    const valid = spawnSync("bash", [postDeployScript, "--keep", "5", "--rollback-release", "release-5"], {
      encoding: "utf8",
      env: environment,
    });
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.stdout).toContain("Formal service is active on the current release");
    expect(valid.stdout).toContain("DRY RUN: post-deploy checks passed");
    expect(existsSync(join(releases, "release-1"))).toBe(true);

    writeFileSync(ss, "#!/usr/bin/env bash\necho 'LISTEN 0 511 127.0.0.1:3001'\n");
    chmodSync(ss, 0o755);
    const oldPort = spawnSync("bash", [postDeployScript, "--rollback-release", "release-5"], {
      encoding: "utf8",
      env: environment,
    });
    expect(oldPort.status).toBe(1);
    expect(oldPort.stderr).toContain("TCP 3001 is still listening");
    expect(existsSync(join(releases, "release-1"))).toBe(true);
  });

  it("keeps destructive operations behind exact confirmation tokens", () => {
    const prune = readFileSync(pruneScript, "utf8");
    const stop = readFileSync(stopScript, "utf8");
    const inspect = readFileSync(inspectScript, "utf8");

    expect(prune).toContain('OPS-02-PRUNE-RELEASES');
    expect(prune).toContain('[[ -n "$rollback" ]]');
    expect(prune).toContain('add_protected "$current"');
    expect(prune).toContain('running process cwd');
    expect(prune).toContain("current release changed during cleanup");
    expect(stop).toContain('OPS-02-STOP-3001');
    expect(stop).toContain('--expected-starttime');
    expect(stop).toContain('SubState=${scope_substate');
    expect(stop).toContain('[[ "$cwd" != "$current" ]]');
    expect(stop).toContain('active TCP ${port} connections exist');
    expect(stop).not.toContain("kill -KILL");
    expect(inspect).not.toContain("journalctl");
    expect(inspect).not.toContain('systemctl status "$pid"');
  });

  it("rejects retention outside the approved 5-to-10 range", () => {
    const result = spawnSync("bash", [pruneScript, "--keep", "4"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("between 5 and 10");
  });

  it("dry-runs cleanup while protecting current, rollback, and newest releases", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-02-"));
    const releases = join(root, "releases");
    mkdirSync(releases);
    const names = Array.from({ length: 12 }, (_, index) => `release-${String(index + 1).padStart(2, "0")}`);
    for (const [index, name] of names.entries()) {
      const path = join(releases, name);
      mkdirSync(path);
      writeFileSync(join(path, "marker"), name);
      execFileSync("touch", ["-t", `202608${String(index + 1).padStart(2, "0")}1200`, path]);
    }
    symlinkSync(join(releases, "release-03"), join(root, "app"));
    chmodSync(pruneScript, 0o755);
    const flock = createFlockMock(root);

    const output = execFileSync("bash", [pruneScript, "--keep", "5", "--rollback-release", "release-02"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DEPLOY_ROOT: root,
        RELEASES_ROOT: releases,
        CURRENT_LINK: join(root, "app"),
        OPS02_RELEASE_LOCK_FILE: join(root, "release.lock"),
        OPS02_FLOCK_BIN: flock,
      },
    });

    expect(output).toContain("DRY RUN: nothing deleted");
    const candidates = output.split("Prune candidates")[1]?.split("DRY RUN")[0] ?? "";
    expect(candidates).toContain(join(releases, "release-01"));
    expect(candidates).not.toContain(join(releases, "release-02"));
    expect(candidates).not.toContain(join(releases, "release-03"));
    for (const name of names) expect(readFileSync(join(releases, name, "marker"), "utf8")).toBe(name);
  });

  it("refuses cleanup when the shared deployment lock is held", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-02-lock-"));
    const releases = join(root, "releases");
    mkdirSync(releases);
    mkdirSync(join(releases, "current"));
    symlinkSync(join(releases, "current"), join(root, "app"));
    const result = spawnSync("bash", [pruneScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        DEPLOY_ROOT: root,
        RELEASES_ROOT: releases,
        CURRENT_LINK: join(root, "app"),
        OPS02_RELEASE_LOCK_FILE: join(root, "release.lock"),
        OPS02_FLOCK_BIN: createFlockMock(root, false),
      },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("release lock is held");
  });

  it.skipIf(process.platform !== "linux")("uses a real flock inode to exclude a second cleanup process", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-02-real-flock-"));
    const releases = join(root, "releases");
    const current = join(releases, "current");
    const lock = join(root, "release.lock");
    const ready = join(root, "holder-ready");
    mkdirSync(current, { recursive: true });
    symlinkSync(current, join(root, "app"));

    const result = spawnSync(
      "bash",
      [
        "-c",
        `
set -euo pipefail
command -v flock >/dev/null
flock -n "$1" bash -c 'touch "$1"; sleep 2' bash "$2" &
holder=$!
for _ in {1..100}; do
  [[ -e "$2" ]] && break
  sleep 0.02
done
[[ -e "$2" ]]
set +e
output="$(DEPLOY_ROOT="$3" RELEASES_ROOT="$4" CURRENT_LINK="$5" OPS02_RELEASE_LOCK_FILE="$1" OPS02_FLOCK_BIN=flock bash "$6" 2>&1)"
status=$?
set -e
wait "$holder"
[[ "$status" -eq 1 ]]
[[ "$output" == *"release lock is held"* ]]
`,
        "bash",
        lock,
        ready,
        root,
        releases,
        join(root, "app"),
        pruneScript,
      ],
      { encoding: "utf8" },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  it("maps symlink targets and process working directories in subdirectories to their release root", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-02-subdir-protection-"));
    const releases = join(root, "releases");
    const proc = join(root, "proc");
    mkdirSync(releases);
    mkdirSync(proc);
    for (let index = 1; index <= 12; index += 1) {
      const release = join(releases, `release-${String(index).padStart(2, "0")}`);
      mkdirSync(join(release, "nested"), { recursive: true });
      execFileSync("touch", ["-t", `202608${String(index).padStart(2, "0")}1200`, release]);
    }
    symlinkSync(join(releases, "release-12"), join(root, "app"));
    symlinkSync(join(releases, "release-01", "nested"), join(root, "legacy-link"));
    mkdirSync(join(proc, "321"));
    symlinkSync(join(releases, "release-02", "nested"), join(proc, "321", "cwd"));

    const output = execFileSync("bash", [pruneScript, "--keep", "5", "--rollback-release", "release-11"], {
      encoding: "utf8",
      env: {
        ...process.env,
        DEPLOY_ROOT: root,
        RELEASES_ROOT: releases,
        CURRENT_LINK: join(root, "app"),
        OPS02_PROC_ROOT: proc,
        OPS02_RELEASE_LOCK_FILE: join(root, "release.lock"),
        OPS02_FLOCK_BIN: createFlockMock(root),
      },
    });

    const candidates = output.split("Prune candidates")[1]?.split("DRY RUN")[0] ?? "";
    expect(candidates).not.toContain(join(releases, "release-01"));
    expect(candidates).not.toContain(join(releases, "release-02"));
    expect(output).toContain("running process cwd");
    expect(output).toContain("symlink");
  });

  it("rechecks a new process cwd in a release subdirectory immediately before deletion", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-02-process-race-"));
    const releases = join(root, "releases");
    const proc = join(root, "proc");
    mkdirSync(releases);
    mkdirSync(proc);
    for (let index = 1; index <= 6; index += 1) {
      const release = join(releases, `release-${index}`);
      mkdirSync(join(release, "nested"), { recursive: true });
      execFileSync("touch", ["-t", `2026080${index}1200`, release]);
    }
    symlinkSync(join(releases, "release-6"), join(root, "app"));
    const target = execFileSync("realpath", [join(releases, "release-1")], { encoding: "utf8" }).trim();
    const identity = executable(root, "identity-process-race", `
if [[ "$1" == "${target}" && ! -e "${proc}/777/cwd" ]]; then
  mkdir -p "${proc}/777"
  ln -s "${target}/nested" "${proc}/777/cwd"
fi
stat -f '%d:%i' "$1" 2>/dev/null || stat -Lc '%d:%i' "$1"
`);
    const result = spawnSync(
      "bash",
      [pruneScript, "--keep", "5", "--rollback-release", "release-5", "--apply", "--confirm", "OPS-02-PRUNE-RELEASES"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DEPLOY_ROOT: root,
          RELEASES_ROOT: releases,
          CURRENT_LINK: join(root, "app"),
          OPS02_PROC_ROOT: proc,
          OPS02_RELEASE_LOCK_FILE: join(root, "release.lock"),
          OPS02_FLOCK_BIN: createFlockMock(root),
          OPS02_IDENTITY_BIN: identity,
          OPS02_TEST_ALLOW_UNPRIVILEGED: "1",
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("process began using cleanup candidate");
    expect(existsSync(target)).toBe(true);
  });

  it("refuses to delete a candidate whose device/inode identity changed", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-02-inode-"));
    const releases = join(root, "releases");
    mkdirSync(releases);
    for (let index = 1; index <= 6; index += 1) {
      const release = join(releases, `release-${index}`);
      mkdirSync(release);
      execFileSync("touch", ["-t", `2026080${index}1200`, release]);
    }
    symlinkSync(join(releases, "release-6"), join(root, "app"));
    const target = execFileSync("realpath", [join(releases, "release-1")], { encoding: "utf8" }).trim();
    const count = join(root, "identity-count");
    const identity = executable(root, "identity", `
if [[ "$1" == "${target}" ]]; then
  if [[ -e "${count}" ]]; then echo '9:999'; else : >"${count}"; echo '9:111'; fi
else
  stat -f '%d:%i' "$1" 2>/dev/null || stat -Lc '%d:%i' "$1"
fi`);
    const result = spawnSync(
      "bash",
      [pruneScript, "--keep", "5", "--rollback-release", "release-5", "--apply", "--confirm", "OPS-02-PRUNE-RELEASES"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          TMPDIR: tmpdir(),
          DEPLOY_ROOT: root,
          RELEASES_ROOT: releases,
          CURRENT_LINK: join(root, "app"),
          OPS02_RELEASE_LOCK_FILE: join(root, "release.lock"),
          OPS02_FLOCK_BIN: createFlockMock(root),
          OPS02_IDENTITY_BIN: identity,
          OPS02_TEST_ALLOW_UNPRIVILEGED: "1",
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("identity changed");
    expect(readFileSync(count, "utf8")).toBe("");
    expect(existsSync(target)).toBe(true);
  });

  it("binds an orphan stop approval to PID, starttime, release, and abandoned session", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-02-stop-"));
    const releases = join(root, "releases");
    const current = join(releases, "current");
    const old = join(releases, "old");
    const proc = join(root, "proc");
    const pidRoot = join(proc, "123");
    mkdirSync(current, { recursive: true });
    mkdirSync(old);
    mkdirSync(pidRoot, { recursive: true });
    symlinkSync(current, join(root, "app"));
    symlinkSync(old, join(pidRoot, "cwd"));
    writeFileSync(join(pidRoot, "cmdline"), Buffer.from("next-server\u0000--port\u00003001\u0000"));
    const middleFields = Array.from({ length: 18 }, (_, index) => String(index + 1));
    writeFileSync(join(pidRoot, "stat"), `123 (next-server) S ${middleFields.join(" ")} 4242 0 0\n`);
    writeFileSync(join(pidRoot, "cgroup"), "0::/user.slice/user-501.slice/session-798.scope\n");

    const ss = executable(root, "ss", `
if [[ "$*" == *"-lntp"* ]]; then
  echo 'LISTEN 0 511 127.0.0.1:3001 0.0.0.0:* users:(("next-server",pid=123,fd=18))'
fi`);
    const systemctl = executable(root, "systemctl", "echo abandoned");
    const loginctl = executable(root, "loginctl", "echo session-798.scope");
    const nginx = executable(root, "nginx", "echo 'events {} http {}'");
    const owner = execFileSync("id", ["-un"], { encoding: "utf8" }).trim();
    const environment = {
      ...process.env,
      DEPLOY_ROOT: root,
      OPS02_PROC_ROOT: proc,
      OPS02_SS_BIN: ss,
      OPS02_SYSTEMCTL_BIN: systemctl,
      OPS02_LOGINCTL_BIN: loginctl,
      OPS02_NGINX_BIN: nginx,
    };
    const run = (extraArguments: string[] = []) => spawnSync(
      "bash",
      [
        stopScript,
        "--user", owner,
        "--expected-pid", "123",
        "--expected-release", old,
        "--expected-starttime", "4242",
        ...extraArguments,
      ],
      { encoding: "utf8", env: environment },
    );

    const valid = run();
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.stdout).toContain("DRY RUN: no signal sent");

    writeFileSync(ss, "#!/usr/bin/env bash\necho 'LISTEN users:((\"next-server\",pid=123,fd=18),(\"next-server\",pid=124,fd=19))'\n");
    chmodSync(ss, 0o755);
    const multipleListeners = run();
    expect(multipleListeners.status).toBe(1);
    expect(multipleListeners.stderr).toContain("found 2");
    writeFileSync(ss, `#!/usr/bin/env bash
if [[ "$*" == *"-lntp"* ]]; then
  echo 'LISTEN 0 511 127.0.0.1:3001 0.0.0.0:* users:(("next-server",pid=123,fd=18))'
fi
`);
    chmodSync(ss, 0o755);

    writeFileSync(nginx, "#!/usr/bin/env bash\necho 'upstream legacy { server 127.0.0.1:3001; }'\n");
    chmodSync(nginx, 0o755);
    const upstreamReference = run();
    expect(upstreamReference.status).toBe(1);
    expect(upstreamReference.stderr).toContain("directly or through an upstream");

    const wrongPid = spawnSync(
      "bash",
      [stopScript, "--user", owner, "--expected-pid", "124", "--expected-release", old, "--expected-starttime", "4242"],
      { encoding: "utf8", env: environment },
    );
    expect(wrongPid.status).toBe(1);
    expect(wrongPid.stderr).toContain("not approved PID");

    const wrongStarttime = spawnSync(
      "bash",
      [stopScript, "--user", owner, "--expected-pid", "123", "--expected-release", old, "--expected-starttime", "9999"],
      { encoding: "utf8", env: environment },
    );
    expect(wrongStarttime.status).toBe(1);
    expect(wrongStarttime.stderr).toContain("starttime changed");

    writeFileSync(join(pidRoot, "cgroup"), "0::/system.slice/other.service\n");
    const managedService = run();
    expect(managedService.status).toBe(1);
    expect(managedService.stderr).toContain("managed service cgroup");
  });

  it("fails closed when session cgroup membership is missing, unreadable, failed, or nonempty", () => {
    const root = mkdtempSync(join(tmpdir(), "ops-02-session-cleanup-"));
    const cgroup = join(root, "cgroup", "user.slice", "session-798.scope");
    const marker = join(root, "terminated");
    mkdirSync(cgroup, { recursive: true });
    const loginctl = executable(root, "loginctl-cleanup", `
if [[ "$1" == "show-session" ]]; then
  echo session-798.scope
elif [[ "$1" == "terminate-session" ]]; then
  echo called >>"${marker}"
fi
`);
    const systemctl = executable(root, "systemctl-cleanup", "echo abandoned");
    const run = (pathPrefix = process.env.PATH) => spawnSync(
      "bash",
      [
        "-c",
        `source "$1"; cgroup_root="$2"; loginctl_bin="$3"; systemctl_bin="$4"; cleanup_abandoned_session 798 session-798.scope /user.slice/session-798.scope`,
        "bash",
        stopScript,
        join(root, "cgroup"),
        loginctl,
        systemctl,
      ],
      { encoding: "utf8", env: { ...process.env, PATH: pathPrefix } },
    );

    const missing = run();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("unable to read");
    expect(existsSync(marker)).toBe(false);

    mkdirSync(join(cgroup, "cgroup.procs"));
    const unreadable = run();
    expect(unreadable.status).toBe(1);
    expect(unreadable.stderr).toContain("unable to read");
    expect(existsSync(marker)).toBe(false);
    execFileSync("rmdir", [join(cgroup, "cgroup.procs")]);

    writeFileSync(join(cgroup, "cgroup.procs"), "");
    chmodSync(join(cgroup, "cgroup.procs"), 0o000);
    const unreadableFile = run();
    expect(unreadableFile.status).toBe(1);
    expect(unreadableFile.stderr).toContain("unable to read");
    expect(existsSync(marker)).toBe(false);
    chmodSync(join(cgroup, "cgroup.procs"), 0o600);

    writeFileSync(join(cgroup, "cgroup.procs"), "123\n456\n");
    const nonempty = run();
    expect(nonempty.status).toBe(1);
    expect(nonempty.stderr).toContain("still contains processes");
    expect(existsSync(marker)).toBe(false);

    writeFileSync(join(cgroup, "cgroup.procs"), "");
    const trFail = executable(root, "tr", "exit 23");
    const readFailure = run(`${root}:${process.env.PATH}`);
    expect(readFailure.status).toBe(1);
    expect(readFailure.stderr).toContain("failed to read");
    expect(existsSync(marker)).toBe(false);
    expect(trFail).toBe(join(root, "tr"));

    unlinkSync(trFail);
    const empty = run();
    expect(empty.status, empty.stderr).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("called\n");
  });

});
