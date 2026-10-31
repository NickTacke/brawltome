#!/bin/sh
set -eu

# End-to-end evidence for Alertmanager -> alert-relay -> Discord: one critical alert pages once (through a Discord
# 429), every rule shows on the status board as a warning without a message of its own, high-cardinality labels never
# reach Discord, and recovery edits the page in place.
compose='docker compose -f infra/observability/tests/fixtures/compose.yml'
discord=http://127.0.0.1:18080
alertmanager=http://127.0.0.1:19093
# Severity tiers share an alert name, so each name is exercised once.
alerts=$(awk '/^[[:space:]]+- alert:/{print $3}' infra/observability/prometheus/rules/alerts.yml | sort -u)

cleanup() {
	$compose down -v --remove-orphans >/dev/null 2>&1 || true
}
fail() {
	printf '%s\n' "synthetic Discord alerts: $*" >&2
	$compose logs alert-relay >&2 || true
	curl -fsS "$discord/events" >&2 || true
	exit 1
}
trap cleanup EXIT INT TERM

cleanup
$compose up -d --wait
for container in $($compose ps -q); do
	docker inspect "$container" | jq -e '.[0].HostConfig.Memory > 0 and .[0].HostConfig.NanoCpus > 0 and .[0].HostConfig.PidsLimit > 0' >/dev/null
done

payload() {
	ends_at=$1
	jq -n --arg names "$alerts" --arg endsAt "$ends_at" '
    ($names | split("\n") | map(select(length > 0)) | map({
      labels: {
        alertname: ., severity: (if . == "Watchdog" then "none" else "warning" end), service: "brawltome",
        signal: (ascii_downcase), request_id: "must-not-reach-discord", trace_id: "must-not-reach-discord"
      },
      annotations: { summary: (. + " synthetic evidence") }
    })) + [{
      labels: {
        alertname: "SyntheticCritical", severity: "critical", service: "brawltome", signal: "synthetic",
        runtime: "api", request_id: "must-not-reach-discord"
      },
      annotations: {
        summary: "synthetic critical evidence",
        description: "Exercises the paging path end to end.",
        runbook_url: "https://github.com/NickTacke/brawltome/blob/master/docs/operations/alerts.md#synthetic"
      }
    }] | map(. + {
      startsAt: "2025-01-01T00:00:00Z",
      endsAt: $endsAt,
      generatorURL: "http://prometheus.internal:9090/graph?g0.expr=up+%3D%3D+0&g0.tab=1"
    })'
}

messages() {
	curl -fsS "$discord/messages"
}

wait_for() {
	description=$1
	filter=$2
	attempts=$3
	until messages | jq -e "$filter" >/dev/null; do
		attempts=$((attempts - 1))
		[ "$attempts" -gt 0 ] || fail "timed out waiting for $description"
		sleep 1
	done
}

page='to_entries | map(select(.value.content // "" | contains("SyntheticCritical")))'
board='to_entries | map(select(.value.embeds[0].title? == "BrawlTome status"))'

wait_for 'the initial status board' "$board | length == 1" 30
curl -fsS -X DELETE "$discord/events" >/dev/null
curl -fsS -X POST "$discord/rate-limit-next?count=1" >/dev/null

payload '2099-01-01T00:00:00Z' | curl -fsS -H 'content-type: application/json' --data-binary @- "$alertmanager/api/v2/alerts" >/dev/null
wait_for 'the critical page' "$page | length == 1" 90
for alert in $alerts; do
	[ "$alert" = Watchdog ] && continue
	wait_for "$alert on the status board" "$board | .[0].value.embeds[0].description | contains(\"**$alert**\")" 30
done
wait_for 'the heartbeat on the board' "$board | .[0].value.embeds[0].description | contains(\"heartbeat OK\")" 30

messages | jq -e "$page | .[0].value |
  (.content | startswith(\"<@&111111111111111111> 🔴 **SyntheticCritical**: synthetic critical evidence\")) and
  .allowed_mentions == {parse: [], roles: [\"111111111111111111\"]} and
  (.embeds[0].title == \"🔴 SyntheticCritical: synthetic critical evidence\") and
  (.embeds[0].url | startswith(\"https://observability.brawltome.app/explore?\")) and
  (.embeds[0].fields | map(.name) | index(\"runtime\") != null)" >/dev/null || fail 'page content is wrong'
[ "$(messages | jq 'length')" -eq 2 ] || fail 'warnings must not post messages of their own'
curl -fsS "$discord/events" | jq -e 'any(.[]; .status == 429)' >/dev/null || fail 'the 429 was never exercised'
if curl -fsS "$discord/events" | grep -Eq 'must-not-reach-discord|request_id|trace_id'; then
	fail 'high-cardinality labels escaped into the Discord payload'
fi

page_id=$(messages | jq -r "$page | .[0].key")
payload '2025-01-01T00:00:01Z' | curl -fsS -H 'content-type: application/json' --data-binary @- "$alertmanager/api/v2/alerts" >/dev/null
wait_for 'the page to be edited to resolved' \
	".[\"$page_id\"].content | startswith(\"✅ **SyntheticCritical** resolved after\")" 60
wait_for 'the board to clear' "$board | .[0].value.embeds[0].description | contains(\"All clear\")" 30
messages | jq -e ".[\"$page_id\"].allowed_mentions == {parse: []}" >/dev/null || fail 'the resolved edit must not ping'
[ "$(messages | jq 'length')" -eq 2 ] || fail 'recovery must edit messages, not post new ones'

printf '%s\n' 'Synthetic alerting evidence passed: one page through a 429, board for every alert, recovery edited in place.'
