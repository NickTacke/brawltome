//! Bridge between detection's typed GameEvent channel and the Tauri-emit-to-React contract.
//! Owns BhID enrichment via api_client and the 2s post-MatchStarted refetch.
//! Also maintains a shared snapshot of lifecycle state so the frontend can
//! query its current detection status on mount (Tauri events are not buffered
//! for late subscribers; if the user opens Brawlhalla before BrawlTome's
//! webview finishes loading, the early Attached/Ready emissions are otherwise
//! lost).

use std::sync::{Arc, Mutex};

#[cfg(target_os = "windows")]
use brawltome_events::{DetectionConfig, DetectionService, GameEvent};

#[cfg(target_os = "windows")]
use crate::api_client;

/// Live snapshot of detection's lifecycle. Bridge writes; the React side reads
/// once on mount via the `get_detection_state` Tauri command to recover from
/// missed early events. Behind a Mutex so the snapshot read returns a
/// coherent view of all four fields rather than a cross-update tear (which
/// could happen with separate Relaxed atomics under weak memory ordering on
/// ARM).
#[derive(Default)]
struct DetectionStateInner {
    attached: bool,
    ready: bool,
    bhid: Option<u32>,
    match_active: bool,
}

pub struct DetectionState {
    inner: Mutex<DetectionStateInner>,
}

impl DetectionState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(DetectionStateInner::default()),
        })
    }

    fn snapshot(&self) -> DetectionStateSnapshot {
        let inner = self.inner.lock().unwrap();
        DetectionStateSnapshot {
            attached: inner.attached,
            ready: inner.ready,
            bhid: inner.bhid,
            match_active: inner.match_active,
        }
    }

    fn on_attached(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.attached = true;
        inner.ready = false;
        inner.bhid = None;
    }

    fn on_detached(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.attached = false;
        inner.ready = false;
        inner.bhid = None;
        inner.match_active = false;
    }

    fn on_ready(&self) {
        self.inner.lock().unwrap().ready = true;
    }

    fn on_local_player_found(&self, bhid: u32) {
        self.inner.lock().unwrap().bhid = Some(bhid);
    }

    fn on_match_started(&self) {
        self.inner.lock().unwrap().match_active = true;
    }

    fn on_match_ended(&self) {
        self.inner.lock().unwrap().match_active = false;
    }
}

#[derive(serde::Serialize)]
pub struct DetectionStateSnapshot {
    attached: bool,
    ready: bool,
    bhid: Option<u32>,
    #[serde(rename = "matchActive")]
    match_active: bool,
}

#[tauri::command]
pub fn get_detection_state(state: tauri::State<'_, Arc<DetectionState>>) -> DetectionStateSnapshot {
    state.snapshot()
}

#[cfg(target_os = "windows")]
#[derive(serde::Serialize, Clone)]
struct LegacyMatchFound {
    event: &'static str,
    opponents: Vec<api_client::OpponentData>,
    #[serde(rename = "isRanked")]
    is_ranked: bool,
    #[serde(rename = "localPlayerId")]
    local_player_id: u32,
}

#[cfg(target_os = "windows")]
#[derive(serde::Serialize, Clone)]
struct LegacyMatchEnded {
    event: &'static str,
}

#[cfg(target_os = "windows")]
#[derive(serde::Serialize, Clone)]
struct LegacyScanning {
    event: &'static str,
}

#[cfg(target_os = "windows")]
#[derive(serde::Serialize, Clone)]
struct LegacyAttached {
    event: &'static str,
}

#[cfg(target_os = "windows")]
#[derive(serde::Serialize, Clone)]
struct LegacyDetached {
    event: &'static str,
}

#[cfg(target_os = "windows")]
#[derive(serde::Serialize, Clone)]
struct LegacyReady {
    event: &'static str,
}

#[cfg(target_os = "windows")]
#[derive(serde::Serialize, Clone)]
struct LegacyLocalPlayerFound {
    event: &'static str,
    bhid: u32,
}

/// Spawn the bridge task. Builds an ApiClient from BRAWLTOME_API_URL (default
/// https://api.brawltome.app), starts WindowsDetectionService, and forwards
/// enriched events to the React UI on the "game-event" Tauri channel. Also
/// updates the shared DetectionState so a late-mounting frontend can recover
/// the current lifecycle status via `get_detection_state`.
#[cfg(target_os = "windows")]
pub fn spawn(app: &tauri::AppHandle, state: Arc<DetectionState>) {
    let app_handle = app.clone();
    let api_url = std::env::var("BRAWLTOME_API_URL")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "https://api.brawltome.app".into());

    tauri::async_runtime::spawn(async move {
        use std::collections::HashMap;
        use tauri::Emitter;

        /// Delay before refetching opponent data after a match starts.
        /// Gives the BrawlTome backend a moment to ingest fresh data
        /// from the prior match before we re-query.
        const REFETCH_DELAY: std::time::Duration = std::time::Duration::from_secs(2);

        let api = std::sync::Arc::new(api_client::ApiClient::new(api_url));
        let (event_tx, mut event_rx) = tokio::sync::mpsc::channel::<GameEvent>(32);

        // Now inside Tokio runtime context, so the inner `tokio::spawn` in start() works.
        let svc = brawltome_detection::WindowsDetectionService;
        let _detection_handle = match svc.start(
            DetectionConfig {
                target_process: "Brawlhalla.exe".into(),
                poll_interval_ms: 100,
            },
            event_tx,
        ) {
            Ok(handle) => handle,
            Err(err) => {
                log::error!("Detection failed to start: {err}");
                return;
            }
        };

        let mut opponent_cache: HashMap<u32, api_client::OpponentData> = HashMap::new();
        let mut pending_refetch: Option<tokio::task::JoinHandle<()>> = None;

        while let Some(event) = event_rx.recv().await {
            match event {
                GameEvent::Scanning(_) => {
                    let _ = app_handle.emit("game-event", &LegacyScanning { event: "scanning" });
                }
                GameEvent::Attached(_) => {
                    state.on_attached();
                    let _ = app_handle.emit("game-event", &LegacyAttached { event: "attached" });
                }
                GameEvent::Detached(_) => {
                    state.on_detached();
                    if let Some(h) = pending_refetch.take() {
                        h.abort();
                    }
                    opponent_cache.clear();
                    let _ = app_handle.emit("game-event", &LegacyDetached { event: "detached" });
                }
                GameEvent::Ready(_) => {
                    state.on_ready();
                    let _ = app_handle.emit("game-event", &LegacyReady { event: "ready" });
                }
                GameEvent::LocalPlayerFound(p) => {
                    state.on_local_player_found(p.bhid);
                    let _ = app_handle.emit(
                        "game-event",
                        &LegacyLocalPlayerFound { event: "local_player_found", bhid: p.bhid },
                    );
                }
                GameEvent::MatchEnded(p) => {
                    state.on_match_ended();
                    if let Some(h) = pending_refetch.take() {
                        h.abort();
                    }
                    opponent_cache.clear();
                    let _ = app_handle.emit("game-event", &LegacyMatchEnded { event: "match_ended" });
                    let _ = p; // local_player_bhid currently unused on the React side
                }
                GameEvent::MatchStarted(p) => {
                    state.on_match_started();
                    if let Some(h) = pending_refetch.take() {
                        h.abort();
                    }

                    // Initial fetch for any uncached BhIDs.
                    let new_bhids: Vec<u32> = p.opponent_bhids.iter()
                        .filter(|bhid| !opponent_cache.contains_key(bhid))
                        .copied()
                        .collect();

                    let mut fetches = Vec::new();
                    for bhid in new_bhids {
                        let api = api.clone();
                        fetches.push(tokio::spawn(async move {
                            (bhid, api.fetch_opponent(bhid).await)
                        }));
                    }
                    for task in fetches {
                        match task.await {
                            Ok((bhid, Ok(data))) => { opponent_cache.insert(bhid, data); }
                            Ok((bhid, Err(e))) => log::warn!("Failed to fetch bhid {bhid}: {e}"),
                            Err(e) => log::warn!("Fetch task panicked: {e}"),
                        }
                    }

                    let opponents: Vec<api_client::OpponentData> = p.opponent_bhids.iter()
                        .filter_map(|bhid| opponent_cache.get(bhid).cloned())
                        .collect();

                    let is_ranked = matches!(
                        p.match_type,
                        brawltome_events::MatchType::Ranked1v1
                            | brawltome_events::MatchType::Ranked2v2
                            | brawltome_events::MatchType::Ranked3v3
                    );

                    if !opponents.is_empty() {
                        let _ = app_handle.emit("game-event", &LegacyMatchFound {
                            event: "match_found",
                            opponents,
                            is_ranked,
                            local_player_id: p.local_player_bhid,
                        });
                    }

                    // Schedule a refetch to pick up backend updates that arrived
                    // after the initial fetch. Seed `fresh` with the previously
                    // cached opponents so a partial refetch failure preserves
                    // what the user was already seeing instead of removing them.
                    let api_for_refetch = api.clone();
                    let app_handle_for_refetch = app_handle.clone();
                    let opponent_bhids = p.opponent_bhids.clone();
                    let local_player_bhid = p.local_player_bhid;
                    let cached_opponents: HashMap<u32, api_client::OpponentData> = p
                        .opponent_bhids
                        .iter()
                        .filter_map(|bhid| {
                            opponent_cache.get(bhid).cloned().map(|data| (*bhid, data))
                        })
                        .collect();
                    pending_refetch = Some(tokio::spawn(async move {
                        tokio::time::sleep(REFETCH_DELAY).await;

                        let mut fresh = cached_opponents;
                        let mut fetches = Vec::new();
                        for bhid in &opponent_bhids {
                            let api = api_for_refetch.clone();
                            let bhid = *bhid;
                            fetches.push(tokio::spawn(async move {
                                (bhid, api.fetch_opponent(bhid).await)
                            }));
                        }
                        for task in fetches {
                            match task.await {
                                Ok((bhid, Ok(data))) => { fresh.insert(bhid, data); }
                                Ok((bhid, Err(e))) => log::warn!("Refetch failed for bhid {bhid}: {e}"),
                                Err(e) => log::warn!("Refetch task panicked: {e}"),
                            }
                        }

                        let opponents: Vec<api_client::OpponentData> = opponent_bhids.iter()
                            .filter_map(|bhid| fresh.get(bhid).cloned())
                            .collect();

                        if !opponents.is_empty() {
                            let _ = app_handle_for_refetch.emit("game-event", &LegacyMatchFound {
                                event: "match_found",
                                opponents,
                                is_ranked,
                                local_player_id: local_player_bhid,
                            });
                        }
                    }));
                }
                GameEvent::OffsetsBroken(_) => {
                    log::warn!("Memory offsets appear broken");
                }
            }
        }
    });
}

/// No-op on non-Windows so call sites don't need cfg gating.
#[cfg(not(target_os = "windows"))]
pub fn spawn(_app: &tauri::AppHandle, _state: Arc<DetectionState>) {}
