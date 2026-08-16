#!/usr/bin/env bash
set -euo pipefail

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repository_root"

: "${DOKPLOY_URL:?Set DOKPLOY_URL}"
: "${DOKPLOY_TOKEN:?Set DOKPLOY_TOKEN}"
: "${DOKPLOY_OBSERVABILITY_COMPOSE_ID:?Set DOKPLOY_OBSERVABILITY_COMPOSE_ID}"
: "${DOKPLOY_OBSERVABILITY_REF:?Set DOKPLOY_OBSERVABILITY_REF to the immutable observability tag}"

compose_id=$DOKPLOY_OBSERVABILITY_COMPOSE_ID
source_ref=$DOKPLOY_OBSERVABILITY_REF
api_url=${DOKPLOY_URL%/}/api
expected_command='compose --parallel 1 -p brawltome-observability-bc1eng -f ./infra/observability/compose.yml up -d --build --remove-orphans --force-recreate'

[[ $compose_id =~ ^[A-Za-z0-9_-]+$ ]] || {
  printf '%s\n' 'Dokploy compose ID contains unsupported characters.' >&2
  exit 1
}
[[ $source_ref =~ ^observability-([0-9a-f]{40})$ ]] || {
  printf '%s\n' 'Dokploy source ref must be an immutable observability-<40-character-sha> tag.' >&2
  exit 1
}
expected_commit=${BASH_REMATCH[1]}

api_get() {
  curl --silent --show-error --fail-with-body --config - "$api_url/$1" <<CONFIG
header = "x-api-key: $DOKPLOY_TOKEN"
CONFIG
}

api_post() {
  curl --silent --show-error --fail-with-body --config - --request POST --json "$2" "$api_url/$1" <<CONFIG
header = "x-api-key: $DOKPLOY_TOKEN"
CONFIG
}

json_compose_id() {
  python3 -c 'import json, sys; print(json.dumps({"composeId": sys.argv[1]}, separators=(",", ":")))' "$compose_id"
}

verify_remote_ref() {
  local remote_commit
  remote_commit=$(git ls-remote --refs origin "refs/tags/$source_ref" | awk 'NR == 1 { print $1 } NR > 1 { exit 2 }')
  [[ $remote_commit == "$expected_commit" ]] || {
    printf '%s\n' 'Immutable observability tag does not resolve to its encoded commit.' >&2
    exit 1
  }
}

verify_dokploy_metadata() {
  local compose domains
  compose=$(api_get "compose.one?composeId=$compose_id")
  printf '%s' "$compose" | python3 -c '
import json, sys
compose = json.load(sys.stdin)
expected_command, expected_ref = sys.argv[1:]
if compose.get("command") != expected_command:
    raise SystemExit("serialized Dokploy command drift")
if compose.get("sourceType") != "github":
    raise SystemExit("Dokploy source type drift")
if compose.get("branch") != expected_ref:
    raise SystemExit("immutable Dokploy source ref drift")
' "$expected_command" "$source_ref"

  domains=$(api_get "domain.byComposeId?composeId=$compose_id")
  printf '%s' "$domains" | python3 -c '
import json, sys
domains = json.load(sys.stdin)
expected = {
    "host": "observability.brawltome.app",
    "path": "/",
    "port": 3000,
    "https": True,
    "certificateType": "letsencrypt",
    "serviceName": "grafana",
    "domainType": "compose",
    "internalPath": "/",
    "stripPath": False,
    "forwardAuthEnabled": False,
}
if len(domains) != 1 or any(domains[0].get(key) != value for key, value in expected.items()):
    raise SystemExit("approved Grafana domain drift")
'
}

verify_remote_ref
api_post compose.fetchSourceType "$(json_compose_id)" >/dev/null
verify_dokploy_metadata

converted=$(api_get "compose.getConvertedCompose?composeId=$compose_id")
converted_yaml=$(printf '%s' "$converted" | python3 -c '
import json, sys
value = json.load(sys.stdin)
if not isinstance(value, str):
    raise SystemExit("converted Compose response must be a string")
print(value)
')

rendered=$(
  printf '%s' "$converted_yaml" |
    env \
      BRAWLTOME_NETWORK_NAME=brawltome \
      DISCORD_WEBHOOK_URL_FILE=/var/lib/brawltome-observability-secrets/discord-webhook-url \
      GRAFANA_ADMIN_PASSWORD_FILE=/var/lib/brawltome-observability-secrets/grafana-admin-password \
      METRICS_SCRAPE_SECRET_FILE=/var/lib/brawltome-observability-secrets/metrics-scrape-secret \
      OBSERVABILITY_DATA_ROOT=/srv/brawltome-observability \
      OBSERVABILITY_LOGS_QUOTA_BYTES=25769803776 \
      OBSERVABILITY_METRICS_QUOTA_BYTES=12884901888 \
      OBSERVABILITY_TRACES_QUOTA_BYTES=12884901888 \
      OTEL_INGEST_TOKEN_FILE=/var/lib/brawltome-observability-secrets/otel-ingest-token \
      PROMETHEUS_RETENTION_SIZE=9GB \
      docker compose --file - config --format json
)
printf '%s' "$rendered" | BRAWLTOME_NETWORK_NAME=brawltome bun infra/observability/verify-rendered-topology.ts

verify_remote_ref
verify_dokploy_metadata
api_post compose.deploy "$(json_compose_id)" >/dev/null
printf '%s\n' 'Dokploy observability deployment requested from an immutable verified source.'
