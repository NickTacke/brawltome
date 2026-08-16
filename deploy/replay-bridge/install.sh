#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 || $# -ne 3 ]]; then
	echo "usage: sudo $0 <linux-bridge-binary> <brawltome-bridge-token-file> <processor-token-file>" >&2
	exit 64
fi

binary=$(realpath "$1")
bridge_token=$(realpath "$2")
processor_token=$(realpath "$3")
unit=$(realpath "$(dirname "$0")/brawltome-replay-bridge.service")

test -x "$binary"
test -s "$bridge_token"
test -s "$processor_token"
getent group replay-bridge >/dev/null || groupadd --system replay-bridge

if ! id replay-bridge >/dev/null 2>&1; then
	useradd --system --no-create-home --shell /usr/sbin/nologin --gid replay-bridge replay-bridge
fi
usermod --gid replay-bridge replay-bridge

install -d -o root -g root -m 0755 /opt/brawltome-replay-bridge /etc/brawltome
install -o root -g root -m 0755 "$binary" /opt/brawltome-replay-bridge/replay-bridge
install -o root -g replay-bridge -m 0640 "$bridge_token" /etc/brawltome/replay-bridge-token
install -o root -g replay-bridge -m 0640 "$processor_token" /etc/brawltome/replay-processor-token
install -o root -g root -m 0644 "$unit" /etc/systemd/system/brawltome-replay-bridge.service
runuser -u replay-bridge -- test -r /etc/brawltome/replay-bridge-token
runuser -u replay-bridge -- test -r /etc/brawltome/replay-processor-token

systemctl daemon-reload
systemctl enable brawltome-replay-bridge.service
systemctl restart brawltome-replay-bridge.service
sleep 2
systemctl is-active --quiet replay-processor.service
systemctl is-active --quiet brawltome-replay-bridge.service
curl --fail --silent --show-error http://127.0.0.1:8080/health/live >/dev/null
