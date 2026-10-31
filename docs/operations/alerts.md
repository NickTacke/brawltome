# Alerts

How BrawlTome alerting works, and what to do when each alert fires. Every alert rule links to its section here
through its `runbook_url` annotation.

## How alerting works

```
Prometheus rules ──▶ Alertmanager ──webhook──▶ alert-relay ──▶ Discord webhook
                          ▲                        │
                          └──── GET /api/v2/alerts ┘   (every minute, source of truth)
```

- **Rules** live in `infra/observability/prometheus/rules/alerts.yml`, with unit tests in
  `infra/observability/prometheus/tests/alerts.test.yml`.
- **Alertmanager** (`infra/observability/alertmanager/alertmanager.yml`) groups alerts per incident (alert name plus
  runtime, kind, work class and mountpoint) and sends every notification to the relay. It re-notifies only every 12
  hours, because the status board already shows what is still firing.
- **alert-relay** (`infra/observability/alert-relay/`) is a small Bun service that owns all Discord output.

### Severity contract

| Severity   | Meaning                                    | What Discord does                                   |
| ---------- | ------------------------------------------ | --------------------------------------------------- |
| `critical` | Users are affected or data is at risk now. | Posts a page that mentions `DISCORD_PAGE_MENTION`.  |
| `warning`  | Something needs a look, but not tonight.   | Shows on the status board only. Never pings.        |
| `none`     | Internal heartbeat (`Watchdog`).           | Shows as the heartbeat line on the board.           |

A new rule should be `critical` only if you would want to be woken up for it. If it is not worth that, make it a
`warning` and look at the board when convenient.

### The page

A critical alert posts one message. The text names the alert and what broke, so the phone notification is useful on
its own, for example `@everyone 🔴 HttpErrorRateHigh: api HTTP 5xx rate exceeds one percent`. The embed adds the
description, when it started, the labels that identify the broken part (runtime, kind, work class, mountpoint), a link
to the alert expression in Grafana Explore, and a link to its section in this document.

When the alert resolves, the relay **edits that same message** to a green `✅ … resolved after 12m`. Editing does not
notify anyone. If the relay no longer knows the message id (its state was lost), it posts a short resolved note
with notifications suppressed instead.

### The status board

A single message in the alerts channel, edited in place. It lists critical and warning alerts with their summary and
how long they have been firing, or `✅ All clear since …`. It also shows whether the Prometheus `Watchdog` heartbeat
is arriving. The relay redraws it whenever anything changes and at least every five minutes, so its `Updated …` stamp
also tells you the relay itself is alive: if it says "2 hours ago", the relay is down.

Pin the board message in the channel so it is easy to find.

### Reliability

- The relay reads Alertmanager's API every minute as the source of truth. A critical alert that has been active for
  three minutes without a page gets paged, and a page whose alert has been gone for three minutes gets resolved. Lost
  webhooks and relay restarts therefore heal on their own.
- Discord rate limits (429) are retried after the delay Discord asks for. Server errors and network failures are retried
  with backoff. If a page still fails, the relay answers Alertmanager with a 503 so it retries, logs the failure, and
  tries again on the next poll. A page is never dropped silently.
- Message ids for the board and open pages are stored in `${OBSERVABILITY_DATA_ROOT}/alert-relay/state.json`
  (`/srv/brawltome-observability/alert-relay` in production). The file is a few kilobytes, so it does not need a quota
  filesystem. If the directory is not writable, the relay keeps working from memory and logs an error; the only cost is
  a new board message after the next restart.

### Configuration

Set on the observability compose in Dokploy (Environment tab):

| Variable               | Default       | Meaning                                                                                 |
| ---------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `DISCORD_PAGE_MENTION` | `@everyone`   | Who a critical page pings: `<@USER_ID>`, `<@&ROLE_ID>`, `@here`, `@everyone`, or `none`. |

The webhook URL is the existing `discord_webhook_url` secret
(`/var/lib/brawltome-observability-secrets/discord-webhook-url`), now mounted into the relay instead of Alertmanager.

One-time host setup for the state directory (the relay runs as UID 65534):

```sh
install -d -o 65534 -g 65534 -m 0750 /srv/brawltome-observability/alert-relay
```

### Silencing

Silences are managed in Alertmanager. It has no public route, so use `amtool` from inside its container on the
Dokploy host:

```sh
ssh dokploy
am=$(docker ps -q --filter name=brawltome-observability-bc1eng-alertmanager)
# Silence one alert for two hours
docker exec "$am" amtool --alertmanager.url=http://localhost:9093 silence add \
  alertname=HttpErrorRateHigh --duration=2h --comment="deploying fix" --author="$USER"
# List and expire silences
docker exec "$am" amtool --alertmanager.url=http://localhost:9093 silence query
docker exec "$am" amtool --alertmanager.url=http://localhost:9093 silence expire <silence-id>
```

Silenced alerts do not page and are hidden from the board. Alertmanager keeps silences on a tmpfs, so they do not
survive an Alertmanager restart.

### Testing

- `bun run infra:observability:check` runs everything below (needs Docker).
- Rule behaviour: `promtool test rules` over `alerts.test.yml` (run by `infra/observability/validate.sh`).
- Relay logic: `bun test infra/observability/tests/alert-relay.test.ts` (mapping, board, edit-versus-post, 429s).
- End to end: `sh infra/observability/tests/synthetic-discord-alerts.sh` starts the real Alertmanager config, the relay
  and a fake Discord API, fires a critical and every rule as a warning, and checks that exactly one page is posted, the
  board lists every warning, a 429 is retried, and the page is edited to resolved.
- In production, to see a page end to end, post a short-lived critical test alert to Alertmanager:

  ```sh
  ssh dokploy
  am=$(docker ps -q --filter name=brawltome-observability-bc1eng-alertmanager)
  docker exec "$am" amtool --alertmanager.url=http://localhost:9093 alert add \
    alertname=AlertingTest severity=critical summary="test page, ignore" --end="$(date -u -d '+5 min' +%FT%TZ)"
  ```

  It pages after about 30 seconds and is edited to resolved a few minutes after it ends.

### Useful commands

```sh
ssh dokploy
# Relay logs (JSON lines; the webhook URL is never logged)
docker logs --since 1h brawltome-observability-bc1eng-alert-relay-1
# What Alertmanager currently has firing
docker exec "$(docker ps -q --filter name=brawltome-observability-bc1eng-alertmanager)" \
  amtool --alertmanager.url=http://localhost:9093 alert query
# Application containers
docker ps --filter name=compose-program-virtual-microchip-uqxbrw
```

Application containers are named `compose-program-virtual-microchip-uqxbrw-<service>-<n>`, so
`docker logs --since 30m compose-program-virtual-microchip-uqxbrw-operations-worker-1` shows worker logs. Grafana at
<https://observability.brawltome.app> has the Operations, HTTP health, Product health and Telemetry storage dashboards
and Loki logs for every runtime.

## Alerts

### Watchdog

**Severity:** none. Always firing on purpose.

**Meaning:** Prometheus is evaluating rules and delivering them to Alertmanager. The status board shows
`📡 Prometheus → Alertmanager heartbeat OK` while it arrives.

**If the board says the heartbeat is missing:** Prometheus is down, failing to evaluate rules, or cannot reach
Alertmanager, so no other alert can fire either.

```sh
ssh dokploy
docker ps --filter name=brawltome-observability-bc1eng
docker logs --since 30m brawltome-observability-bc1eng-prometheus-1 | tail -50
```

### RuntimeMetricsTargetDown

**Severity:** critical.

**Meaning:** Prometheus has failed to scrape `/metrics` on a runtime (`api`, `operations-worker`, `web`) for two
minutes. Usually the runtime itself is down or restarting.

**Likely causes:** container crashed or is crash-looping; a deploy left it unhealthy; the metrics scrape secret differs
between the app and Prometheus; the application network is broken.

**First steps:**

```sh
ssh dokploy
docker ps -a --filter name=compose-program-virtual-microchip-uqxbrw   # restarting? exited?
docker logs --since 15m compose-program-virtual-microchip-uqxbrw-<runtime>-<n> | tail -100
```

If the container is healthy but the scrape fails, check the target on the Prometheus targets page (Grafana Explore,
`up{job="<runtime>"}`) for the scrape error, for example a 401 from a mismatched scrape secret.

### RuntimeNotReady

**Severity:** critical.

**Meaning:** the dependency-aware readiness probe (`/health/ready`) of `api` or `operations-worker` has failed for two
minutes. The runtime is up but cannot serve, usually because a dependency such as PostgreSQL is unavailable.

**Likely causes:** PostgreSQL down or out of connections; PostgreSQL disk full (see
[PostgresDiskSpaceLow](#postgresdiskspacelow)); a migration holding locks; the runtime stuck draining after a deploy.

**First steps:**

```sh
ssh dokploy
docker logs --since 15m compose-program-virtual-microchip-uqxbrw-<runtime>-<n> | grep -i ready
docker logs --since 15m compose-program-virtual-microchip-uqxbrw-postgres-1 | tail -50
```

### WorkerHeartbeatStale

**Severity:** critical.

**Meaning:** the operations worker has not completed a loop for more than a minute, for two minutes. Refreshes,
leaderboards and schedules stop while this fires.

**Likely causes:** the worker is stuck on a long database call or lock; the worker container is down (then
[RuntimeMetricsTargetDown](#runtimemetricstargetdown) also fires); PostgreSQL is unhealthy.

**First steps:**

```sh
ssh dokploy
docker logs --since 15m compose-program-virtual-microchip-uqxbrw-operations-worker-1 | tail -100
```

In Grafana, the Operations dashboard shows the heartbeat and loop timings. If the worker is wedged,
`docker restart compose-program-virtual-microchip-uqxbrw-operations-worker-1` gets it going again; leases expire and
work resumes.

### OldestRunnableJobDelayed

**Severity:** warning.

**Meaning:** the oldest runnable operation in a work class has waited more than 15 minutes. Work is piling up faster
than the worker drains it.

**Likely causes:** a Brawlhalla outage or rate limiting slowing every call (check
[BrawlhallaSourceUnavailable](#brawlhallasourceunavailable)); a burst of interactive refreshes; the worker running slow
because of database pressure.

**First steps:** open the Operations dashboard and look at pending work by class and the source admission panels. If
the source is fine and the backlog keeps growing, check worker logs for slow operations.

### ScheduleMaterializationLate

**Severity:** warning.

**Meaning:** a recurring schedule has stayed more than five minutes behind for five minutes. The leaderboard deep crawl
is excluded: it runs for hours by design, so it is always "late" while it works.

**Likely causes:** the worker is behind (see [OldestRunnableJobDelayed](#oldestrunnablejobdelayed)); the previous run
of that schedule is still in progress; a Brawlhalla outage.

**First steps:** on the Operations dashboard, check schedule lateness by kind and whether the previous run finished.
Worker logs, filtered by the `kind` label, show what that schedule is doing.

### NewDeadLetters

**Severity:** warning. A dead letter is kept for replay, so no data is lost and nobody is blocked.

**Meaning:** at least one operation of the named kind was dead-lettered in the last 30 minutes after exhausting its
retries. Admission rejections are expected outcomes and are not counted.

**Likely causes:** a bug in that operation kind (consistent failures); a payload Brawlhalla changed shape on; a long
outage that outlasted the retry budget.

**First steps:** list and inspect dead letters with the operator CLI (`bun run operations:dead-letters`, which runs
`packages/contexts/refresh-operations/cli.ts`). It needs `DEAD_LETTER_DATABASE_URL`, `DEAD_LETTER_OPERATOR_TOKENS` and
your `DEAD_LETTER_OPERATOR_TOKEN`; in production it runs as the operator-profile `dead-letter-cli` service of
`infra/app/compose.yml`, which supplies the first two from secrets.

```sh
bun run operations:dead-letters list --limit 20
bun run operations:dead-letters inspect <operation-id>
# After fixing the cause:
bun run operations:dead-letters replay <operation-id> --reason "fixed in #123"
# Or, if the work is no longer wanted:
bun run operations:dead-letters discard <operation-id> --reason "player deleted"
```

### RefreshFailuresElevated

**Severity:** warning.

**Meaning:** more than two refresh attempts of one kind failed with the same category in 15 minutes. Brawlhalla
outages (`source_unavailable`) and local throttling (`admission_deferred`) are not counted here; outages are reported
once by [BrawlhallaSourceUnavailable](#brawlhallasourceunavailable).

**Likely causes by `failure_category`:**

- `source_rate_limited`: Brawlhalla returned 429. Background V0 traffic bursts can trigger it below the documented
  budget; check the source quota panels.
- `source_timeout`: Brawlhalla is slow; usually transient.
- `invalid_payload`: Brawlhalla changed a response shape. Likely a code fix.
- `dependency`, `execution`: our side failed (database, bug). Check worker logs for the `kind`.
- `lease_lost`: an operation outlived its lease, usually because the worker stalled.

**First steps:** worker logs filtered by the `kind`, and the Operations dashboard's failure panels by category.

### BrawlhallaSourceUnavailable

**Severity:** warning. Not our fault and not fixable by us; shown so you know why data is stale.

**Meaning:** refreshes have kept failing with `source_unavailable` across operation kinds for about 15 minutes. The
Brawlhalla API is down or in maintenance. One line covers the whole outage, however many kinds are affected. Deep crawl
deferrals are not counted: the crawl waits out the outage and resumes the same page.

**First steps:** usually none. Confirm it is Brawlhalla, not us, with a direct request from the host:

```sh
ssh dokploy
curl -s -o /dev/null -w '%{http_code}\n' "https://api.brawlhalla.com/rankings/1v1/all/1?api_key=<key>"
```

A 503 confirms maintenance. Refreshes resume on their own when the API is back. If it lasts many hours, consider
posting a notice on the site.

### HttpLatencyHigh

**Severity:** warning.

**Meaning:** the five-minute p95 latency of a runtime's HTTP requests exceeded 250 ms for five minutes.

**Likely causes:** slow database queries (a missing index, a table that grew); the host is CPU-bound; a slow upstream
call on a request path.

**First steps:** HTTP health dashboard for which routes are slow, then traces in Tempo (Grafana Explore) for a slow
request. PostgreSQL `pg_stat_statements` shows the heaviest queries.

### HttpErrorRateHigh

**Severity:** critical.

**Meaning:** more than 1 percent of a runtime's HTTP requests returned 5xx over five minutes, for five minutes. Health
probes are excluded because readiness answers 503 on purpose while a runtime starts or drains.

**Likely causes:** a bad deploy; PostgreSQL unavailable; an unhandled error on a popular route.

**First steps:**

```sh
ssh dokploy
docker logs --since 15m compose-program-virtual-microchip-uqxbrw-<runtime>-<n> | grep -iE 'error|5[0-9]{2}' | tail -50
```

The HTTP health dashboard shows which routes fail. If it started with a deploy, roll back in Dokploy.

### PostgresBackupIntegrityFailed

**Severity:** critical. Data at risk: without a verified backup, a disk or database failure could lose data.

**Meaning:** the backup integrity verifier (systemd timer `brawltome-backup-integrity.timer`, every six hours) reported
a failure, has not run, or has not verified a backup within eight hours. The summary includes the verifier's reason.

**Likely causes by reason:** `stale` (no recent backup was taken: check Dokploy's scheduled PostgreSQL backups);
`missing` (the expected backup or its checksum sidecar is absent); `hash_invalid` or `sidecar_mismatch` (a backup
does not match its recorded checksum); `config` (the verifier's environment or credentials are wrong); `not reported`
(the timer is not running, or node-exporter cannot read its textfile directory).

**First steps:**

```sh
ssh dokploy
systemctl status brawltome-backup-integrity.service brawltome-backup-integrity.timer --no-pager
journalctl -u brawltome-backup-integrity.service --since -12h --no-pager | tail -50
cat /srv/brawltome-observability/backup-integrity/*.prom
# Run the verifier now, after fixing the cause:
systemctl start brawltome-backup-integrity.service
```

The verifier and its installer live in `infra/app/backups/`.

### TelemetryStorageNearQuota

**Severity:** warning.

**Meaning:** a quota-backed telemetry filesystem (`/storage/prometheus`, `/storage/loki` or `/storage/tempo`) is at
least 80 percent full. Only observability data is affected.

**First steps:** the Telemetry storage dashboard shows growth per store. Prometheus retention is capped by
`PROMETHEUS_RETENTION_SIZE`; Loki keeps 30 days and Tempo 7 days. If a store keeps growing, grow its loop image under
`/var/lib/brawltome-observability-filesystems/` (`truncate`, `losetup -c`, `resize2fs`) or lower its retention.

### PostgresDiskSpaceLow

**Severity:** warning below 20 percent free, critical below 10 percent free.

**Meaning:** the PostgreSQL data filesystem (`/srv/brawltome/postgres`, a loop-mounted ext4 image) is running out of
space. The host disk can look fine while this filesystem is full. When it fills up, PostgreSQL stops.

**Likely causes:** ranking snapshot tables growing; snapshot retention not keeping up; WAL piling up behind a stuck
replication slot.

**First steps:**

```sh
ssh dokploy
df -h /srv/brawltome/postgres
docker exec compose-program-virtual-microchip-uqxbrw-postgres-1 psql -U brawltome_owner -d brawltome -c \
  "select relname, pg_size_pretty(pg_total_relation_size(relid)) from pg_statio_user_tables order by pg_total_relation_size(relid) desc limit 10"
```

To grow the image online: `truncate -s +64G /var/lib/brawltome-storage/postgres.ext4`, then `losetup -c` on its loop
device and `resize2fs` on the mount.

### FilesystemSpaceCritical

**Severity:** critical.

**Meaning:** an ext4 filesystem watched by node-exporter (other than PostgreSQL's, which has its own alert) has less
than 10 percent free for ten minutes. For telemetry stores that means Prometheus, Loki or Tempo are about to stop
ingesting.

**First steps:** `df -h` on the mountpoint from the alert, then follow
[TelemetryStorageNearQuota](#telemetrystoragenearquota) to grow the image or reduce retention.
