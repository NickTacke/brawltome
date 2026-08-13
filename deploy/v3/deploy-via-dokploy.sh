#!/usr/bin/env bash
set -euo pipefail

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$repository_root"

: "${DOKPLOY_URL:?Set DOKPLOY_URL}"
: "${DOKPLOY_TOKEN:?Set DOKPLOY_TOKEN}"
: "${DOKPLOY_V3_COMPOSE_ID:?Set DOKPLOY_V3_COMPOSE_ID}"
: "${DOKPLOY_V3_PROJECT_NAME:?Set DOKPLOY_V3_PROJECT_NAME}"
: "${DOKPLOY_V3_REF:?Set DOKPLOY_V3_REF to the immutable V3 topology tag}"
: "${V3_DISCORD_CLIENT_ID:?Set V3_DISCORD_CLIENT_ID to the Discord OAuth client ID}"
: "${V3_TURNSTILE_SITE_KEY:?Set V3_TURNSTILE_SITE_KEY to the public Turnstile site key}"

compose_id=$DOKPLOY_V3_COMPOSE_ID
project_name=$DOKPLOY_V3_PROJECT_NAME
source_ref=$DOKPLOY_V3_REF
api_url=${DOKPLOY_URL%/}/api
expected_command="compose --parallel 1 -p $project_name -f ./deploy/v3/compose.yml up -d --build --remove-orphans"

for identifier in "$compose_id" "$project_name"; do
  [[ $identifier =~ ^[A-Za-z0-9_-]+$ ]] || {
    printf '%s\n' 'Dokploy identifier contains unsupported characters.' >&2
    exit 1
  }
done
[[ $source_ref =~ ^v3-topology-([0-9a-f]{40})$ ]] || {
  printf '%s\n' 'Dokploy source ref must be an immutable v3-topology-<40-character-sha> tag.' >&2
  exit 1
}
expected_commit=${BASH_REMATCH[1]}
tag_ruleset_id=20717076

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

verify_tag_ruleset() {
  gh api "repos/NickTacke/brawltome/rulesets/$tag_ruleset_id" | python3 -c '
import json, sys
ruleset = json.load(sys.stdin)
condition = ruleset.get("conditions", {}).get("ref_name")
rule_types = {rule.get("type") for rule in ruleset.get("rules", [])}
if ruleset.get("target") != "tag" or ruleset.get("enforcement") != "active":
    raise SystemExit("V3 deployment tag ruleset is not active")
if ruleset.get("bypass_actors") != []:
    raise SystemExit("V3 deployment tag ruleset must not allow bypass actors")
if condition != {"include": ["refs/tags/v3-topology-*"], "exclude": []}:
    raise SystemExit("V3 deployment tag ruleset condition drift")
if rule_types != {"update", "deletion"}:
    raise SystemExit("V3 deployment tag ruleset rule drift")
'
}

verify_remote_ref() {
  local remote_commit
  remote_commit=$(git ls-remote --refs origin "refs/tags/$source_ref" | awk 'NR == 1 { print $1 } NR > 1 { exit 2 }')
  [[ $remote_commit == "$expected_commit" ]] || {
    printf '%s\n' 'Immutable V3 topology tag does not resolve to its encoded commit.' >&2
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
if compose.get("customGitBranch") != expected_ref:
    raise SystemExit("immutable Dokploy source ref drift")
' "$expected_command" "$source_ref"

  domains=$(api_get "domain.byComposeId?composeId=$compose_id")
  printf '%s' "$domains" | python3 -c '
import json, sys
domains = json.load(sys.stdin)
expected = {
    ("api.brawltome.app", "v3-api"),
    ("brawltome.app", "v3-web"),
    ("v3-api.brawltome.app", "v3-api"),
}
actual = {(domain.get("host"), domain.get("serviceName")) for domain in domains}
if actual != expected:
    raise SystemExit("public V3 domain metadata drift")
'
}

verify_tag_ruleset
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
      V3_DISCORD_CLIENT_ID="$V3_DISCORD_CLIENT_ID" \
      V3_POSTGRES_DATA_ROOT=/srv/brawltome-v3/postgres \
      V3_PUBLIC_API_URL=https://v3-api.brawltome.app \
      V3_TURNSTILE_SITE_KEY="$V3_TURNSTILE_SITE_KEY" \
      docker compose --file - config --format json
)
printf '%s' "$rendered" | bun run v3:verify-rendered-topology

verify_tag_ruleset
verify_remote_ref
verify_dokploy_metadata
api_post compose.deploy "$(json_compose_id)" >/dev/null
printf '%s\n' 'Dokploy V3 deployment requested from an immutable verified source.'
