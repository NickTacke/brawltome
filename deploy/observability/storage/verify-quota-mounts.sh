#!/bin/sh
set -eu

fail() {
	printf '%s\n' "quota preflight failed: $*" >&2
	exit 1
}

require_positive_integer() {
	name=$1
	value=$2
	case "$value" in
	'' | *[!0-9]* | 0) fail "$name must be a positive byte count" ;;
	esac
}

for command in findmnt mountpoint df numfmt stat; do
	command -v "$command" >/dev/null 2>&1 || fail "$command is required on the Dokploy host"
done

: "${OBSERVABILITY_DATA_ROOT:?Set OBSERVABILITY_DATA_ROOT}"
require_positive_integer OBSERVABILITY_METRICS_QUOTA_BYTES "${OBSERVABILITY_METRICS_QUOTA_BYTES:-}"
require_positive_integer OBSERVABILITY_LOGS_QUOTA_BYTES "${OBSERVABILITY_LOGS_QUOTA_BYTES:-}"
require_positive_integer OBSERVABILITY_TRACES_QUOTA_BYTES "${OBSERVABILITY_TRACES_QUOTA_BYTES:-}"
: "${PROMETHEUS_RETENTION_SIZE:?Set PROMETHEUS_RETENTION_SIZE}"

prometheus_retention_bytes=$(numfmt --from=si "$PROMETHEUS_RETENTION_SIZE") || fail 'invalid PROMETHEUS_RETENTION_SIZE'
max_prometheus_retention=$((OBSERVABILITY_METRICS_QUOTA_BYTES * 80 / 100))
[ "$prometheus_retention_bytes" -le "$max_prometheus_retention" ] || fail 'Prometheus retention size exceeds 80 percent of its quota'

devices=''
verify_mount() {
	name=$1
	quota=$2
	expected_uid=$3
	path="$OBSERVABILITY_DATA_ROOT/$name"

	[ -d "$path" ] || fail "$path does not exist"
	mountpoint -q "$path" || fail "$path is not a dedicated mountpoint"
	device=$(findmnt -n -o MAJ:MIN --target "$path") || fail "cannot resolve filesystem device for $path"
	case " $devices " in
	*" $device "*) fail "$path shares filesystem device $device with another telemetry store" ;;
	esac
	devices="$devices $device"

	capacity=$(df -B1 --output=size "$path" | tail -n 1 | tr -d ' ')
	available=$(df -B1 --output=avail "$path" | tail -n 1 | tr -d ' ')
	[ "$capacity" -le "$quota" ] || fail "$path capacity exceeds declared quota"
	[ "$capacity" -ge $((quota * 95 / 100)) ] || fail "$path capacity is more than five percent below declared quota"
	[ "$available" -ge $((capacity * 20 / 100)) ] || fail "$path has less than 20 percent deployment headroom"

	owner=$(stat -c '%u' "$path")
	[ "$owner" = "$expected_uid" ] || fail "$path must be owned by UID $expected_uid"
	[ ! -L "$path" ] || fail "$path must not be a symlink"
}

verify_mount prometheus "$OBSERVABILITY_METRICS_QUOTA_BYTES" 65534
verify_mount loki "$OBSERVABILITY_LOGS_QUOTA_BYTES" 10001
verify_mount tempo "$OBSERVABILITY_TRACES_QUOTA_BYTES" 10001

printf '%s\n' 'Quota preflight passed for three distinct dedicated telemetry filesystems.'
