#!/bin/sh
set -eu

[ "$#" -eq 0 ] || {
  printf '%s\n' 'Usage: verify-postgres-mount.sh' >&2
  exit 64
}

: "${V3_POSTGRES_DATA_ROOT:?Set V3_POSTGRES_DATA_ROOT}"
: "${V3_POSTGRES_QUOTA_BYTES:?Set V3_POSTGRES_QUOTA_BYTES}"
: "${V3_POSTGRES_MIN_FREE_BYTES:?Set V3_POSTGRES_MIN_FREE_BYTES}"

positive_integer() {
  case "$2" in
    ''|0|0[0-9]*|*[!0-9]*)
      printf '%s\n' "$1 must be a positive decimal integer without leading zeroes" >&2
      exit 1
      ;;
  esac
}

positive_integer V3_POSTGRES_QUOTA_BYTES "$V3_POSTGRES_QUOTA_BYTES"
positive_integer V3_POSTGRES_MIN_FREE_BYTES "$V3_POSTGRES_MIN_FREE_BYTES"

mount_target=$(findmnt -rn --target "$V3_POSTGRES_DATA_ROOT" -o TARGET)
[ "$mount_target" = "$V3_POSTGRES_DATA_ROOT" ] || {
  printf '%s\n' "$V3_POSTGRES_DATA_ROOT is not the exact mountpoint" >&2
  exit 1
}

filesystem=$(findmnt -rn --target "$V3_POSTGRES_DATA_ROOT" -o FSTYPE)
[ "$filesystem" = ext4 ] || {
  printf '%s\n' "$V3_POSTGRES_DATA_ROOT must use ext4" >&2
  exit 1
}

owner=$(stat -c %u:%g "$V3_POSTGRES_DATA_ROOT")
[ "$owner" = 70:70 ] || {
  printf '%s\n' "$V3_POSTGRES_DATA_ROOT must be owned by 70:70" >&2
  exit 1
}

root_device=$(stat -c %d /)
data_device=$(stat -c %d "$V3_POSTGRES_DATA_ROOT")
[ "$data_device" != "$root_device" ] || {
  printf '%s\n' "$V3_POSTGRES_DATA_ROOT must use a device distinct from root" >&2
  exit 1
}

source=$(findmnt -rn --target "$V3_POSTGRES_DATA_ROOT" -o SOURCE)
size=$(blockdev --getsize64 "$source")
[ "$size" = "$V3_POSTGRES_QUOTA_BYTES" ] || {
  printf '%s\n' "$V3_POSTGRES_DATA_ROOT size does not match V3_POSTGRES_QUOTA_BYTES" >&2
  exit 1
}

available=$(df -B1 --output=avail "$V3_POSTGRES_DATA_ROOT" | tail -n 1 | tr -d ' ')
positive_integer available_bytes "$available"
[ "$available" -ge "$V3_POSTGRES_MIN_FREE_BYTES" ] || {
  printf '%s\n' "$V3_POSTGRES_DATA_ROOT has insufficient free space" >&2
  exit 1
}

options=$(findmnt -rn --target "$V3_POSTGRES_DATA_ROOT" -o OPTIONS)
for option in rw nosuid nodev noexec; do
  case ",$options," in
    *",$option,"*) ;;
    *)
      printf '%s\n' "$V3_POSTGRES_DATA_ROOT is missing mount option $option" >&2
      exit 1
      ;;
  esac
done

printf '%s\n' 'V3 PostgreSQL storage preflight passed.'
