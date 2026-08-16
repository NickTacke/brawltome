#!/bin/sh
set -eu

fail() {
	printf '%s\n' "network preflight failed: $*" >&2
	exit 1
}

mode=verify
case "$#" in
0) ;;
1)
	[ "$1" = --provision ] || fail 'usage: ensure.sh [--provision]'
	mode=provision
	;;
*) fail 'usage: ensure.sh [--provision]' ;;
esac

for command in awk docker; do
	command -v "$command" >/dev/null 2>&1 || fail "$command is required on the Dokploy host"
done
: "${BRAWLTOME_NETWORK_NAME:?Set BRAWLTOME_NETWORK_NAME}"
case "$BRAWLTOME_NETWORK_NAME" in
'' | -* | *[!a-zA-Z0-9_.-]*) fail 'invalid BRAWLTOME_NETWORK_NAME' ;;
esac

[ "$BRAWLTOME_NETWORK_NAME" != 'brawltome-observability' ] || fail 'application and observability networks must be distinct'
[ "$BRAWLTOME_NETWORK_NAME" != 'brawltome-notifications' ] || fail 'application and notification networks must be distinct'

swarm_state=$(docker info --format '{{.Swarm.LocalNodeState}}') || fail 'cannot inspect Docker Swarm state'
[ "$swarm_state" = active ] || fail 'Docker Swarm must be active'

network_id() {
	name=$1
	matches=$(docker network ls --format '{{.ID}}|{{.Name}}') || fail 'cannot list Docker networks'
	ids=$(printf '%s\n' "$matches" | awk -F '|' -v expected="$name" '$2 == expected { print $1 }')
	count=$(printf '%s\n' "$ids" | awk 'NF { count++ } END { print count + 0 }')
	case "$count" in
	0) printf '%s\n' missing ;;
	1) printf '%s\n' "$ids" ;;
	*) fail "multiple networks named $name" ;;
	esac
}

verify_network() {
	id=$1
	name=$2
	expected_internal=$3
	attributes=$(docker network inspect "$id" --format '{{.Driver}}|{{.Scope}}|{{.Attachable}}|{{.Internal}}') ||
		fail "cannot inspect $name"
	IFS='|' read -r driver scope attachable internal <<EOF
$attributes
EOF
	[ "$driver" = overlay ] || fail "$name must use driver=overlay"
	[ "$scope" = swarm ] || fail "$name must have scope=swarm"
	[ "$attachable" = true ] || fail "$name must have attachable=true"
	[ "$internal" = "$expected_internal" ] || fail "$name must have internal=$expected_internal"
}

create_network() {
	name=$1
	internal=$2
	if [ "$internal" = true ]; then
		docker network create --driver overlay --attachable --internal \
			--label io.brawltome.capability=observability -- "$name" ||
			fail "cannot create $name"
	else
		docker network create --driver overlay --attachable \
			--label io.brawltome.capability=observability -- "$name" ||
			fail "cannot create $name"
	fi
}

observability_id=$(network_id brawltome-observability)
notifications_id=$(network_id brawltome-notifications)
application_id=$(network_id "$BRAWLTOME_NETWORK_NAME")

[ "$observability_id" = missing ] || verify_network "$observability_id" brawltome-observability true
[ "$notifications_id" = missing ] || verify_network "$notifications_id" brawltome-notifications false
[ "$application_id" = missing ] || verify_network "$application_id" "$BRAWLTOME_NETWORK_NAME" false

if [ "$mode" = verify ]; then
	[ "$observability_id" != missing ] || fail 'brawltome-observability does not exist; rerun with --provision'
	[ "$notifications_id" != missing ] || fail 'brawltome-notifications does not exist; rerun with --provision'
	[ "$application_id" != missing ] || fail "$BRAWLTOME_NETWORK_NAME does not exist; rerun with --provision"
else
	created_ids=''
	committed=false
	rollback() {
		status=$?
		trap - EXIT INT TERM
		if [ "$committed" = false ]; then
			for id in $created_ids; do
				docker network rm "$id" >/dev/null 2>&1 ||
					printf '%s\n' "network rollback warning: could not remove $id" >&2
			done
		fi
		exit "$status"
	}
	trap rollback EXIT INT TERM

	if [ "$observability_id" = missing ]; then
		observability_id=$(create_network brawltome-observability true)
		created_ids="$created_ids $observability_id"
	fi
	if [ "$notifications_id" = missing ]; then
		notifications_id=$(create_network brawltome-notifications false)
		created_ids="$created_ids $notifications_id"
	fi
	if [ "$application_id" = missing ]; then
		application_id=$(create_network "$BRAWLTOME_NETWORK_NAME" false)
		created_ids="$created_ids $application_id"
	fi

	verify_network "$observability_id" brawltome-observability true
	verify_network "$notifications_id" brawltome-notifications false
	verify_network "$application_id" "$BRAWLTOME_NETWORK_NAME" false
	committed=true
	trap - EXIT INT TERM
fi

printf '%s\n' 'brawltome-observability verified: overlay, swarm, attachable, internal=true'
printf '%s\n' 'brawltome-notifications verified: overlay, swarm, attachable, internal=false'
printf '%s\n' "$BRAWLTOME_NETWORK_NAME verified: overlay, swarm, attachable, internal=false"
printf '%s\n' 'Observability network preflight passed.'
