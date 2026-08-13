#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"

export OBSERVABILITY_DATA_ROOT=${OBSERVABILITY_DATA_ROOT:-/srv/brawltome-observability}
export OBSERVABILITY_METRICS_QUOTA_BYTES=${OBSERVABILITY_METRICS_QUOTA_BYTES:-1000000000}
export OBSERVABILITY_LOGS_QUOTA_BYTES=${OBSERVABILITY_LOGS_QUOTA_BYTES:-1000000000}
export OBSERVABILITY_TRACES_QUOTA_BYTES=${OBSERVABILITY_TRACES_QUOTA_BYTES:-1000000000}
export PROMETHEUS_RETENTION_SIZE=${PROMETHEUS_RETENTION_SIZE:-800MB}
export BRAWLTOME_NETWORK_NAME=${BRAWLTOME_NETWORK_NAME:-brawltome-internal}
export DISCORD_WEBHOOK_URL_FILE=${DISCORD_WEBHOOK_URL_FILE:-/dev/null}
export GRAFANA_ADMIN_PASSWORD_FILE=${GRAFANA_ADMIN_PASSWORD_FILE:-/dev/null}
export METRICS_SCRAPE_SECRET_FILE=${METRICS_SCRAPE_SECRET_FILE:-/dev/null}
export OTEL_INGEST_TOKEN_FILE=${OTEL_INGEST_TOKEN_FILE:-/dev/null}

docker compose -f deploy/observability/compose.yml config --quiet

docker run --rm --entrypoint /bin/promtool \
	-v "$root/deploy/observability/prometheus:/etc/prometheus:ro" \
	prom/prometheus:v3.5.0@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996 check config /etc/prometheus/prometheus.yml
docker run --rm --entrypoint /bin/promtool -w /etc/prometheus/tests \
	-v "$root/deploy/observability/prometheus:/etc/prometheus:ro" \
	prom/prometheus:v3.5.0@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996 test rules alerts.test.yml
docker run --rm --entrypoint /bin/amtool \
	-v "$root/deploy/observability/alertmanager:/etc/alertmanager:ro" \
	prom/alertmanager:v0.28.1@sha256:27c475db5fb156cab31d5c18a4251ac7ed567746a2483ff264516437a39b15ba check-config /etc/alertmanager/alertmanager.yml
docker run --rm \
	-v "$root/deploy/observability/loki/loki.yml:/etc/loki/loki.yml:ro" \
	grafana/loki:3.5.3@sha256:3165cecce301ce5b9b6e3530284b080934a05cd5cafac3d3d82edcb887b45ecd -config.file=/etc/loki/loki.yml -verify-config=true
docker run --rm \
	-v "$root/deploy/observability/tempo/tempo.yml:/etc/tempo/tempo.yml:ro" \
	grafana/tempo:2.8.2@sha256:0ef775495967cd5d7a6b2e146b6ea695d624803c8db8349fb8ce4164f719f9b7 -config.file=/etc/tempo/tempo.yml -config.verify=true
docker run --rm \
	-v "$root/deploy/observability/otel-collector/config.yml:/etc/otelcol/config.yml:ro" \
	-v "$root/deploy/observability/tests/fixtures/otel-ingest-token:/run/secrets/otel_ingest_token:ro" \
	otel/opentelemetry-collector-contrib:0.158.0@sha256:c5918f78992ee73b0d6f0e599423ac5ec52dd5d9726733114d6eca53d5a32ed5 validate --config=/etc/otelcol/config.yml

for dashboard in deploy/observability/grafana/dashboards/*.json; do
	jq -e '.uid and .title and (.panels | length > 0)' "$dashboard" >/dev/null
done

if grep -RniE 'discord(app)?\.com/api/webhooks|Bearer [A-Za-z0-9_-]{16,}' deploy/observability \
	--exclude='validate.sh'; then
	printf '%s\n' 'observability artifacts contain a credential-shaped literal' >&2
	exit 1
fi

printf '%s\n' 'Observability configuration and synthetic rule validation passed.'
