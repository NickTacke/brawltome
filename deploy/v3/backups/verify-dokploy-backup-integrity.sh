#!/usr/bin/env bash
set -euo pipefail

RCLONE_BIN=${RCLONE_BIN:-rclone}
LOCK_FILE=${LOCK_FILE:-/run/brawltome-backup-integrity/verifier.lock}
MIN_BACKUP_AGE_SECONDS=${MIN_BACKUP_AGE_SECONDS:-300}
MAX_BACKUP_AGE_SECONDS=${MAX_BACKUP_AGE_SECONDS:-28800}
BACKUP_INTEGRITY_METRICS_FILE=${BACKUP_INTEGRITY_METRICS_FILE:-/srv/brawltome-observability/backup-integrity/brawltome-backup-integrity.prom}
metrics_dir=${BACKUP_INTEGRITY_METRICS_FILE%/*}
last_verified=0

write_metrics() {
  local ok=$1 now=$2 verified=$3 temporary
  temporary=$(mktemp "$metrics_dir/.backup-integrity.XXXXXX")
  chmod 0644 "$temporary"
  cat >"$temporary" <<METRICS
# HELP brawltome_postgres_backup_integrity_ok Whether the latest recurring PostgreSQL backup passed integrity verification.
# TYPE brawltome_postgres_backup_integrity_ok gauge
brawltome_postgres_backup_integrity_ok{generation="v3"} $ok
# HELP brawltome_postgres_backup_integrity_last_run_timestamp_seconds Unix timestamp of the latest verifier run.
# TYPE brawltome_postgres_backup_integrity_last_run_timestamp_seconds gauge
brawltome_postgres_backup_integrity_last_run_timestamp_seconds{generation="v3"} $now
# HELP brawltome_postgres_backup_integrity_latest_verified_timestamp_seconds Backup timestamp of the latest verified recurring PostgreSQL backup.
# TYPE brawltome_postgres_backup_integrity_latest_verified_timestamp_seconds gauge
brawltome_postgres_backup_integrity_latest_verified_timestamp_seconds{generation="v3"} $verified
METRICS
  mv "$temporary" "$BACKUP_INTEGRITY_METRICS_FILE"
}

on_exit() {
  local status=$1 now
  trap - EXIT
  if (( status != 0 )); then
    now=$(date -u +%s)
    write_metrics 0 "$now" "$last_verified"
  fi
  exit "$status"
}
trap 'on_exit $?' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -r $BACKUP_INTEGRITY_METRICS_FILE ]]; then
  last_verified=$(awk '$1 ~ /^brawltome_postgres_backup_integrity_latest_verified_timestamp_seconds/ { print $2 }' "$BACKUP_INTEGRITY_METRICS_FILE")
  [[ $last_verified =~ ^[0-9]+$ ]] || last_verified=0
fi

: "${BACKUP_REMOTE:?Set BACKUP_REMOTE to the rclone remote name}"
: "${BACKUP_BUCKET:?Set BACKUP_BUCKET}"
: "${BACKUP_PREFIX:?Set BACKUP_PREFIX}"
[[ -d $metrics_dir && -w $metrics_dir ]] || { printf '%s\n' 'Backup integrity metrics directory is not writable' >&2; exit 1; }
[[ $BACKUP_REMOTE =~ ^[A-Za-z0-9_]+$ ]] || { printf '%s\n' 'Invalid BACKUP_REMOTE' >&2; exit 1; }
[[ $BACKUP_BUCKET =~ ^[A-Za-z0-9._-]+$ ]] || { printf '%s\n' 'Invalid BACKUP_BUCKET' >&2; exit 1; }
[[ $BACKUP_PREFIX =~ ^[A-Za-z0-9._/-]+$ && $BACKUP_PREFIX != /* && $BACKUP_PREFIX != *'..'* && $BACKUP_PREFIX != *'//'* ]] || {
  printf '%s\n' 'Invalid BACKUP_PREFIX' >&2
  exit 1
}
[[ $MIN_BACKUP_AGE_SECONDS =~ ^[0-9]+$ && $MAX_BACKUP_AGE_SECONDS =~ ^[0-9]+$ ]] || {
  printf '%s\n' 'Backup age bounds must be non-negative integers' >&2
  exit 1
}
command -v "$RCLONE_BIN" >/dev/null
command -v awk >/dev/null
command -v flock >/dev/null
command -v gzip >/dev/null
command -v mkfifo >/dev/null
command -v sha256sum >/dev/null

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf '%s\n' 'Backup integrity verification is already running'
  exit 0
fi

remote="${BACKUP_REMOTE}:${BACKUP_BUCKET}/${BACKUP_PREFIX%/}"
latest=$(
  "$RCLONE_BIN" lsf --files-only --include '*.sql.gz' "$remote" |
    LC_ALL=C sort |
    tail -n 1
)
[[ $latest =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2})-([0-9]{2})-([0-9]{2})-([0-9]{3})Z\.sql\.gz$ ]] || {
  printf '%s\n' 'No valid recurring PostgreSQL backup found' >&2
  exit 1
}

backup_timestamp=$(python3 - "$latest" <<'PY'
from datetime import datetime, timezone
import sys
print(int(datetime.strptime(sys.argv[1], "%Y-%m-%dT%H-%M-%S-%fZ.sql.gz").replace(tzinfo=timezone.utc).timestamp()))
PY
)
now=$(date -u +%s)
backup_age=$((now - backup_timestamp))
(( backup_age >= MIN_BACKUP_AGE_SECONDS )) || { printf '%s\n' 'Latest backup is still being uploaded' >&2; exit 1; }
(( backup_age <= MAX_BACKUP_AGE_SECONDS )) || { printf '%s\n' 'Latest backup is stale' >&2; exit 1; }

work_dir=$(mktemp -d)
hash_file=$work_dir/hash
hash_pipe=$work_dir/stream
mkfifo "$hash_pipe"
trap 'status=$?; rm -rf "$work_dir"; on_exit "$status"' EXIT
sha256sum <"$hash_pipe" | awk '{ print $1 }' >"$hash_file" &
hash_pid=$!
if ! "$RCLONE_BIN" cat "$remote/$latest" | tee "$hash_pipe" | gzip -t; then
  wait "$hash_pid" || true
  printf '%s\n' 'Latest backup could not be read and validated' >&2
  exit 1
fi
if ! wait "$hash_pid"; then
  printf '%s\n' 'Latest backup hash could not be computed' >&2
  exit 1
fi
computed=$(<"$hash_file")
[[ $computed =~ ^[a-f0-9]{64}$ ]] || { printf '%s\n' 'Latest backup hash is invalid' >&2; exit 1; }

sidecar="$latest.sha256"
expected="$computed  $latest"
sidecar_listing=$("$RCLONE_BIN" lsf --files-only --include "$sidecar" "$remote")
if [[ -n $sidecar_listing && $sidecar_listing != "$sidecar" ]]; then
  printf '%s\n' 'Latest backup checksum sidecar lookup was ambiguous' >&2
  exit 1
fi
if [[ $sidecar_listing == "$sidecar" ]]; then
  existing=$("$RCLONE_BIN" cat "$remote/$sidecar")
  [[ $existing =~ ^[a-f0-9]{64}\ \ [^[:space:]]+$ && $existing == "$expected" ]] || {
    printf '%s\n' 'Latest backup checksum sidecar does not match' >&2
    exit 1
  }
else
  printf '%s\n' "$expected" | "$RCLONE_BIN" rcat "$remote/$sidecar"
  existing=$("$RCLONE_BIN" cat "$remote/$sidecar")
  [[ $existing == "$expected" ]] || { printf '%s\n' 'Uploaded checksum sidecar could not be verified' >&2; exit 1; }
fi

last_verified=$backup_timestamp
write_metrics 1 "$now" "$last_verified"
printf '%s\n' 'Latest recurring PostgreSQL backup passed integrity verification.'
