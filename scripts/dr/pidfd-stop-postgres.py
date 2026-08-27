#!/usr/bin/env python3
"""Stop one validated PostgreSQL postmaster through a Linux pidfd."""

from __future__ import annotations

import argparse
import os
import select
import signal
import sys
import time
from pathlib import Path


def proc_identity(pid: int) -> tuple[str, int, int, list[str]]:
    proc = Path("/proc") / str(pid)
    executable = os.path.realpath(proc / "exe")
    raw_stat = (proc / "stat").read_text(encoding="utf-8")
    closing = raw_stat.rfind(") ")
    if closing < 0:
        raise ValueError("invalid /proc stat format")
    fields = raw_stat[closing + 2 :].split()
    if len(fields) < 20:
        raise ValueError("incomplete /proc stat")
    session_id = int(fields[3])
    start_ticks = int(fields[19])
    argv = (proc / "cmdline").read_bytes().rstrip(b"\0").decode("utf-8").split("\0")
    return executable, session_id, start_ticks, argv


def validate_identity(
    pid: int,
    data_dir: Path,
    expected_postgres: Path,
    expected_start_ticks: int,
) -> None:
    pid_lines = (data_dir / "postmaster.pid").read_text(encoding="utf-8").splitlines()
    if len(pid_lines) < 3 or pid_lines[0] != str(pid) or pid_lines[1] != str(data_dir):
        raise ValueError("postmaster.pid identity changed")
    executable, session_id, start_ticks, argv = proc_identity(pid)
    if executable != os.path.realpath(expected_postgres):
        raise ValueError("postmaster executable changed")
    if session_id != pid or start_ticks != expected_start_ticks:
        raise ValueError("postmaster process identity changed")
    if os.stat(data_dir).st_uid != os.stat(Path("/proc") / str(pid)).st_uid:
        raise ValueError("postmaster owner changed")
    pgdata_matches = any(
        (value == "-D" and index + 1 < len(argv) and argv[index + 1] == str(data_dir))
        or value == f"-D{data_dir}"
        or value == f"--pgdata={data_dir}"
        for index, value in enumerate(argv)
    )
    if not pgdata_matches:
        raise ValueError("postmaster data argument changed")


def stop_postgres(
    pid: int,
    data_dir: Path,
    expected_postgres: Path,
    expected_start_ticks: int,
    timeout_seconds: int,
    test_delay_ms: int = 0,
) -> None:
    if not hasattr(os, "pidfd_open") or not hasattr(signal, "pidfd_send_signal"):
        raise RuntimeError("Linux pidfd support is required for exact PostgreSQL cleanup")
    pidfd = os.pidfd_open(pid, 0)
    try:
        poller = select.poll()
        poller.register(pidfd, select.POLLIN)
        if poller.poll(0):
            raise ValueError("postmaster exited before identity validation")
        validate_identity(pid, data_dir, expected_postgres, expected_start_ticks)
        if test_delay_ms:
            time.sleep(test_delay_ms / 1000)
        validate_identity(pid, data_dir, expected_postgres, expected_start_ticks)
        if poller.poll(0):
            raise ValueError("postmaster exited before exact signal delivery")
        # PostgreSQL documents SIGINT as fast shutdown, matching pg_ctl -m fast.
        signal.pidfd_send_signal(pidfd, signal.SIGINT)
        if not poller.poll(timeout_seconds * 1000):
            raise TimeoutError("PostgreSQL did not stop within the bounded pidfd wait")
    finally:
        os.close(pidfd)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", required=True, type=int)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--expected-postgres", required=True, type=Path)
    parser.add_argument("--expected-start-ticks", required=True, type=int)
    parser.add_argument("--timeout-seconds", required=True, type=int)
    parser.add_argument("--test-delay-ms", type=int, default=0, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 1 <= args.timeout_seconds <= 300 or not 0 <= args.test_delay_ms <= 5000:
        raise SystemExit("invalid bounded pidfd timing")
    try:
        stop_postgres(
            args.pid,
            args.data_dir,
            args.expected_postgres,
            args.expected_start_ticks,
            args.timeout_seconds,
            args.test_delay_ms,
        )
    except (OSError, RuntimeError, TimeoutError, UnicodeError, ValueError) as error:
        raise SystemExit(str(error)) from error


if __name__ == "__main__":
    main()
