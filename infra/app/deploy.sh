#!/bin/sh
# Zero-downtime deploy of the application stack.
#
# Plain `compose up` stops every changed service before it runs the migration and starts the new containers, so the
# site was unreachable for ~40 s per deploy. This builds and migrates while the old containers keep serving, then
# replaces each public service by starting the new container beside the old one and stopping the old one only once
# the new one is healthy. Traefik routes only to healthy containers; on SIGTERM the old container reports draining on
# its /serving health check while it keeps answering, so Traefik moves traffic before it stops (api: serve.ts,
# web: web-server.cjs). The retry middleware replays requests that still race a closing connection.
#
# Dokploy rejects shell operators in a custom compose command and prefixes it with `docker`, so the compose's
# Command setting runs this script in a throwaway CLI container (one line; <app> is the Dokploy app name):
#   run --rm -v /var/run/docker.sock:/var/run/docker.sock -v /etc/dokploy/compose/<app>/code:/etc/dokploy/compose/<app>/code
#   -w /etc/dokploy/compose/<app>/code docker:29-cli@sha256:b1805116a6a86cc591b5d5f60a910a0715cdcc9d18d866ad68b1457ead25c35c
#   sh infra/app/deploy.sh <app> infra/app/compose.yml api web
# Rollback: clear the Command setting; Dokploy falls back to `compose up -d --build --remove-orphans`.
#
# Migrations run while the previous release still serves, so they must stay compatible with it: add before use,
# remove only after a release that no longer reads it.
set -eu

[ "$#" -ge 2 ] || {
  printf '%s\n' 'usage: deploy.sh <project> <compose file> [rolling service...]' >&2
  exit 2
}
project=$1
file=$2
shift 2

health_timeout_seconds=${DEPLOY_HEALTH_TIMEOUT_SECONDS:-240}
# Traefik refreshes its Docker configuration on health events, throttled to every 2 s by default.
routing_settle_seconds=${DEPLOY_ROUTING_SETTLE_SECONDS:-5}

compose() {
  docker compose --parallel 1 -p "$project" -f "$file" "$@"
}

log() {
  printf '[deploy] %s\n' "$*"
}

service_containers() {
  docker ps -aq \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$1"
}

wait_healthy() {
  container=$1
  waited=0
  while :; do
    state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")
    case "$state" in
      'running healthy' | 'running none') return 0 ;;
      'running starting') ;;
      *)
        log "container $container is $state"
        return 1
        ;;
    esac
    if [ "$waited" -ge "$health_timeout_seconds" ]; then
      log "container $container is still $state after ${health_timeout_seconds}s"
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

roll() {
  service=$1
  old=$(service_containers "$service")
  if [ -z "$old" ]; then
    log "$service: first start"
    compose up -d --no-deps --wait "$service"
    return
  fi

  log "$service: starting the new container beside $(printf '%s' "$old" | tr '\n' ' ')"
  compose up -d --no-deps --no-recreate --scale "$service=$(($(printf '%s\n' "$old" | wc -l) + 1))" "$service"
  new=$(service_containers "$service" | grep -vxF "$old" || true)
  [ -n "$new" ] || {
    log "$service: compose created no new container"
    return 1
  }

  if ! wait_healthy "$new"; then
    log "$service: the new container never became healthy; keeping the old one"
    docker logs --tail 50 "$new" >&2 || true
    docker rm -f "$new" >/dev/null
    return 1
  fi

  log "$service: $new is healthy; letting Traefik pick it up"
  sleep "$routing_settle_seconds"
  # A release that passes its first health check and then crashes must not replace the working one.
  state=$(docker inspect -f '{{.State.Status}} {{.State.Restarting}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$new")
  case "$state" in
    'running false healthy' | 'running false none') ;;
    *)
      log "$service: the new container became $state after passing its health check; keeping the old one"
      docker logs --tail 50 "$new" >&2 || true
      docker rm -f "$new" >/dev/null
      return 1
      ;;
  esac
  for container in $old; do
    # docker stop honours the stop_grace_period compose stored on the container.
    docker stop "$container" >/dev/null
    docker rm "$container" >/dev/null
  done
  log "$service: replaced"
}

log 'building images while the current release keeps serving'
compose build

log 'ensuring PostgreSQL is up'
# Never recreate the database during a rolling deploy. `compose build` rebuilds the postgres image, and when the build
# cache was pruned the rebuilt image gets a new ID, so a plain `up` restarted PostgreSQL mid-deploy and the serving
# release failed requests with CONNECT_TIMEOUT (2026-10-08 16:46 UTC). Image or config changes for postgres are
# applied in a maintenance window instead (see the warning at the end).
compose up -d --no-deps --no-recreate --wait postgres

log 'running migrations against the live database'
compose up --no-deps --no-log-prefix --exit-code-from migration migration

for service in "$@"; do
  roll "$service"
done

log 'converging the remaining services'
# The migration already ran above; naming every other service keeps compose from running it a second time.
# shellcheck disable=SC2046
compose up -d --remove-orphans --no-deps --wait --wait-timeout "$health_timeout_seconds" \
  $(compose config --services | grep -vx -e migration -e postgres)

running_postgres_image=$(docker inspect -f '{{.Image}}' "$(compose ps -q postgres)" 2>/dev/null || true)
built_postgres_image=$(docker image inspect -f '{{.Id}}' "$project-postgres" 2>/dev/null || true)
if [ -n "$built_postgres_image" ] && [ "$running_postgres_image" != "$built_postgres_image" ]; then
  log "WARNING: PostgreSQL runs an older image than this release built; it was left running. Recreate it in a" \
    "maintenance window: docker compose -p $project -f $file up -d --no-deps postgres"
fi

log 'done'
