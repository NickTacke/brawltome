#!/bin/sh
set -eu

compose='docker compose -f deploy/observability/tests/pipeline-compose.yml'
marker="brawltome-synthetic-pipeline-$$"
export GRAFANA_SYNTHETIC_PASSWORD="local-pipeline-$$"

cleanup() {
	$compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
$compose up -d
for container in $($compose ps -q); do
	docker inspect "$container" | jq -e '.[0].HostConfig.Memory > 0 and .[0].HostConfig.NanoCpus > 0 and .[0].HostConfig.PidsLimit > 0' >/dev/null
done

wait_http() {
	url=$1
	attempts=0
	until curl -fsS "$url" >/dev/null 2>&1; do
		attempts=$((attempts + 1))
		[ "$attempts" -lt 60 ] || return 1
		sleep 1
	done
}

wait_grafana_dashboard() {
	uid=$1
	attempts=0
	until curl -fsS -u "admin:$GRAFANA_SYNTHETIC_PASSWORD" \
		'http://127.0.0.1:13000/api/search?type=dash-db' | grep -q "\"uid\":\"$uid\""; do
		attempts=$((attempts + 1))
		[ "$attempts" -lt 60 ] || return 1
		sleep 1
	done
}

wait_http http://127.0.0.1:13100/ready
wait_http http://127.0.0.1:13200/ready
wait_http http://127.0.0.1:13000/api/health
for uid in brawltome-operations brawltome-http-health brawltome-telemetry-storage; do
	wait_grafana_dashboard "$uid"
done
sleep 2

unauthorized_status=$(curl -sS -o /dev/null -w '%{http_code}' -H 'content-type: application/json' --data '{}' http://127.0.0.1:14318/v1/logs)
[ "$unauthorized_status" = 401 ]

trace_id=$(SYNTHETIC_MARKER="$marker" bun -e '
  import { createNodeRuntimeTelemetry } from "./packages/telemetry/src/node.ts"
  const telemetry = createNodeRuntimeTelemetry({
    service: "synthetic-runtime",
    endpoint: "http://127.0.0.1:14318",
    authorization: "Bearer local-otel",
    drainIntervalMs: 0,
    exportTimeoutMs: 1000,
    sampleRate: 1,
  })
  const context = telemetry.childContext()
  const marker = process.env.SYNTHETIC_MARKER
  if (!marker) throw new Error("synthetic marker is required")
  telemetry.logger.info(marker)
  await telemetry.run(context, () => telemetry.trace("synthetic.runtime", {}, async () => undefined))
  await telemetry.shutdown(2000)
  console.log(context.traceId)
' | tail -n 1)

attempts=0
until curl -fsS --get --data-urlencode 'query={service_name="synthetic-runtime"}' \
	http://127.0.0.1:13100/loki/api/v1/query_range | grep -q "$marker"; do
	attempts=$((attempts + 1))
	[ "$attempts" -lt 60 ] || exit 1
	sleep 1
done

attempts=0
until curl -fsS "http://127.0.0.1:13200/api/traces/$trace_id" | grep -q 'synthetic.runtime'; do
	attempts=$((attempts + 1))
	[ "$attempts" -lt 60 ] || exit 1
	sleep 1
done

printf '%s\n' 'Synthetic OTLP log and sampled trace reached Loki and Tempo; Grafana provisioned every dashboard.'
