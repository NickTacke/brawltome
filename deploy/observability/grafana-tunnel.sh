#!/bin/sh
set -eu

fail() {
	printf '%s\n' "Grafana tunnel failed: $*" >&2
	exit 1
}

valid_ipv4() {
	old_ifs=$IFS
	IFS=.
	set -- $1
	IFS=$old_ifs
	[ "$#" -eq 4 ] || return 1
	for octet in "$@"; do
		case "$octet" in
		'' | *[!0-9]*) return 1 ;;
		esac
		[ "$octet" -le 255 ] 2>/dev/null || return 1
	done
}

for command in awk ssh; do
	command -v "$command" >/dev/null 2>&1 || fail "$command is required"
done
: "${DOKPLOY_SSH_HOST:?Set DOKPLOY_SSH_HOST}"
: "${DOKPLOY_OBSERVABILITY_APP_NAME:?Set DOKPLOY_OBSERVABILITY_APP_NAME}"
GRAFANA_LOCAL_PORT=${GRAFANA_LOCAL_PORT:-13000}

case "$DOKPLOY_SSH_HOST" in
'' | -* | *[!a-zA-Z0-9@._:-]*) fail 'invalid DOKPLOY_SSH_HOST' ;;
esac
case "$DOKPLOY_OBSERVABILITY_APP_NAME" in
'' | -* | *[!a-zA-Z0-9_.-]*) fail 'invalid DOKPLOY_OBSERVABILITY_APP_NAME' ;;
esac
case "$GRAFANA_LOCAL_PORT" in
'' | *[!0-9]*) fail 'GRAFANA_LOCAL_PORT must be between 1024 and 65535' ;;
esac
[ "$GRAFANA_LOCAL_PORT" -ge 1024 ] 2>/dev/null && [ "$GRAFANA_LOCAL_PORT" -le 65535 ] 2>/dev/null ||
	fail 'GRAFANA_LOCAL_PORT must be between 1024 and 65535'

ssh -o BatchMode=yes -o ConnectTimeout=10 -- "$DOKPLOY_SSH_HOST" \
	'command -v timeout >/dev/null && command -v curl >/dev/null' ||
	fail 'VM3 requires timeout and curl'

containers=$(ssh -o BatchMode=yes -o ConnectTimeout=10 -- "$DOKPLOY_SSH_HOST" \
	"timeout 10 docker ps --filter label=com.docker.compose.project=$DOKPLOY_OBSERVABILITY_APP_NAME --filter label=com.docker.compose.service=grafana --filter status=running --format '{{.ID}}'") ||
	fail 'cannot discover the Grafana container'
container_count=$(printf '%s\n' "$containers" | awk 'NF { count++ } END { print count + 0 }')
[ "$container_count" -eq 1 ] || fail 'expected exactly one running Grafana container'
container_id=$(printf '%s\n' "$containers" | awk 'NF { print; exit }')
case "$container_id" in
'' | *[!a-fA-F0-9]*) fail 'Grafana returned an invalid container ID' ;;
esac

network_ip_format='{{with index .NetworkSettings.Networks "brawltome-observability"}}{{.IPAddress}}{{end}}'
grafana_ip=$(ssh -o BatchMode=yes -o ConnectTimeout=10 -- "$DOKPLOY_SSH_HOST" \
	"timeout 10 docker inspect $container_id --format '$network_ip_format'") ||
	fail 'cannot inspect the Grafana container'
valid_ipv4 "$grafana_ip" || fail 'Grafana has no valid brawltome-observability IPv4 address'

ssh -o BatchMode=yes -o ConnectTimeout=10 -- "$DOKPLOY_SSH_HOST" \
	"timeout 10 docker exec $container_id wget --spider -q -T 5 http://localhost:3000/api/health" ||
	fail 'Grafana container health check failed'
ssh -o BatchMode=yes -o ConnectTimeout=10 -- "$DOKPLOY_SSH_HOST" \
	"curl -fsS --connect-timeout 5 --max-time 10 http://$grafana_ip:3000/api/health" >/dev/null ||
	fail 'Grafana overlay endpoint is unreachable from VM3'

monitor="while [ \"\$(timeout 5 docker ps --filter label=com.docker.compose.project=$DOKPLOY_OBSERVABILITY_APP_NAME --filter label=com.docker.compose.service=grafana --filter status=running --format '{{.ID}}')\" = '$container_id' ] && [ \"\$(timeout 5 docker inspect $container_id --format '{{.State.Running}}' 2>/dev/null)\" = true ] && [ \"\$(timeout 5 docker inspect $container_id --format '$network_ip_format' 2>/dev/null)\" = '$grafana_ip' ] && timeout 10 docker exec $container_id wget --spider -q -T 5 http://localhost:3000/api/health && curl -fsS --connect-timeout 5 --max-time 10 http://$grafana_ip:3000/api/health >/dev/null; do sleep 10; done; exit 1"

printf '%s\n' "Opening private Grafana at http://127.0.0.1:$GRAFANA_LOCAL_PORT"
printf '%s\n' 'Keep this process running; press Ctrl-C to close the tunnel.'
exec ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
	-T -L "127.0.0.1:$GRAFANA_LOCAL_PORT:$grafana_ip:3000" -- "$DOKPLOY_SSH_HOST" "$monitor"
