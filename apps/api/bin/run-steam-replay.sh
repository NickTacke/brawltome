#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

export DISPLAY="${DISPLAY:-:99}"
EVIDENCE_DIR="${EVIDENCE_DIR:-/tmp/replay-evidence}"
STEAM_ROOT="${STEAM_ROOT:-$HOME/.steam/debian-installation}"
GAME_DIR="${GAME_DIR:-$STEAM_ROOT/steamapps/common/Brawlhalla}"
COMPAT_USER_DIR="${COMPAT_USER_DIR:-$STEAM_ROOT/steamapps/compatdata/291550/pfx/drive_c/users/steamuser}"
REPLAY_DIR="${REPLAY_DIR:-$COMPAT_USER_DIR/BrawlhallaReplays}"
DUMP_DIR="${DUMP_DIR:-$COMPAT_USER_DIR/BrawlhallaStatDumps}"
EXPECTED_PATCHED_SWF_SHA256="${EXPECTED_PATCHED_SWF_SHA256:-7917260069245f004b851b1407a7914eae8500660609a31892bcd5d79bccf484}"
STEAM_LOGIN_DEADLINE_SECONDS="${STEAM_LOGIN_DEADLINE_SECONDS:-120}"
GAME_BOOT_DEADLINE_SECONDS="${GAME_BOOT_DEADLINE_SECONDS:-120}"
MENU_SETTLE_SECONDS="${MENU_SETTLE_SECONDS:-40}"
REPLAY_LIST_WAIT_SECONDS="${REPLAY_LIST_WAIT_SECONDS:-5}"
FIRST_DUMP_DEADLINE_SECONDS="${FIRST_DUMP_DEADLINE_SECONDS:-90}"
DUMP_COUNT_SETTLE_SECONDS="${DUMP_COUNT_SETTLE_SECONDS:-1}"
PLAYBACK_MODE="${PLAYBACK_MODE:-normal}"
PLAYBACK_CONTROL_DELAY_SECONDS="${PLAYBACK_CONTROL_DELAY_SECONDS:-2}"
EXPECTED_DUMPS="${EXPECTED_DUMPS:-}"
RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)-$$}"
STAGED_REPLAY=""
GAME_STARTED=""
XVFB_PID=""
OPENBOX_PID=""
STEAM_PID=""

log() { printf '[steam-replay] %s\n' "$*"; }

usage() {
	printf 'usage: run-steam-replay <replay.replay> <output-directory>\n'
}

require_positive_integer() {
	local name="$1" value="$2"
	[[ "$value" =~ ^[1-9][0-9]*$ ]] || {
		log "ERROR: $name must be a positive integer, got: $value"
		return 1
	}
}

sha256_file() {
	sha256sum "$1" | awk '{print $1}'
}

cleanup() {
	local status=$?
	trap - EXIT INT TERM HUP
	[ -z "$GAME_STARTED" ] || pkill -x Brawlhalla.exe >/dev/null 2>&1 || true
	[ -z "$STAGED_REPLAY" ] || rm -f "$STAGED_REPLAY"
	[ -z "$STEAM_PID" ] || kill "$STEAM_PID" >/dev/null 2>&1 || true
	[ -z "$OPENBOX_PID" ] || kill "$OPENBOX_PID" >/dev/null 2>&1 || true
	[ -z "$XVFB_PID" ] || kill "$XVFB_PID" >/dev/null 2>&1 || true
	exit "$status"
}
trap cleanup EXIT INT TERM HUP

screenshot() {
	scrot "$EVIDENCE_DIR/$1.png" >/dev/null 2>&1 || true
}

game_alive() {
	pgrep -x Brawlhalla.exe >/dev/null 2>&1
}

wait_with_game_check() {
	local remaining="$1"
	while [ "$remaining" -gt 0 ]; do
		game_alive || {
			log 'ERROR: Brawlhalla exited unexpectedly'
			return 1
		}
		sleep 1
		remaining=$((remaining - 1))
	done
}

minimize_steam_windows() {
	local id class lowered
	while read -r id; do
		[ -n "$id" ] || continue
		class="$(xprop -id "$id" WM_CLASS 2>/dev/null || true)"
		lowered="${class,,}"
		if [[ "$lowered" == *steam* && "$lowered" != *steam_app_291550* ]]; then
			xdotool windowminimize "$id" >/dev/null 2>&1 || true
		fi
	done < <(xdotool search --onlyvisible --name '^[Ss]team$' 2>/dev/null || true)
}

activate_game() {
	local game_window="$1"
	minimize_steam_windows
	xdotool windowactivate --sync "$game_window" >/dev/null 2>&1
}

click_game() {
	local game_window="$1" x="$2" y="$3"
	activate_game "$game_window"
	xdotool mousemove --window "$game_window" "$x" "$y" click 1
}

dump_count() {
	local files=("$DUMP_DIR"/BrawlhallaReplays[0-9]*.json)
	printf '%s\n' "${#files[@]}"
}

terminal_dump_signature() {
	local files=("$DUMP_DIR"/BrawlhallaReplays[0-9]*.json)
	[ "${#files[@]}" -gt 0 ] || return 1
	sha256sum "${files[@]}" | sha256sum | awk '{print $1}'
}

stop_game() {
	local remaining=10
	pkill -x Brawlhalla.exe >/dev/null 2>&1 || true
	while game_alive && [ "$remaining" -gt 0 ]; do
		sleep 1
		remaining=$((remaining - 1))
	done
	if game_alive; then
		pkill -9 -x Brawlhalla.exe >/dev/null 2>&1 || true
	fi
	log 'stopped simulation after terminal snapshots settled'
}

wait_for_first_dumps() {
	local deadline=$((SECONDS + FIRST_DUMP_DEADLINE_SECONDS)) count signature previous_signature="" stable_seconds=0
	while [ "$SECONDS" -lt "$deadline" ]; do
		count="$(dump_count)"
		if [ "$count" -eq "$EXPECTED_DUMPS" ]; then
			if python3 - "$DUMP_DIR" "$EXPECTED_DUMPS" <<'PY'
import glob, json, os, sys
paths = sorted(glob.glob(os.path.join(sys.argv[1], "BrawlhallaReplays[0-9]*.json")), key=lambda path: int(os.path.basename(path).removeprefix("BrawlhallaReplays").removesuffix(".json")))
expected = int(sys.argv[2])
for slot, path in enumerate(paths, 1):
    with open(path, "rb") as source:
        payload = json.load(source)
    if f"Player{slot}" not in payload:
        raise SystemExit(1)
PY
			then
				signature="$(terminal_dump_signature)"
				if [ "$signature" = "$previous_signature" ]; then
					stable_seconds=$((stable_seconds + 1))
				else
					previous_signature="$signature"
					stable_seconds=0
				fi
				if [ "$stable_seconds" -ge "$DUMP_COUNT_SETTLE_SECONDS" ]; then
					log "$count stable terminal native player dumps detected"
					return 0
				fi
			else
				previous_signature=""
				stable_seconds=0
			fi
		elif [ "$count" -gt "$EXPECTED_DUMPS" ]; then
			log "ERROR: expected $EXPECTED_DUMPS dumps, found $count"
			return 1
		else
			previous_signature=""
			stable_seconds=0
		fi
		game_alive || return 1
		sleep 1
	done
	log "ERROR: expected player dumps did not stabilize within $FIRST_DUMP_DEADLINE_SECONDS seconds"
	return 1
}

validate_and_copy_dumps() {
	local output_dir="$1"
	python3 - "$DUMP_DIR" "$output_dir" "$EXPECTED_DUMPS" <<'PY'
import glob
import json
import os
import shutil
import sys

source_dir, output_dir, expected_text = sys.argv[1:]
expected = int(expected_text)
paths = sorted(glob.glob(os.path.join(source_dir, "BrawlhallaReplays[0-9]*.json")), key=lambda path: int(os.path.basename(path).removeprefix("BrawlhallaReplays").removesuffix(".json")))
if len(paths) != expected:
    raise SystemExit(f"expected {expected} terminal player dumps, found {len(paths)}")

payloads = []
for slot, path in enumerate(paths, 1):
    with open(path, "rb") as source:
        payload = json.load(source)
    if f"Player{slot}" not in payload:
        raise SystemExit(f"{os.path.basename(path)} does not contain Player{slot}")
    payloads.append(payload)

destinations = [os.path.join(output_dir, os.path.basename(path)) for path in paths]
try:
    sources = paths
    for path, destination in zip(sources, destinations):
        temporary = destination + ".next"
        shutil.copyfile(path, temporary)
        os.replace(temporary, destination)
except BaseException:
    for destination in destinations:
        for candidate in (destination, destination + ".next"):
            try:
                os.remove(candidate)
            except FileNotFoundError:
                pass
    raise

print(f"copied_terminal_players={len(paths)}")
PY
}

main() {
	[ "$#" -eq 2 ] || {
		usage
		return 2
	}
	local replay="$1" output_dir="$2" command login_log login_start deadline game_window="" playback_started

	for command in dbus-run-session flock openbox pgrep pkill python3 scrot sha256sum xdotool xdpyinfo xprop Xvfb; do
		command -v "$command" >/dev/null 2>&1 || {
			log "ERROR: required command not found: $command"
			return 2
		}
	done
	[ -f "$replay" ] || {
		log "ERROR: replay not found: $replay"
		return 2
	}
	[ -f "$GAME_DIR/Brawlhalla.exe" ] || {
		log "ERROR: game not found in $GAME_DIR"
		return 2
	}
	[ -f "$GAME_DIR/BrawlhallaAir.swf" ] || {
		log "ERROR: SWF not found in $GAME_DIR"
		return 2
	}
	[ -x "$STEAM_ROOT/ubuntu12_32/steam" ] || {
		log "ERROR: Steam client not found in $STEAM_ROOT"
		return 2
	}
	[[ "$EXPECTED_PATCHED_SWF_SHA256" =~ ^[0-9a-f]{64}$ ]] || {
		log 'ERROR: invalid expected SWF SHA-256'
		return 2
	}
	[ "$(sha256_file "$GAME_DIR/BrawlhallaAir.swf")" = "$EXPECTED_PATCHED_SWF_SHA256" ] || {
		log 'ERROR: installed SWF does not match the pinned replay patch'
		return 2
	}
	for command in STEAM_LOGIN_DEADLINE_SECONDS GAME_BOOT_DEADLINE_SECONDS MENU_SETTLE_SECONDS REPLAY_LIST_WAIT_SECONDS FIRST_DUMP_DEADLINE_SECONDS DUMP_COUNT_SETTLE_SECONDS PLAYBACK_CONTROL_DELAY_SECONDS; do
		require_positive_integer "$command" "${!command}"
	done
	[ -n "$EXPECTED_DUMPS" ] || {
		log 'ERROR: EXPECTED_DUMPS is required for fail-closed terminal completion'
		return 2
	}
	require_positive_integer EXPECTED_DUMPS "$EXPECTED_DUMPS"
	case "$PLAYBACK_MODE" in
	normal | seek-end) ;;
	*)
		log "ERROR: PLAYBACK_MODE must be normal or seek-end, got: $PLAYBACK_MODE"
		return 2
		;;
	esac
	mkdir -p "$EVIDENCE_DIR" "$REPLAY_DIR" "$DUMP_DIR" "$output_dir"
	exec 9>"$STEAM_ROOT/.replay-analysis.lock"
	flock -n 9 || {
		log "ERROR: another replay analysis already owns $STEAM_ROOT"
		return 1
	}
	game_alive && {
		log 'ERROR: a Brawlhalla process already exists before launch'
		return 1
	}
	if compgen -G "$output_dir/*.json" >/dev/null; then
		log "ERROR: output directory already contains JSON output: $output_dir"
		return 2
	fi
	if [ ! -e "$HOME/.asoundrc" ]; then
		cp /etc/asound.conf "$HOME/.asoundrc"
		chmod 0644 "$HOME/.asoundrc"
	fi

	STAGED_REPLAY="$REPLAY_DIR/analysis-$RUN_ID.replay"
	cp "$replay" "$STAGED_REPLAY"
	touch "$STAGED_REPLAY"
	rm -f "$DUMP_DIR"/Deaths*.json "$DUMP_DIR"/BrawlhallaReplays*.json "$DUMP_DIR"/\[*json

	log 'starting Xvfb and Openbox'
	Xvfb "$DISPLAY" -screen 0 1280x720x24 -nolisten tcp -noreset >"$EVIDENCE_DIR/replay-xvfb.log" 2>&1 &
	XVFB_PID=$!
	for _ in $(seq 1 50); do
		xdpyinfo -display "$DISPLAY" >/dev/null 2>&1 && break
		sleep 0.1
	done
	xdpyinfo -display "$DISPLAY" >/dev/null
	openbox --sm-disable >"$EVIDENCE_DIR/replay-openbox.log" 2>&1 &
	OPENBOX_PID=$!
	for _ in $(seq 1 50); do
		xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id' && break
		sleep 0.1
	done
	xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'

	login_log="$STEAM_ROOT/logs/steamui_login.txt"
	mkdir -p "$(dirname "$login_log")"
	touch "$login_log"
	login_start="$(wc -l <"$login_log")"
	log 'starting authenticated Steam client'
	dbus-run-session -- bash -c '
	  export DBUS_SYSTEM_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS"
	  exec "$0" -no-cef-sandbox
	' "$STEAM_ROOT/ubuntu12_32/steam" >"$EVIDENCE_DIR/replay-steam.log" 2>&1 &
	STEAM_PID=$!
	deadline=$((SECONDS + STEAM_LOGIN_DEADLINE_SECONDS))
	while [ "$SECONDS" -lt "$deadline" ]; do
		tail -n "+$((login_start + 1))" "$login_log" | grep -q 'SetLoginState: Success' && break
		kill -0 "$STEAM_PID" 2>/dev/null || {
			log 'ERROR: Steam exited during login'
			return 1
		}
		sleep 1
	done
	tail -n "+$((login_start + 1))" "$login_log" | grep -q 'SetLoginState: Success' || {
		log "ERROR: Steam login did not complete within $STEAM_LOGIN_DEADLINE_SECONDS seconds"
		return 1
	}

	log 'launching Brawlhalla in forced-offline replay mode'
	GAME_STARTED=1
	"$STEAM_ROOT/ubuntu12_32/steam" -applaunch 291550 -forceoffline -writestats -tinywindow >"$EVIDENCE_DIR/replay-launch.log" 2>&1 || true
	deadline=$((SECONDS + GAME_BOOT_DEADLINE_SECONDS))
	while [ "$SECONDS" -lt "$deadline" ]; do
		game_window="$(xdotool search --name '^Brawlhalla$' 2>/dev/null | head -1 || true)"
		[ -n "$game_window" ] && game_alive && break
		sleep 1
	done
	[ -n "$game_window" ] && game_alive || {
		log "ERROR: no Brawlhalla process and window within $GAME_BOOT_DEADLINE_SECONDS seconds"
		return 1
	}
	activate_game "$game_window"
	wait_with_game_check "$MENU_SETTLE_SECONDS"
	screenshot 01-forceoffline-warning

	click_game "$game_window" 640 395
	sleep 2
	click_game "$game_window" 1203 52
	sleep "$REPLAY_LIST_WAIT_SECONDS"
	screenshot 02-replay-list
	click_game "$game_window" 700 141
	playback_started=$SECONDS
	log 'started newest staged replay'
	wait_with_game_check "$PLAYBACK_CONTROL_DELAY_SECONDS"
	if [ "$PLAYBACK_MODE" = "seek-end" ]; then
		click_game "$game_window" 1240 670
		log 'requested internal fast-forward near replay end'
	fi

	wait_for_first_dumps
	log "exact terminal player state completed in $((SECONDS - playback_started)) wall seconds"
	screenshot 03-replay-complete
	stop_game
	validate_and_copy_dumps "$output_dir"
	log "run complete: $output_dir"
}

main "$@"
