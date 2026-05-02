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

#[derive(Debug, Serialize, Clone)]
struct ScanningPayload {
    event: &'static str,
}

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

const POLL_INTERVAL: Duration = Duration::from_millis(100);
const SCAN_INTERVAL_SCANNING: Duration = Duration::from_secs(3);
const SCAN_INTERVAL_TRACKING: Duration = Duration::from_secs(10);
const RECONNECT_DELAY: Duration = Duration::from_secs(3);
const ADDR_RETRY_INTERVAL: Duration = Duration::from_secs(5);
/// Delay before re-fetching opponent data (gives API time to refresh stale data)
const REFETCH_DELAY: Duration = Duration::from_secs(2);

struct CycleState {
    handle: SendHandle,
    my_bhid: u32,
    cache: memory::RegionCache,
    addr_04c: Option<usize>,
    state: ScannerState,
    prev_04c: u32,
    players: std::collections::HashMap<u32, scanner::PlayerInfo>,
    opened: HashSet<u32>,
    stale_addrs: HashSet<usize>,
    opponent_cache: std::collections::HashMap<u32, OpponentData>,
    refetch_at: Option<tokio::time::Instant>,
    last_scan: tokio::time::Instant,
    last_addr_retry: tokio::time::Instant,
    scan_in_flight: bool,
    needs_region_refresh: bool,
    detection: Arc<Mutex<DetectionState>>,
}

impl CycleState {
    fn new(handle: SendHandle, my_bhid: u32, cache: memory::RegionCache, addr_04c: Option<usize>) -> Self {
        Self {
            handle,
            my_bhid,
            cache,
            addr_04c,
            state: ScannerState::Idle,
            prev_04c: 0,
            players: std::collections::HashMap::new(),
            opened: HashSet::new(),
            stale_addrs: HashSet::new(),
            opponent_cache: std::collections::HashMap::new(),
            refetch_at: None,
            last_scan: tokio::time::Instant::now() - SCAN_INTERVAL_SCANNING,
            last_addr_retry: tokio::time::Instant::now() - ADDR_RETRY_INTERVAL,
            scan_in_flight: false,
            needs_region_refresh: false,
            detection: Arc::new(Mutex::new(DetectionState::default())),
        }
    }

    fn handle_state_transition(&mut self, cur_04c: u32, app: &tauri::AppHandle) {
        if scanner::is_menu(cur_04c) {
            if self.state != ScannerState::Idle {
                if self.state == ScannerState::Scanning
                    || self.state == ScannerState::Tracking
                    || self.state == ScannerState::Paused
                {
                    let payload = MatchEndedPayload { event: "match_ended" };
                    if let Err(e) = app.emit("game-event", &payload) {
                        log::error!("Failed to emit match_ended: {e}");
                    }
                }
                self.stale_addrs = scanner::snapshot_stale(self.handle.0, self.my_bhid, &self.cache);
                self.state = ScannerState::Idle;
                self.players.clear();
                self.opened.clear();
                self.opponent_cache.clear();
                self.refetch_at = None;
                log::info!("Menu");
            }
        } else if scanner::is_ignored(cur_04c) {
            // Replay, etc.
        } else if scanner::is_paused(cur_04c) {
            if self.state == ScannerState::Scanning || self.state == ScannerState::Tracking {
                self.state = ScannerState::Paused;
                log::info!("Paused");
            }
        } else if scanner::is_char_select(cur_04c) {
            if self.state == ScannerState::Idle {
                self.state = ScannerState::Scanning;
                self.players.clear();
                self.opened.clear();
                log::info!("Character select — pre-scanning to prime cache");
            }
        } else if scanner::is_active_game(cur_04c) {
            if self.state == ScannerState::Paused {
                self.state = ScannerState::Tracking;
                log::info!("Resumed");
            } else if self.state == ScannerState::Idle || self.state == ScannerState::Scanning {
                if self.state == ScannerState::Idle {
                    self.players.clear();
                    self.opened.clear();
                }
                self.state = ScannerState::Scanning;
                log::info!("Match detected, scanning...");
                let _ = app.emit("game-event", &ScanningPayload { event: "scanning" });
            }
        }
    }

    async fn scan_and_track(&mut self, api: &Arc<ApiClient>, app: &tauri::AppHandle) {
        if self.scan_in_flight || self.state != ScannerState::Scanning {
            return;
        }
        if self.last_scan.elapsed() < SCAN_INTERVAL_SCANNING {
            return;
        }

        self.scan_in_flight = true;
        self.last_scan = tokio::time::Instant::now();

        let t = std::time::Instant::now();
        let current_players = scanner::get_players(self.handle.0, self.my_bhid, &mut self.cache, &self.stale_addrs);
        log::debug!("get_players scan took {:.2}s, found {} players", t.elapsed().as_secs_f32(), current_players.len());
        self.players = current_players;

        if self.players.is_empty() && self.needs_region_refresh {
            self.needs_region_refresh = false;
            let saved_atom_prefix = self.cache.atom_prefix;
            let new_regions = memory::heap_regions(self.handle.0);
            self.cache = memory::RegionCache::new(new_regions);
            self.cache.atom_prefix = saved_atom_prefix;
            log::info!("Refreshed regions: {} regions (players not found in cached regions)",
                self.cache.regions.len());
            let t2 = std::time::Instant::now();
            let retry = scanner::get_players(self.handle.0, self.my_bhid, &mut self.cache, &self.stale_addrs);
            log::debug!("get_players retry took {:.2}s, found {} players", t2.elapsed().as_secs_f32(), retry.len());
            self.players = retry;
        }

        if !self.players.is_empty() && self.state == ScannerState::Scanning {
            self.state = ScannerState::Tracking;
            log::info!("Tracking {} players", self.players.len());
        }

        if self.state == ScannerState::Tracking {
            let opponents: Vec<_> = self.players.values()
                .filter(|p| p.bhid != self.my_bhid && !p.is_teammate)
                .cloned()
                .collect();

            if !opponents.is_empty() {
                let new_opponents: Vec<_> = opponents.iter()
                    .filter(|p| !self.opened.contains(&p.bhid))
                    .collect();

                let has_new = !new_opponents.is_empty();

                if has_new {
                    let mut fetches = Vec::new();
                    for opp in &new_opponents {
                        let api = Arc::clone(api);
                        let bhid = opp.bhid;
                        fetches.push(tokio::spawn(async move {
                            api.fetch_opponent(bhid).await
                        }));
                    }

                    for task in fetches {
                        match task.await {
                            Ok(Ok(data)) => { self.opponent_cache.insert(data.brawlhalla_id, data); }
                            Ok(Err(e)) => log::warn!("Failed to fetch opponent: {e}"),
                            Err(e) => log::warn!("Fetch task panicked: {e}"),
                        }
                    }

                    for opp in new_opponents {
                        self.opened.insert(opp.bhid);
                    }

                    self.refetch_at = Some(tokio::time::Instant::now() + REFETCH_DELAY);
                }

                let opponent_data: Vec<_> = opponents.iter()
                    .filter_map(|p| self.opponent_cache.get(&p.bhid).cloned())
                    .collect();

                if !opponent_data.is_empty() {
                    let mut st = self.detection.lock().await;
                    st.match_active = true;
                    st.local_player_id = self.my_bhid;

                    let is_ranked = opponents.len() == 1;
                    let payload = MatchFoundPayload {
                        event: "match_found",
                        opponents: opponent_data,
                        is_ranked,
                        local_player_id: self.my_bhid,
                    };
                    if let Err(e) = app.emit("game-event", &payload) {
                        log::error!("Failed to emit match_found: {e}");
                    }
                }
            }
        }

        self.scan_in_flight = false;
    }

    async fn refetch_and_emit(&mut self, api: &Arc<ApiClient>, app: &tauri::AppHandle) {
        match self.refetch_at {
            Some(at) if tokio::time::Instant::now() >= at => {}
            _ => return,
        }

        self.refetch_at = None;
        log::info!("Re-fetching opponent data after API refresh...");
        let bhids: Vec<u32> = self.opponent_cache.keys().copied().collect();
        let mut fetches = Vec::new();
        for bhid in bhids {
            let api = Arc::clone(api);
            fetches.push(tokio::spawn(async move {
                api.fetch_opponent(bhid).await
            }));
        }
        for task in fetches {
            match task.await {
                Ok(Ok(data)) => { self.opponent_cache.insert(data.brawlhalla_id, data); }
                Ok(Err(e)) => log::warn!("Re-fetch failed: {e}"),
                Err(e) => log::warn!("Re-fetch task panicked: {e}"),
            }
        }

        let opponent_data: Vec<_> = self.opponent_cache.values().cloned().collect();
        if !opponent_data.is_empty() {
            let is_ranked = opponent_data.len() == 1;
            let payload = MatchFoundPayload {
                event: "match_found",
                opponents: opponent_data,
                is_ranked,
                local_player_id: self.my_bhid,
            };
            if let Err(e) = app.emit("game-event", &payload) {
                log::error!("Failed to emit refreshed data: {e}");
            }
        }
    }
}

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

async fn attach_to_process() -> Result<(SendHandle, memory::RegionCache), String> {
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

    let cache = memory::RegionCache::new(regions);
    Ok((handle, cache))
}

async fn find_local_player(handle: SendHandle, cache: &mut memory::RegionCache) -> u32 {
    let my_bhid = loop {
        let t = std::time::Instant::now();
        match scanner::find_my_bhid(handle.0, cache) {
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
    my_bhid
}

async fn run_cycle(
    app: &tauri::AppHandle,
    api: Arc<ApiClient>,
) -> Result<(), String> {
    let (handle, mut cache) = attach_to_process().await?;
    let my_bhid = find_local_player(handle, &mut cache).await;

    let t = std::time::Instant::now();
    let addr_04c = scanner::find_04c_addr(handle.0, my_bhid, &cache);
    log::info!("find_04c_addr scan took {:.1}s", t.elapsed().as_secs_f32());
    if addr_04c.is_some() {
        log::info!("Found connection state address");
    }

    let mut cycle = CycleState::new(handle, my_bhid, cache, addr_04c);

    loop {
        if cycle.addr_04c.is_none() && cycle.last_addr_retry.elapsed() >= ADDR_RETRY_INTERVAL {
            cycle.last_addr_retry = tokio::time::Instant::now();
            let t = std::time::Instant::now();
            cycle.addr_04c = scanner::find_04c_addr(cycle.handle.0, cycle.my_bhid, &cycle.cache);
            log::debug!("find_04c scan took {:.1}s", t.elapsed().as_secs_f32());
            if cycle.addr_04c.is_some() {
                log::info!("Found connection state address");
            }
        }

        if let Some(addr) = cycle.addr_04c {
            match scanner::read_04c(cycle.handle.0, addr) {
                Some(cur_04c) => {
                    if cur_04c != cycle.prev_04c {
                        cycle.prev_04c = cur_04c;
                        let prev_state = cycle.state;
                        cycle.handle_state_transition(cur_04c, app);
                        if cycle.state == ScannerState::Scanning {
                            cycle.needs_region_refresh = true;
                        }
                        if cycle.state == ScannerState::Idle && prev_state != ScannerState::Idle {
                            let mut st = cycle.detection.lock().await;
                            st.match_active = false;
                        }
                    }
                }
                None => {
                    memory::close_handle(cycle.handle.0);
                    return Err("Brawlhalla closed".into());
                }
            }
        }

        cycle.scan_and_track(&api, app).await;
        cycle.refetch_and_emit(&api, app).await;

        sleep(POLL_INTERVAL).await;
    }
}
