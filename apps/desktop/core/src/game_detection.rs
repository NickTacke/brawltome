use std::collections::HashSet;
use std::sync::Arc;

use serde::Serialize;
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use windows_sys::Win32::Foundation::HANDLE;

use crate::api_client::{ApiClient, OpponentData};
use crate::memory;
use crate::scanner;

/// Newtype wrapper to make HANDLE Send-safe.
/// Safe because only one async task owns the handle at a time.
#[derive(Copy, Clone)]
struct SendHandle(HANDLE);
unsafe impl Send for SendHandle {}

// ── Frontend event payloads ────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
struct MatchFoundPayload {
    event: &'static str,
    opponents: Vec<OpponentData>,
    #[serde(rename = "isRanked")]
    is_ranked: bool,
    #[serde(rename = "localPlayerId")]
    local_player_id: u32,
}

#[derive(Debug, Serialize, Clone)]
struct MatchEndedPayload {
    event: &'static str,
}

// ── Detection state ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq)]
enum ScannerState {
    Idle,
    Scanning,
    Tracking,
    Paused,
}

struct DetectionState {
    match_active: bool,
    local_player_id: u32,
}

impl Default for DetectionState {
    fn default() -> Self {
        Self {
            match_active: false,
            local_player_id: 0,
        }
    }
}

// ── Timing ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL: Duration = Duration::from_millis(100);
const SCAN_INTERVAL_SCANNING: Duration = Duration::from_secs(3);
const SCAN_INTERVAL_TRACKING: Duration = Duration::from_secs(10);
const RECONNECT_DELAY: Duration = Duration::from_secs(3);

// ── Entry point ────────────────────────────────────────────────────────────────

pub async fn run(app: tauri::AppHandle, api_url: String) {
    let api = Arc::new(ApiClient::new(api_url));

    loop {
        match run_cycle(&app, Arc::clone(&api)).await {
            Ok(()) => log::warn!("Detection cycle ended, restarting..."),
            Err(e) => log::error!("Detection error: {e}, restarting in 3s..."),
        }
        sleep(RECONNECT_DELAY).await;
    }
}

async fn run_cycle(
    app: &tauri::AppHandle,
    api: Arc<ApiClient>,
) -> Result<(), String> {
    // ── Attach to process ──────────────────────────────────────────────────
    let pid = loop {
        match memory::find_process_id("Brawlhalla.exe") {
            Some(pid) => break pid,
            None => {
                log::debug!("Waiting for Brawlhalla...");
                sleep(RECONNECT_DELAY).await;
            }
        }
    };

    let raw_handle = memory::open_process(pid)
        .ok_or("Failed to open process (run as admin)")?;
    let handle = SendHandle(raw_handle);
    let regions = memory::heap_regions(handle.0);
    log::info!("Attached to Brawlhalla (PID: {pid}), {} heap regions", regions.len());

    // ── Find BhID ──────────────────────────────────────────────────────────
    let my_bhid = loop {
        match scanner::find_my_bhid(handle.0, &regions) {
            Some(bhid) => break bhid,
            None => {
                log::debug!("Waiting for login...");
                sleep(RECONNECT_DELAY).await;
            }
        }
    };
    log::info!("Found local BhID: {my_bhid}");

    // ── Find 04c address ───────────────────────────────────────────────────
    let mut addr_04c: Option<usize> = scanner::find_04c_addr(handle.0, my_bhid, &regions);
    if addr_04c.is_some() {
        log::info!("Found connection state address");
    }

    // ── State machine ──────────────────────────────────────────────────────
    let mut state = ScannerState::Idle;
    let mut prev_04c: u32 = 0;
    let mut players: std::collections::HashMap<u32, scanner::PlayerInfo> = std::collections::HashMap::new();
    let mut opened: HashSet<u32> = HashSet::new();
    let mut stale_addrs: HashSet<usize> = HashSet::new();

    let mut last_scan = tokio::time::Instant::now() - SCAN_INTERVAL_SCANNING;
    let mut scan_in_flight = false;
    let detection = Arc::new(Mutex::new(DetectionState::default()));

    loop {
        // ── Try to find 04c if we don't have it yet ────────────────────
        if addr_04c.is_none() {
            addr_04c = scanner::find_04c_addr(handle.0, my_bhid, &regions);
            if addr_04c.is_some() {
                log::info!("Found connection state address");
            }
        }

        // ── Poll 04c ───────────────────────────────────────────────────
        if let Some(addr) = addr_04c {
            match scanner::read_04c(handle.0, addr) {
                Some(cur_04c) => {
                    if cur_04c != prev_04c {
                        prev_04c = cur_04c;
                        handle_state_transition(
                            cur_04c, &mut state, &mut players, &mut opened,
                            &mut stale_addrs, handle, my_bhid, &regions, app,
                        );
                    }
                }
                None => {
                    memory::close_handle(handle.0);
                    return Err("Brawlhalla closed".into());
                }
            }
        }

        // ── Run player scan if needed ──────────────────────────────────
        if !scan_in_flight && (state == ScannerState::Scanning || state == ScannerState::Tracking) {
            let interval = if state == ScannerState::Tracking {
                SCAN_INTERVAL_TRACKING
            } else {
                SCAN_INTERVAL_SCANNING
            };
            if last_scan.elapsed() >= interval {
                scan_in_flight = true;
                last_scan = tokio::time::Instant::now();

                let current_players = scanner::get_players(handle.0, my_bhid, &regions, &stale_addrs);
                players = current_players;

                // Transition from Scanning → Tracking on first results
                if !players.is_empty() && state == ScannerState::Scanning {
                    state = ScannerState::Tracking;
                    log::info!("Tracking {} players", players.len());
                }

                // Find new opponents and fetch their data
                if state == ScannerState::Tracking {
                    let opponents: Vec<_> = players.values()
                        .filter(|p| p.bhid != my_bhid && !p.is_teammate)
                        .cloned()
                        .collect();

                    let new_opponents: Vec<_> = opponents.iter()
                        .filter(|p| !opened.contains(&p.bhid))
                        .collect();

                    if !new_opponents.is_empty() {
                        let mut st = detection.lock().await;
                        if !st.match_active {
                            st.match_active = true;
                            st.local_player_id = my_bhid;

                            // Fetch opponent data concurrently
                            let mut fetches = Vec::new();
                            for opp in &new_opponents {
                                let api = Arc::clone(&api);
                                let bhid = opp.bhid;
                                fetches.push(tokio::spawn(async move {
                                    api.fetch_opponent(bhid).await
                                }));
                            }

                            let mut opponent_data = Vec::new();
                            for task in fetches {
                                match task.await {
                                    Ok(Ok(data)) => opponent_data.push(data),
                                    Ok(Err(e)) => log::warn!("Failed to fetch opponent: {e}"),
                                    Err(e) => log::warn!("Fetch task panicked: {e}"),
                                }
                            }

                            if !opponent_data.is_empty() {
                                let is_ranked = new_opponents.len() == 1;
                                let payload = MatchFoundPayload {
                                    event: "match_found",
                                    opponents: opponent_data,
                                    is_ranked,
                                    local_player_id: my_bhid,
                                };
                                if let Err(e) = app.emit("game-event", &payload) {
                                    log::error!("Failed to emit match_found: {e}");
                                }
                            }
                        }

                        for opp in new_opponents {
                            opened.insert(opp.bhid);
                        }
                    }
                }

                scan_in_flight = false;
            }
        }

        sleep(POLL_INTERVAL).await;
    }
}

fn handle_state_transition(
    cur_04c: u32,
    state: &mut ScannerState,
    players: &mut std::collections::HashMap<u32, scanner::PlayerInfo>,
    opened: &mut HashSet<u32>,
    stale_addrs: &mut HashSet<usize>,
    handle: SendHandle,
    my_bhid: u32,
    regions: &[memory::MemoryRegion],
    app: &tauri::AppHandle,
) {
    if scanner::is_menu(cur_04c) {
        if *state != ScannerState::Idle {
            if *state == ScannerState::Scanning
                || *state == ScannerState::Tracking
                || *state == ScannerState::Paused
            {
                let payload = MatchEndedPayload { event: "match_ended" };
                if let Err(e) = app.emit("game-event", &payload) {
                    log::error!("Failed to emit match_ended: {e}");
                }
            }
            *stale_addrs = scanner::snapshot_stale(handle.0, my_bhid, regions);
            *state = ScannerState::Idle;
            players.clear();
            opened.clear();
            log::info!("Menu");
        }
    } else if scanner::is_ignored(cur_04c) {
        // Replay, etc.
    } else if scanner::is_paused(cur_04c) {
        if *state == ScannerState::Scanning || *state == ScannerState::Tracking {
            *state = ScannerState::Paused;
            log::info!("Paused");
        }
    } else if scanner::is_char_select(cur_04c) {
        if *state == ScannerState::Idle {
            players.clear();
            opened.clear();
            log::info!("Character select");
        }
    } else if scanner::is_active_game(cur_04c) {
        if *state == ScannerState::Paused {
            *state = ScannerState::Tracking;
            log::info!("Resumed");
        } else if *state == ScannerState::Idle {
            *state = ScannerState::Scanning;
            players.clear();
            opened.clear();
            log::info!("Match detected, scanning...");
        }
    }
}
