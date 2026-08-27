# API-02 deployment notes

The application now rejects oversized core bulk arrays with HTTP 400 before it
loads settings or opens a database transaction. It reads the core JSON bodies
through a byte-limited stream and returns HTTP 413 when the byte ceiling is
crossed. Login fields and common search filters also have explicit ceilings.

## Application limits

| Route | Maximum rows | Maximum JSON body |
| --- | ---: | ---: |
| `POST /api/batches` | 100 | 256 KiB |
| `POST /api/events` | 100 | 256 KiB |
| `POST /api/customer-finance` | 100 | 128 KiB |
| `POST /api/customer-orders` | 100 | 128 KiB |
| `PATCH /api/history` | 100 event IDs | 64 KiB |
| `PUT /api/lead/collaborations` | 500 receptionist IDs | 128 KiB |
| `POST /api/notifications` | 500 user IDs | 128 KiB |
| `POST /api/leads` | 2,000 customers | 2 MiB |
| `POST /api/auth/login` | n/a | 8 KiB |
| `POST /api/auth/change-password` | n/a | 8 KiB |

The 2,000-customer limit applies both to structured `rows` and to the legacy
paste-text `phones` input, so changing clients cannot bypass it. Identifiers are
capped at 128 characters, ordinary search values at 200 characters, login
usernames at 200 characters, and login passwords at 256 characters. Existing
business notes remain capped by their schemas (normally 300 or 500 characters).
The same password ceiling is checked before password hashing for sign-in,
self-service password changes, member creation/reset, and SEC-01 high-risk
reauthentication.

The byte limits are also enforced by the application while streaming, including
requests without a trustworthy `Content-Length`. Nginx is an outer guard, not
the only guard. A body over the byte limit returns 413; a valid-size body whose
array or string is over its field limit returns 400. Both happen before settings
lookups or business write transactions.

## Nginx rollout

1. Copy only the matching `client_max_body_size` line from
   `nginx-location-limits.conf.example` into each existing proxy location. Do
   not create sibling locations: they can bypass the shared proxy include and
   silently drop `X-Real-IP`, breaking login throttling, as well as
   `X-Forwarded-*`, `Host`, or request-ID headers.
2. Inspect the rendered configuration with `nginx -T`. For every limited route,
   confirm the winning location contains both the expected body limit and the
   production proxy include/header directives. In particular, verify login
   still sets or inherits `X-Real-IP` and `X-Forwarded-For`. Also confirm no
   broader regex location wins over an intended exact route.
3. Run `nginx -t`, then reload rather than restart.
4. Verify a boundary request and an oversized request for every route. Nginx
   normally serves its own 413 response, while direct application tests serve a
   JSON 413 response.
5. Watch 4xx rates. If a documented normal workflow is rejected, measure its
   encoded size and change the narrow route exception with a reviewed commit.

## systemd memory rollout

The included drop-in intentionally contains placeholders. Do not guess a
production value. In a production-like environment, replay representative
normal batches plus the allowed boundary concurrently, and record peak RSS,
event-loop latency, response latency, and whether the process restarts. Reserve
RAM for PostgreSQL, Nginx and the operating system. Set `MemoryHigh` above the
measured peak with agreed headroom and `MemoryMax` above that soft ceiling.

Validate with `systemd-analyze verify`, deploy the drop-in, run
`systemctl daemon-reload`, restart in the approved window, and confirm
`systemctl show data-statistics -p MemoryHigh -p MemoryMax -p MemoryCurrent`.
Rollback by removing only this drop-in and reloading systemd. Record the load
profile and measured values in the change ticket so the limits are reproducible.

Use [`LOAD-ACCEPTANCE.md`](./LOAD-ACCEPTANCE.md) for the credential-free,
localhost-only edge harness, code-level pre-database checks, authenticated
manual boundary, RSS/restart/latency evidence, and reviewed memory-sizing
procedure. Record the result with
[`load-acceptance-evidence.template.md`](./load-acceptance-evidence.template.md);
the template intentionally contains no proposed memory values.
