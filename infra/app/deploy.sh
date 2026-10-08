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
#
# After converging, smoke checks request the new release from inside its own containers. When they fail, the images
# that ran before the deploy (tagged <project>-<service>:previous before the build) are rolled back in the same
# zero-downtime way and the script exits non-zero so Dokploy marks the deploy failed. The database is never rolled
# back: the compatibility rule above is what makes running the previous images against the migrated schema safe.
# DEPLOY_SMOKE=0 skips the checks; DEPLOY_SMOKE_FORCE_FAILURE=1 fails them on purpose to exercise the rollback.
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
# Smoke checks retry until this budget is spent; after that each remaining check gets a single attempt.
smoke_timeout_seconds=${DEPLOY_SMOKE_TIMEOUT_SECONDS:-60}
smoke_retry_seconds=${DEPLOY_SMOKE_RETRY_SECONDS:-3}
smoke_request_timeout_seconds=${DEPLOY_SMOKE_REQUEST_TIMEOUT_SECONDS:-10}

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

running_containers() {
  docker ps -q --filter status=running \
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

# Every service the deploy may replace: the migration runs once below and postgres is never recreated here.
app_services=$(compose config --services | grep -vx -e migration -e postgres)

log 'remembering the running images in case the release has to be rolled back'
# compose names built images <project>-<service> and moves that tag on build, after which the running release's image
# is untagged and a prune could delete it once its container is replaced. The :previous tag keeps it.
for service in $app_services; do
  current=$(running_containers "$service" | head -n 1)
  if [ -n "$current" ]; then
    docker tag "$(docker inspect -f '{{.Image}}' "$current")" "$project-$service:previous"
  else
    # A tag left by an older deploy is not what runs now and must never be restored.
    docker rmi "$project-$service:previous" >/dev/null 2>&1 || true
  fi
done

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
converge() {
  # shellcheck disable=SC2086
  compose up -d --remove-orphans --no-deps --wait --wait-timeout "$health_timeout_seconds" $app_services
}
converge

running_postgres_image=$(docker inspect -f '{{.Image}}' "$(compose ps -q postgres)" 2>/dev/null || true)
built_postgres_image=$(docker image inspect -f '{{.Id}}' "$project-postgres" 2>/dev/null || true)
if [ -n "$built_postgres_image" ] && [ "$running_postgres_image" != "$built_postgres_image" ]; then
  log "WARNING: PostgreSQL runs an older image than this release built; it was left running. Recreate it in a" \
    "maintenance window: docker compose -p $project -f $file up -d --no-deps postgres"
fi

# Requests a URL from inside a container with the runtime its image ships (the images have neither curl nor wget) and
# succeeds only on HTTP 200. The deploy container cannot rely on public DNS, and bypassing Traefik makes each check
# hit the new container itself rather than whichever one Traefik picked.
probe() {
  docker exec "$1" "$2" -e "fetch('$3', { signal: AbortSignal.timeout($((smoke_request_timeout_seconds * 1000))) }).then(
    (response) => { if (response.status !== 200) { console.error('HTTP ' + response.status); process.exit(1) } process.exit(0) },
    (error) => { console.error(String(error)); process.exit(1) })"
}

# <service> <runtime> <path>: probes every running container of the service on its port 3000.
probe_service() {
  smoke_containers=$(running_containers "$1")
  [ -n "$smoke_containers" ] || {
    printf '%s\n' "no running $1 container"
    return 1
  }
  for smoke_container in $smoke_containers; do
    probe "$smoke_container" "$2" "http://127.0.0.1:3000$3" || return 1
  done
}

# <description> <command...>: retries the command until it passes or the smoke budget is spent.
smoke_check() {
  smoke_name=$1
  shift
  while :; do
    if smoke_output=$("$@" 2>&1); then
      log "smoke: $smoke_name ok"
      return 0
    fi
    if [ "$(date +%s)" -ge "$smoke_deadline" ]; then
      log "smoke: $smoke_name FAILED: $smoke_output"
      return 1
    fi
    sleep "$smoke_retry_seconds"
  done
}

# Runs every check, even after one fails, so the log shows the whole picture.
smoke() {
  smoke_deadline=$(($(date +%s) + smoke_timeout_seconds))
  smoke_failed=0
  smoke_check 'api /health/ready' probe_service api bun /health/ready || smoke_failed=1
  smoke_check 'web /api/health/ready' probe_service web node /api/health/ready || smoke_failed=1
  smoke_check 'web renders /' probe_service web node / || smoke_failed=1
  # tRPC GET of leaderboard.get with the superjson input {"mode":"1v1","region":"all","page":1,"pageSize":10}.
  smoke_check 'api leaderboard read' probe_service api bun \
    '/trpc/leaderboard.get?input=%7B%22json%22%3A%7B%22mode%22%3A%221v1%22%2C%22region%22%3A%22all%22%2C%22page%22%3A1%2C%22pageSize%22%3A10%7D%7D' ||
    smoke_failed=1
  if [ "$force_smoke_failure" = 1 ]; then
    log 'smoke: failing on purpose (DEPLOY_SMOKE_FORCE_FAILURE=1)'
    smoke_failed=1
  fi
  return "$smoke_failed"
}

# <rolling service...>: points each service's image tag back at its :previous image, rolls the public services back
# the same way they rolled forward and recreates the rest. Fails without changing anything when a public service has
# no previous image (first deploy), and fails after restoring what it could when a step fails.
rollback() {
  for service in "$@"; do
    docker image inspect "$project-$service:previous" >/dev/null 2>&1 || {
      log "rollback: no previous $service image (first deploy?); leaving this release in place"
      return 1
    }
  done
  rollback_failed=0
  for service in $app_services; do
    if docker image inspect "$project-$service:previous" >/dev/null 2>&1; then
      docker tag "$project-$service:previous" "$project-$service:latest"
    else
      log "rollback: no previous $service image; it keeps running this release"
    fi
  done
  for service in "$@"; do
    roll "$service" || {
      log "rollback: $service could not be restored; it keeps running this release"
      rollback_failed=1
    }
  done
  log 'rollback: recreating the remaining services on their previous images'
  converge || rollback_failed=1
  return "$rollback_failed"
}

if [ "${DEPLOY_SMOKE:-1}" = 0 ]; then
  log 'smoke checks skipped (DEPLOY_SMOKE=0)'
  log 'done'
  exit 0
fi

log 'smoke-testing the new release'
# The forced failure applies to the new release only, so the check after a rollback reports the real state.
force_smoke_failure=${DEPLOY_SMOKE_FORCE_FAILURE:-0}
if smoke; then
  log 'done'
  exit 0
fi

log 'SMOKE CHECKS FAILED: rolling back to the previous release'
force_smoke_failure=0
if ! rollback "$@"; then
  log 'ROLLBACK INCOMPLETE: check which image each container runs (docker ps) before deploying again'
elif smoke; then
  log 'ROLLED BACK: the previous release is serving again and passes the smoke checks'
else
  log 'ROLLED BACK, but the previous release fails the smoke checks too; the cause may lie outside the release'
fi
exit 1
