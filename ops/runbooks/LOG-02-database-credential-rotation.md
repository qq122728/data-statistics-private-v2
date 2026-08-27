# LOG-02 database credential rotation

Use this after any suspected credential exposure, including credentials accidentally
written to systemd journals. Never paste a connection string, password, environment
file, or journal excerpt into a ticket, terminal transcript, or review.

1. Record an incident reference, owner, and maintenance window. Do not record secrets.
2. Create a new random runtime database password using the approved secret manager.
3. In an interactive protected administrator session, run:

   ```text
   \password data_statistics_runtime
   ```

   Do not put the password in SQL text or shell arguments. This immediately invalidates
   the old password, so expect a short maintenance outage until the restart finishes.
4. Update `/etc/data-statistics/app.env` atomically; retain mode `0600` and the runtime owner.
5. Restart only `data-statistics.service`, then test login and a normal read/write flow.
6. From a protected test client, confirm the old password can no longer connect.
7. Invalidate or securely remove any journal/archive copy that policy permits removing;
   otherwise restrict access and let the documented retention period expire it.
8. Record timestamps, people, verification results, and the secret-manager item ID only.

Rollback means restoring service with another newly generated secret. Never restore the
credential that may have appeared in a log. This procedure rotates only the DB-01 runtime
role; the separate migration role must use its own secret and rotation window.
