# API-02 local load and boundary acceptance

This procedure closes the evidence gap between the request-limit unit tests and
a production rollout. It does **not** authorize testing against production.
Run it first on an isolated, production-like host with synthetic data.

## Safety boundary

- The tool is plan-only by default. It sends nothing without `--execute` and
  the exact confirmation phrase printed by `--help`.
- `--target` is mandatory and accepts only a bare `http(s)` origin using
  `localhost`, `127.0.0.1`, or `::1`. DNS is rechecked before execution.
- The tool has no option for passwords, cookies, authorization headers, tokens,
  or custom bodies. Every request contains only a generated `probe` string; it
  does not read or record response bodies or headers.
- Concurrency is capped at 8 and iterations at 10. The report is a new `0600`
  file and an existing path is never overwritten.
- The target must be the **local Nginx proxy**, not a public hostname and not a
  remote origin. Stop if the plan shows the wrong port or route.

In plain terms: the tool can knock on the copy of the door on the same machine,
but it cannot carry a key and it cannot reach the real public door.

## 1. Prove code-level pre-database rejection

From the exact release checkout:

```sh
npm ci
npm run test:api-02:acceptance
```

Save the commit SHA and complete test output. The tests call the real route
handlers with synthetic actors and assert that oversized arrays/strings return
400 before settings lookups, database transactions, password hashing, or login
authentication. They also test exact and plus-one byte limits, including UTF-8,
and the tool's safety controls.

This is the automatic proof for row ceilings. Protected routes authenticate
before reading their bodies, so an HTTP tool that refuses credentials cannot
also prove their application row-limit branch. Do not weaken authentication or
add a test bypass to make that possible.

## 2. Review the request-free plan

Use the port of the isolated host's local Nginx listener:

```sh
node scripts/api-02-boundary-acceptance.mjs \
  --target http://127.0.0.1:8080
```

The output says `plan-only-no-requests` and lists, for every core route, the
exact body ceiling and ceiling plus one. Review it alongside `nginx -T` and
confirm the local listener uses the intended API-02 body limits and retains all
proxy headers. Plan mode is safe to repeat because it performs no network I/O.

## 3. Execute local edge boundary probes

Only after the plan and local listener are approved:

```sh
node scripts/api-02-boundary-acceptance.mjs \
  --target http://127.0.0.1:8080 \
  --execute \
  --confirm API02_LOCAL_BOUNDARY_ACCEPTANCE \
  --concurrency 1 \
  --iterations 1 \
  --report /absolute/new/evidence/api-02-edge.json
```

Expected result:

- every exact-ceiling probe is not 413 and not 5xx; protected routes normally
  return 401 because no credential is sent, while login/change-password normally
  return a safe 400/401 validation response;
- every ceiling-plus-one probe returns 413 at Nginx, before it can reach the
  application or database;
- the summary says `passed: true`, and the private report contains only status,
  byte count, timing, route, and method.

A 401 on a plus-one probe is a failure: it means the request reached application
authentication instead of being stopped at the local edge. A 413 at the exact
ceiling is also a failure: the configured limit is smaller than documented.

## 4. Measure representative authenticated work manually

The credential-free tool deliberately cannot submit a successful protected
business write. On the isolated environment, an authorized operator must use an
approved load client and short-lived **synthetic** accounts held by that client.
Do not put a password, cookie, token, request body, or connection string in the
command line, report, shell history, or ticket.

The scenario must include:

1. one valid request at each documented row boundary;
2. one row-boundary-plus-one request, expected 400, with relevant table counts
   unchanged before and after;
3. representative ordinary requests mixed with boundary requests;
4. agreed concurrency stages, held long enough to observe steady memory rather
   than only startup; and
5. a post-run smoke test of login and a normal business write.

Use synthetic IDs and values. Record only scenario names, counts, response
status totals, and latency percentiles. The operator may compare aggregate
`COUNT(*)` values in the isolated database, but must not export rows or personal
fields. If a plus-one request changes a count, stop acceptance immediately.

## 5. Capture RSS, latency, and restart evidence

Before, during, and after the representative run, save these read-only outputs:

```sh
systemctl show data-statistics.service \
  -p MainPID -p InvocationID -p NRestarts -p ActiveState -p SubState \
  -p MemoryCurrent -p MemoryPeak -p MemoryHigh -p MemoryMax

systemctl status data-statistics.service --no-pager
```

Also record host total/available memory, PostgreSQL and Nginx memory, request
concurrency, duration, throughput, p50/p95/p99 latency, 4xx/5xx totals, timeouts,
and the local edge report. Sample `MemoryCurrent` throughout the steady phase;
use `MemoryPeak` or the cgroup `memory.peak` as the peak RSS evidence supported
by that host. Record which source was used. Do not reset counters just to make
the evidence look clean.

Acceptance requires the same non-zero `MainPID` and `InvocationID`, unchanged
`NRestarts`, active/running state, no OOM event, no unexpected 5xx/timeouts, and
latency inside the separately approved service objective. Investigate rather
than average away any restart or OOM.

## 6. Derive, review, and validate memory ceilings

Do not copy a value from another host and do not put a guessed number in the
repository. Attach the completed evidence template to the change ticket, then:

1. choose the accepted peak from a repeatable production-like run;
2. add the explicitly approved headroom to obtain a candidate `MemoryHigh`;
3. choose `MemoryMax` above `MemoryHigh`, while leaving measured, approved RAM
   for PostgreSQL, Nginx, the kernel, and concurrent maintenance work;
4. peer-review the arithmetic and host reserve;
5. install the drop-in only in an approved maintenance window;
6. run `systemd-analyze verify`, `daemon-reload`, restart once, and repeat the
   same test; and
7. confirm `systemctl show` reports the intended values and the service remains
   within them without reclaim stalls, OOMs, or restarts.

Rollback means removing only the API-02 memory drop-in, running daemon-reload,
and restarting in the approved window. Keep the failed evidence; do not replace
it with only the successful rerun.

## Manual boundary that cannot be automated safely

Production deployment, real authentication, production database non-mutation,
the selected service objective, and final `MemoryHigh`/`MemoryMax` approval need
named human sign-off. This repository can prove the guard logic and provide a
credential-free local edge probe; it cannot truthfully certify those live facts.
