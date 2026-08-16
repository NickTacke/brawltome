#!/bin/sh
set -eu

read_secret() {
  variable=$1
  path=$2
  [ -r "$path" ] || {
    printf '%s\n' "Required secret is unreadable: $variable" >&2
    exit 1
  }
  value=$(cat "$path")
  [ -n "$value" ] || {
    printf '%s\n' "Required secret is empty: $variable" >&2
    exit 1
  }
  export "$variable=$value"
}

secrets_root=${BRAWLTOME_SECRETS_ROOT:-/run/secrets}
role=${1:-}
[ "$#" -eq 0 ] || shift
case "$role" in
  migration)
    read_secret DATABASE_URL "$secrets_root/migration_database_url"
    exec bun run db:migrate
    ;;
  api)
    read_secret DATABASE_URL "$secrets_root/runtime_database_url"
    read_secret DISCORD_CLIENT_SECRET "$secrets_root/discord_client_secret"
    read_secret DISCORD_INTERNAL_API_SECRET "$secrets_root/discord_internal_api_secret"
    read_secret INTERNAL_API_SECRET "$secrets_root/internal_api_secret"
    read_secret METRICS_SCRAPE_SECRET "$secrets_root/metrics_scrape_secret"
    read_secret OTEL_EXPORTER_OTLP_AUTHORIZATION "$secrets_root/otel_authorization"
    read_secret REFRESH_TRUST_COOKIE_SECRET "$secrets_root/refresh_trust_cookie_secret"
    read_secret REPLAY_BRIDGE_SECRET "$secrets_root/replay_bridge_secret"
    read_secret TURNSTILE_SECRET_KEY "$secrets_root/turnstile_secret_key"
    exec bun run apps/api/src/serve.ts
    ;;
  operations-worker)
    read_secret BRAWLHALLA_API_KEY "$secrets_root/brawlhalla_api_key"
    read_secret DATABASE_URL "$secrets_root/runtime_database_url"
    read_secret METRICS_SCRAPE_SECRET "$secrets_root/metrics_scrape_secret"
    read_secret OTEL_EXPORTER_OTLP_AUTHORIZATION "$secrets_root/otel_authorization"
    exec bun run apps/api/src/operations-worker.ts
    ;;
  web)
    read_secret INTERNAL_API_SECRET "$secrets_root/internal_api_secret"
    read_secret MATCHES_PREVIEW_TOKEN "$secrets_root/matches_preview_token"
    read_secret METRICS_SCRAPE_SECRET "$secrets_root/metrics_scrape_secret"
    read_secret OTEL_EXPORTER_OTLP_AUTHORIZATION "$secrets_root/otel_authorization"
    exec node apps/web/server.js
    ;;
  discord-bot)
    read_secret DISCORD_INTERNAL_API_SECRET "$secrets_root/discord_internal_api_secret"
    read_secret DISCORD_TOKEN "$secrets_root/discord_token"
    read_secret INTERNAL_API_SECRET "$secrets_root/internal_api_secret"
    read_secret METRICS_SCRAPE_SECRET "$secrets_root/metrics_scrape_secret"
    read_secret OTEL_EXPORTER_OTLP_AUTHORIZATION "$secrets_root/otel_authorization"
    exec bun run apps/discord-bot/src/index.ts
    ;;
  dead-letter-cli)
    read_secret DEAD_LETTER_DATABASE_URL "$secrets_root/dead_letter_database_url"
    read_secret DEAD_LETTER_OPERATOR_TOKENS "$secrets_root/dead_letter_operator_tokens"
    exec bun run packages/contexts/refresh-operations/cli.ts "$@"
    ;;
  *)
    printf '%s\n' 'Usage: run-with-secrets.sh migration|api|operations-worker|web|discord-bot|dead-letter-cli' >&2
    exit 64
    ;;
esac
