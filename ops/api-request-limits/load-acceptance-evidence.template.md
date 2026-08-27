# API-02 load acceptance evidence

Do not paste credentials, cookies, tokens, connection strings, request bodies,
personal data, or response bodies into this record.

## Identity and scope

- Change ticket:
- Tester / reviewer:
- Date and timezone:
- Commit SHA / artifact digest:
- Isolated environment name:
- Local Nginx target and listener (loopback only):
- Confirmation that production was not targeted:
- Synthetic dataset description (counts only):

## Code and edge evidence

- `npm run test:api-02:acceptance` result and artifact path:
- `nginx -T` redacted artifact path:
- Plan review result:
- Local edge JSON report path / SHA-256:
- Exact-ceiling failures:
- Plus-one failures:

## Representative authenticated scenario

| Stage | Duration | Concurrency | Request mix | Throughput | p50 | p95 | p99 | 4xx expected/unexpected | 5xx | Timeouts |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| | | | | | | | | | |

- Approved load client (name/version only):
- Every exact row boundary succeeded:
- Every row-boundary-plus-one returned 400:
- Aggregate table counts unchanged for rejected requests:
- Post-run login/business smoke result:

## Process and memory evidence

| Moment | MainPID | InvocationID | NRestarts | Active/SubState | MemoryCurrent | MemoryPeak/source | Host available RAM | PostgreSQL RSS | Nginx RSS |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Before | | | | | | | | | |
| Peak | | | | | | | | | |
| After | | | | | | | | | |

- OOM/reclaim evidence and artifact path:
- Unexpected restart, 5xx, timeout, or latency event:
- Approved latency/service objective and source:

## Reviewed memory decision

- Repeatable accepted peak and source:
- Approved headroom and rationale:
- Candidate `MemoryHigh` (show arithmetic):
- Candidate `MemoryMax` (show arithmetic):
- Reserved RAM for PostgreSQL/Nginx/kernel/maintenance (show arithmetic):
- `systemd-analyze verify` result:
- Re-test result with candidate limits:
- Rollback owner/window/command record:

## Sign-off

- Application owner:
- Operations owner:
- Database owner:
- Security/reviewer:
- Open risks or rejected evidence retained at:
