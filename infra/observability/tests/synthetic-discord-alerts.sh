#!/bin/sh
set -eu

compose='docker compose -f infra/observability/tests/fixtures/compose.yml'
alerts=$(awk '/^[[:space:]]+- alert:/{print $3}' infra/observability/prometheus/rules/alerts.yml)
alert_count=$(printf '%s\n' "$alerts" | awk 'NF { count++ } END { print count + 0 }')

cleanup() {
	$compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
$compose up -d --wait
for container in $($compose ps -q); do
	docker inspect "$container" | jq -e '.[0].HostConfig.Memory > 0 and .[0].HostConfig.NanoCpus > 0 and .[0].HostConfig.PidsLimit > 0' >/dev/null
done
curl -fsS -X DELETE http://127.0.0.1:18080/events >/dev/null

payload() {
	ends_at=$1
	jq -n --arg names "$alerts" --arg endsAt "$ends_at" '
    $names | split("\n") | map(select(length > 0)) | map({
      labels: {
        alertname: ., severity: "warning", service: "brawltome", signal: (ascii_downcase),
        failure_category: "synthetic_failure",
        request_id: "must-not-reach-discord", trace_id: "must-not-reach-discord"
      },
      annotations: { summary: (. + " synthetic evidence") },
      startsAt: "2025-01-01T00:00:00Z",
      endsAt: $endsAt,
      generatorURL: "http://prometheus.internal/graph"
    })'
}

wait_for_events() {
	minimum=$1
	maximum_attempts=$2
	attempts=0
	until [ "$(curl -fsS http://127.0.0.1:18080/events | jq 'length')" -ge "$minimum" ]; do
		attempts=$((attempts + 1))
		[ "$attempts" -lt "$maximum_attempts" ] || return 1
		sleep 1
	done
}

payload '2099-01-01T00:00:00Z' | curl -fsS -H 'content-type: application/json' --data-binary @- http://127.0.0.1:19093/api/v2/alerts >/dev/null
wait_for_events "$alert_count" 60
firing=$(curl -fsS http://127.0.0.1:18080/events)
printf '%s' "$firing" | grep -q 'FIRING'
printf '%s' "$firing" | grep -q 'Category: synthetic_failure'
for alert in $alerts; do
	printf '%s' "$firing" | grep -q "$alert"
done
if printf '%s' "$firing" | grep -Eq 'must-not-reach-discord|request_id|trace_id'; then
	printf '%s\n' 'high-cardinality labels escaped into Discord payload' >&2
	exit 1
fi

curl -fsS -X DELETE http://127.0.0.1:18080/events >/dev/null
payload '2025-01-01T00:00:01Z' | curl -fsS -H 'content-type: application/json' --data-binary @- http://127.0.0.1:19093/api/v2/alerts >/dev/null
wait_for_events "$alert_count" 330
resolved=$(curl -fsS http://127.0.0.1:18080/events)
printf '%s' "$resolved" | grep -q 'RESOLVED'
for alert in $alerts; do
	printf '%s' "$resolved" | grep -q "$alert"
done

printf '%s\n' 'Synthetic Discord-compatible firing and recovery evidence passed for every alert.'
