#!/usr/bin/env bash
set -euo pipefail

(( EUID == 0 )) || { printf '%s\n' 'Run as root' >&2; exit 1; }
repository_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
environment_file=/etc/brawltome/backup-integrity.env

for command in awk flock gzip mkfifo mktemp python3 rclone sha256sum systemctl tee useradd; do
  command -v "$command" >/dev/null || { printf 'Required command is unavailable: %s\n' "$command" >&2; exit 1; }
done
[[ -r $environment_file ]] || { printf '%s\n' "$environment_file is unreadable" >&2; exit 1; }
[[ $(stat -c '%a' "$environment_file") == 600 ]] || { printf '%s\n' "$environment_file must have mode 600" >&2; exit 1; }

if ! id -u brawltome-backup-integrity >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin \
    brawltome-backup-integrity
fi
install -d -m 0755 /usr/local/libexec
install -d -o brawltome-backup-integrity -g brawltome-backup-integrity -m 0755 \
  /srv/brawltome-observability/backup-integrity
install -m 0755 "$repository_root/infra/app/backups/verify-dokploy-backup-integrity.sh" \
  /usr/local/libexec/brawltome-verify-backup-integrity
install -m 0644 "$repository_root/infra/app/backups/systemd/brawltome-backup-integrity.service" \
  /etc/systemd/system/brawltome-backup-integrity.service
install -m 0644 "$repository_root/infra/app/backups/systemd/brawltome-backup-integrity.timer" \
  /etc/systemd/system/brawltome-backup-integrity.timer
systemctl daemon-reload
systemctl enable --now brawltome-backup-integrity.timer
printf '%s\n' 'BrawlTome backup integrity timer installed.'
