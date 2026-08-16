#!/usr/bin/env bash
set -euo pipefail

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repository_root"

: "${DOKPLOY_URL:?Set DOKPLOY_URL}"
: "${DOKPLOY_TOKEN:?Set DOKPLOY_TOKEN}"
: "${DOKPLOY_V3_COMPOSE_ID:?Set DOKPLOY_V3_COMPOSE_ID}"
: "${DOKPLOY_V3_PROJECT_NAME:?Set DOKPLOY_V3_PROJECT_NAME}"
: "${V3_DISCORD_CLIENT_ID:?Set V3_DISCORD_CLIENT_ID to the Discord OAuth client ID}"
: "${V3_TURNSTILE_SITE_KEY:?Set V3_TURNSTILE_SITE_KEY to the public Turnstile site key}"

compose_id=$DOKPLOY_V3_COMPOSE_ID
project_name=$DOKPLOY_V3_PROJECT_NAME
source_branch=master
api_url=${DOKPLOY_URL%/}/api
expected_command="compose --parallel 1 -p $project_name -f ./deploy/v3/compose.yml up -d --build --remove-orphans"

for identifier in "$compose_id" "$project_name"; do
  [[ $identifier =~ ^[A-Za-z0-9_-]+$ ]] || {
    printf '%s\n' 'Dokploy identifier contains unsupported characters.' >&2
    exit 1
  }
done
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

verify_dokploy_metadata() {
  local compose domains
  compose=$(api_get "compose.one?composeId=$compose_id")
  printf '%s' "$compose" | python3 -c '
import json, sys
compose = json.load(sys.stdin)
expected_command, expected_branch = sys.argv[1:]
if compose.get("command") != expected_command:
    raise SystemExit("serialized Dokploy command drift")
if compose.get("sourceType") != "github":
    raise SystemExit("Dokploy source type drift")
if compose.get("branch") != expected_branch or compose.get("customGitBranch") != expected_branch:
    raise SystemExit("Dokploy source branch drift")
if compose.get("autoDeploy") is not True:
    raise SystemExit("Dokploy automatic deployment must be enabled")
' "$expected_command" "$source_branch"

  domains=$(api_get "domain.byComposeId?composeId=$compose_id")
  printf '%s' "$domains" | python3 -c '
import json, sys
domains = json.load(sys.stdin)
expected = {
    ("api.brawltome.app", "v3-api"),
    ("brawltome.app", "v3-web"),
}
actual = {(domain.get("host"), domain.get("serviceName")) for domain in domains}
if actual != expected:
    raise SystemExit("public V3 domain metadata drift")
'
}

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
      V3_DISCORD_CLIENT_ID="$V3_DISCORD_CLIENT_ID" \
      V3_POSTGRES_DATA_ROOT=/srv/brawltome-v3/postgres \
      V3_TURNSTILE_SITE_KEY="$V3_TURNSTILE_SITE_KEY" \
      docker compose --file - config --format json
)
printf '%s' "$rendered" | bun run v3:verify-rendered-topology

verify_dokploy_metadata
api_post compose.deploy "$(json_compose_id)" >/dev/null
printf '%s\n' 'Dokploy V3 deployment requested from verified master source.'
