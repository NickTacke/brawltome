# BrawlTome observability deployment boundary

This directory prepares the repository-owned portion of GitHub #219. It provisions dedicated OSS services only: Grafana, Prometheus, Alertmanager, Loki, Tempo, an OpenTelemetry Collector, a blackbox exporter, and a filesystem-only node exporter. It does not deploy production, persist credentials, or prove elapsed retention on the AX42.

## Repository evidence

Run from the repository root:

```sh
bun run observability:validate
bun run observability:test-alerts
bun run observability:test-pipeline
```

The first command renders Compose, validates Prometheus rules and firing/recovery cases, checks Alertmanager, Loki, Tempo, Collector, and dashboard configuration. The second sends every named alert through the production Alertmanager routing and proves both firing and resolved payloads reach a local Discord-compatible receiver without high-cardinality labels. The third sends synthetic OTLP data through the bounded Collector and proves logs and sampled traces are queryable from Loki and Tempo.

## Owner-only Dokploy prerequisites

Do not start the stack until all items below are complete:

1. Create a dedicated internal application network and set `BRAWLTOME_NETWORK_NAME`. Application services must have the aliases `api`, `operations-worker`, `web`, and `discord-bot` on that network. Set `DOKPLOY_NETWORK_NAME` to Dokploy's external ingress network (normally `dokploy-network`); only Grafana joins it.
2. Provision three distinct quota-backed filesystem mountpoints at `$OBSERVABILITY_DATA_ROOT/prometheus`, `loki`, and `tempo`. Choose quota bytes from measured AX42 capacity evidence. Grafana and Alertmanager use bounded tmpfs because all repository-owned configuration is provisioned; restarts intentionally discard UI sessions, silences, and notification history.
3. Set the three `OBSERVABILITY_*_QUOTA_BYTES` values to the enforced filesystem capacities. Set `PROMETHEUS_RETENTION_SIZE` no higher than 80 percent of the metrics quota. Run `deploy/observability/storage/verify-quota-mounts.sh` on the host.
4. Supply owner-managed files for `DISCORD_WEBHOOK_URL_FILE`, `GRAFANA_ADMIN_PASSWORD_FILE`, `METRICS_SCRAPE_SECRET_FILE`, and `OTEL_INGEST_TOKEN_FILE`. Inject the scrape value as `METRICS_SCRAPE_SECRET` into all four application runtimes. Keep it distinct from `INTERNAL_API_SECRET`.
5. Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318` and `OTEL_EXPORTER_OTLP_AUTHORIZATION=Bearer <OTEL_INGEST_TOKEN_FILE contents>` on API, operations worker, web, and Discord services. Do not put these values in Git or Dokploy build arguments. Keep existing bounded telemetry defaults unless production evidence supports tuning.
6. Route only Grafana through Dokploy TLS. Keep Prometheus, Alertmanager, Loki, Tempo, Collector, and exporters private.

## Fixed repository policy

- Prometheus retention: 30 days plus owner-sized byte retention.
- Loki retention: 14 days (`336h`) with compactor deletion enabled.
- Sampled Tempo retention: 7 days (`168h`).
- Loki indexes only `service.name`. Request, trace, span, job, operation, user, and guild identifiers remain fields, not labels.
- Discord messages contain only alert name, severity, signal, and bounded summaries. The webhook is read from a secret file.
- Every service has CPU, memory, PID, capability, and privilege limits.

## Residual live gate

Keep #219 open after the repository commit. The owner must still verify Dokploy secret-file and network behavior, enforce quotas on the AX42, deploy the stack, run a real Discord firing/resolved smoke, verify logs/metrics/traces/dashboards, observe 30d/14d/7d retention within quotas, calibrate initial alert thresholds, and approve colocated capacity. Local synthetic evidence is not external Discord or production deployment evidence.
