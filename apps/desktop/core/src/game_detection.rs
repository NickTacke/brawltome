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
const ADDR_RETRY_INTERVAL: Duration = Duration::from_secs(5);
/// Delay before re-fetching opponent data (gives API time to refresh stale data)
const REFETCH_DELAY: Duration = Duration::from_secs(2);

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
    let total = memory::region_stats(&regions);
    log::info!(
        "Attached to Brawlhalla (PID: {pid}), {} regions, {:.1} MB total",
        regions.len(),
        total as f64 / 1048576.0,
    );

    let mut cache = memory::RegionCache::new(regions);

    // ── Find BhID ──────────────────────────────────────────────────────────
    let my_bhid = loop {
        let t = std::time::Instant::now();
        match scanner::find_my_bhid(handle.0, &mut cache) {
            Some(bhid) => {
                log::info!("find_my_bhid scan took {:.1}s", t.elapsed().as_secs_f32());
                break bhid;
            }
            None => {
                log::debug!("Waiting for login... (scan took {:.1}s)", t.elapsed().as_secs_f32());
                sleep(RECONNECT_DELAY).await;
            }
        }
    };
    log::info!("Found local BhID: {my_bhid}");

    // ── Find 04c address ───────────────────────────────────────────────────
    let t = std::time::Instant::now();
    let mut addr_04c: Option<usize> = scanner::find_04c_addr(handle.0, my_bhid, &cache);
    log::info!("find_04c_addr scan took {:.1}s", t.elapsed().as_secs_f32());
    if addr_04c.is_some() {
        log::info!("Found connection state address");
    }

    // ── State machine ──────────────────────────────────────────────────────
    let mut state = ScannerState::Idle;
    let mut prev_04c: u32 = 0;
    let mut players: std::collections::HashMap<u32, scanner::PlayerInfo> = std::collections::HashMap::new();
    let mut opened: HashSet<u32> = HashSet::new();
    let mut stale_addrs: HashSet<usize> = HashSet::new();

    let mut opponent_cache: std::collections::HashMap<u32, OpponentData> = std::collections::HashMap::new();
    let mut refetch_at: Option<tokio::time::Instant> = None;
    let mut last_scan = tokio::time::Instant::now() - SCAN_INTERVAL_SCANNING;
    let mut last_addr_retry = tokio::time::Instant::now() - ADDR_RETRY_INTERVAL;
    let mut scan_in_flight = false;
    let detection = Arc::new(Mutex::new(DetectionState::default()));

    loop {
        // ── Try to find 04c if we don't have it yet ────────────────────
        if addr_04c.is_none() && last_addr_retry.elapsed() >= ADDR_RETRY_INTERVAL {
            last_addr_retry = tokio::time::Instant::now();
            let t = std::time::Instant::now();
            addr_04c = scanner::find_04c_addr(handle.0, my_bhid, &cache);
            log::debug!("find_04c scan took {:.1}s", t.elapsed().as_secs_f32());
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
                        let prev_state = state;
                        handle_state_transition(
                            cur_04c, &mut state, &mut players, &mut opened,
                            &mut opponent_cache, &mut refetch_at, &mut stale_addrs,
                            handle, my_bhid, &cache, app,
                        );
                        // Refresh regions when entering a match (game allocates new memory)
                        if state == ScannerState::Scanning && prev_state == ScannerState::Idle {
                            let new_regions = memory::heap_regions(handle.0);
                            cache = memory::RegionCache::new(new_regions);
                            // Re-learn prefix from fresh scan
                            let bhid_bytes = my_bhid.to_le_bytes();
                            let bhid_addrs = memory::scan_regions_with_buf(
                                handle.0, &cache.regions, &bhid_bytes, &mut Vec::new()
                            );
                            cache.learn_prefix(&bhid_addrs);
                            log::info!("Refreshed regions: {} regions, prefix=0x{:08X}, {:.1} MB heap",
                                cache.regions.len(),
                                cache.heap_prefix.unwrap_or(0),
                                cache.heap_stats(None).0 as f64 / 1048576.0);
                        }
                        // Reset match_active when returning to idle
                        if state == ScannerState::Idle && prev_state != ScannerState::Idle {
                            let mut st = detection.lock().await;
                            st.match_active = false;
                        }
                    }
                }
                None => {
                    memory::close_handle(handle.0);
                    return Err("Brawlhalla closed".into());
                }
            }
        }

        // ── Run player scan if needed ──────────────────────────────────
        if !scan_in_flight && state == ScannerState::Scanning {
            if last_scan.elapsed() >= SCAN_INTERVAL_SCANNING {
                scan_in_flight = true;
                last_scan = tokio::time::Instant::now();

                let t = std::time::Instant::now();
                let current_players = scanner::get_players(handle.0, my_bhid, &cache, &stale_addrs);
                log::debug!("get_players scan took {:.2}s, found {} players", t.elapsed().as_secs_f32(), current_players.len());
                players = current_players;

                // Transition from Scanning → Tracking on first results
                if !players.is_empty() && state == ScannerState::Scanning {
                    state = ScannerState::Tracking;
                    log::info!("Tracking {} players", players.len());
                }

                // Find opponents and fetch/refresh their data
                if state == ScannerState::Tracking {
                    let opponents: Vec<_> = players.values()
                        .filter(|p| p.bhid != my_bhid && !p.is_teammate)
                        .cloned()
                        .collect();

                    if !opponents.is_empty() {
                        let new_opponents: Vec<_> = opponents.iter()
                            .filter(|p| !opened.contains(&p.bhid))
                            .collect();

                        let has_new = !new_opponents.is_empty();

                        // Fetch data for any new opponents
                        if has_new {
                            let mut fetches = Vec::new();
                            for opp in &new_opponents {
                                let api = Arc::clone(&api);
                                let bhid = opp.bhid;
                                fetches.push(tokio::spawn(async move {
                                    api.fetch_opponent(bhid).await
                                }));
                            }

                            for task in fetches {
                                match task.await {
                                    Ok(Ok(data)) => { opponent_cache.insert(data.brawlhalla_id, data); }
                                    Ok(Err(e)) => log::warn!("Failed to fetch opponent: {e}"),
                                    Err(e) => log::warn!("Fetch task panicked: {e}"),
                                }
                            }

                            for opp in new_opponents {
                                opened.insert(opp.bhid);
                            }

                            // Schedule a re-fetch so the API has time to refresh stale data
                            refetch_at = Some(tokio::time::Instant::now() + REFETCH_DELAY);
                        }

                        // Emit current opponent data to frontend (always, so UI stays in sync)
                        let opponent_data: Vec<_> = opponents.iter()
                            .filter_map(|p| opponent_cache.get(&p.bhid).cloned())
                            .collect();

                        if !opponent_data.is_empty() {
                            let mut st = detection.lock().await;
                            st.match_active = true;
                            st.local_player_id = my_bhid;

                            let is_ranked = opponents.len() == 1;
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
                }

                scan_in_flight = false;
            }
        }

        // Re-fetch all cached opponents to pick up refreshed data from the API
        if let Some(at) = refetch_at {
            if tokio::time::Instant::now() >= at {
                refetch_at = None;
                log::info!("Re-fetching opponent data after API refresh...");
                let bhids: Vec<u32> = opponent_cache.keys().copied().collect();
                let mut fetches = Vec::new();
                for bhid in bhids {
                    let api = Arc::clone(&api);
                    fetches.push(tokio::spawn(async move {
                        api.fetch_opponent(bhid).await
                    }));
                }
                for task in fetches {
                    match task.await {
                        Ok(Ok(data)) => { opponent_cache.insert(data.brawlhalla_id, data); }
                        Ok(Err(e)) => log::warn!("Re-fetch failed: {e}"),
                        Err(e) => log::warn!("Re-fetch task panicked: {e}"),
                    }
                }

                // Emit updated data
                let opponent_data: Vec<_> = opponent_cache.values().cloned().collect();
                if !opponent_data.is_empty() {
                    let is_ranked = opponent_data.len() == 1;
                    let payload = MatchFoundPayload {
                        event: "match_found",
                        opponents: opponent_data,
                        is_ranked,
                        local_player_id: my_bhid,
                    };
                    if let Err(e) = app.emit("game-event", &payload) {
                        log::error!("Failed to emit refreshed data: {e}");
                    }
                }
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
    opponent_cache: &mut std::collections::HashMap<u32, OpponentData>,
    refetch_at: &mut Option<tokio::time::Instant>,
    stale_addrs: &mut HashSet<usize>,
    handle: SendHandle,
    my_bhid: u32,
    cache: &memory::RegionCache,
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
            *stale_addrs = scanner::snapshot_stale(handle.0, my_bhid, cache);
            *state = ScannerState::Idle;
            players.clear();
            opened.clear();
            opponent_cache.clear();
            *refetch_at = None;
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
            scanner::dump_bhid_context(handle.0, my_bhid, cache);
        }
    }
}
