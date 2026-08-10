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
use crate::{api_client, windows_acceptance};

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

    #[cfg(target_os = "windows")]
    fn on_attached(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.attached = true;
        inner.ready = false;
        inner.bhid = None;
    }

    #[cfg(target_os = "windows")]
    fn on_detached(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.attached = false;
        inner.ready = false;
        inner.bhid = None;
        inner.match_active = false;
    }

    #[cfg(target_os = "windows")]
    fn on_ready(&self) {
        self.inner.lock().unwrap().ready = true;
    }

    #[cfg(target_os = "windows")]
    fn on_local_player_found(&self, bhid: u32) {
        self.inner.lock().unwrap().bhid = Some(bhid);
    }

    #[cfg(target_os = "windows")]
    fn on_match_started(&self) {
        self.inner.lock().unwrap().match_active = true;
    }

    #[cfg(target_os = "windows")]
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
    #[serde(rename = "acceptanceSampleId")]
    acceptance_sample_id: Option<String>,
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
pub fn spawn(
    app: &tauri::AppHandle,
    state: Arc<DetectionState>,
    acceptance_probe: Arc<windows_acceptance::AcceptanceProbe>,
) {
    let app_handle = app.clone();
    let api_url = std::env::var("BRAWLTOME_API_URL")
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "https://api.brawltome.app".into());

    tauri::async_runtime::spawn(async move {
        use std::collections::HashMap;
        use tauri::Emitter;

        const POLL_DEADLINE: std::time::Duration = std::time::Duration::from_secs(30);

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

        let opponent_cache = std::sync::Arc::new(tokio::sync::Mutex::new(HashMap::<
            u32,
            api_client::OpponentData,
        >::new()));
        let mut pending_refetch: Option<tokio::task::JoinHandle<()>> = None;

        while let Some(event) = event_rx.recv().await {
            match event {
                GameEvent::Scanning(_) => {
                    let _ = app_handle.emit("game-event", &LegacyScanning { event: "scanning" });
                }
                GameEvent::Attached(_) => {
                    state.on_attached();
                    for check in [
                        windows_acceptance::AcceptanceCheck::GameProcessDetected,
                        windows_acceptance::AcceptanceCheck::ProcessAttached,
                    ] {
                        if let Err(error) = acceptance_probe.record_check(check) {
                            log::warn!("Could not record game process attachment: {error}");
                        }
                    }
                    let _ = app_handle.emit("game-event", &LegacyAttached { event: "attached" });
                }
                GameEvent::Detached(_) => {
                    state.on_detached();
                    acceptance_probe.abort_opponent_samples();
                    if let Err(error) = acceptance_probe
                        .record_check(windows_acceptance::AcceptanceCheck::ProcessDetached)
                    {
                        log::warn!("Could not record process detachment: {error}");
                    }
                    if let Some(h) = pending_refetch.take() {
                        h.abort();
                    }
                    opponent_cache.lock().await.clear();
                    let _ = app_handle.emit("game-event", &LegacyDetached { event: "detached" });
                }
                GameEvent::Ready(_) => {
                    state.on_ready();
                    if let Err(error) = acceptance_probe
                        .record_check(windows_acceptance::AcceptanceCheck::DetectionReady)
                    {
                        log::warn!("Could not record detection readiness: {error}");
                    }
                    let _ = app_handle.emit("game-event", &LegacyReady { event: "ready" });
                }
                GameEvent::LocalPlayerFound(p) => {
                    state.on_local_player_found(p.bhid);
                    let _ = app_handle.emit(
                        "game-event",
                        &LegacyLocalPlayerFound {
                            event: "local_player_found",
                            bhid: p.bhid,
                        },
                    );
                }
                GameEvent::MatchEnded(p) => {
                    state.on_match_ended();
                    acceptance_probe.abort_opponent_samples();
                    if let Some(h) = pending_refetch.take() {
                        h.abort();
                    }
                    opponent_cache.lock().await.clear();
                    let _ = app_handle.emit(
                        "game-event",
                        &LegacyMatchEnded {
                            event: "match_ended",
                        },
                    );
                    let _ = p; // local_player_bhid currently unused on the React side
                }
                GameEvent::MatchStarted(p) => {
                    state.on_match_started();
                    if let Some(handle) = pending_refetch.take() {
                        handle.abort();
                    }

                    let api_for_lookup = api.clone();
                    let app_handle_for_lookup = app_handle.clone();
                    let opponent_cache_for_lookup = opponent_cache.clone();
                    let opponent_bhids = p.opponent_bhids.clone();
                    let local_player_bhid = p.local_player_bhid;
                    let acceptance_mode = match p.match_type {
                        brawltome_events::MatchType::Ranked1v1 => {
                            windows_acceptance::AcceptanceMode::Ranked1v1
                        }
                        brawltome_events::MatchType::Ranked2v2 => {
                            windows_acceptance::AcceptanceMode::Ranked2v2
                        }
                        brawltome_events::MatchType::Ranked3v3 => {
                            windows_acceptance::AcceptanceMode::Ranked3v3
                        }
                        _ => windows_acceptance::AcceptanceMode::Other,
                    };
                    let is_ranked =
                        !matches!(acceptance_mode, windows_acceptance::AcceptanceMode::Other);
                    if is_ranked {
                        if let Err(error) = acceptance_probe.record_check(
                            windows_acceptance::AcceptanceCheck::RankedOpponentDetected,
                        ) {
                            log::warn!("Could not record ranked opponent detection: {error}");
                        }
                    }
                    let acceptance_sample_id =
                        match acceptance_probe.start_opponent_sample(acceptance_mode) {
                            Ok(sample_id) => sample_id,
                            Err(error) => {
                                log::warn!("Could not start opponent presentation sample: {error}");
                                None
                            }
                        };

                    pending_refetch = Some(tokio::spawn(async move {
                        let mut poll_delays = HashMap::new();
                        let mut fetches = tokio::task::JoinSet::new();
                        for bhid in &opponent_bhids {
                            let bhid = *bhid;
                            let api = api_for_lookup.clone();
                            fetches.spawn(async move { (bhid, api.fetch_opponent(bhid).await) });
                        }

                        while let Some(task) = fetches.join_next().await {
                            match task {
                                Ok((bhid, Ok(lookup))) => {
                                    if let Some(delay) = lookup.poll_after {
                                        poll_delays.insert(bhid, delay);
                                    }
                                    opponent_cache_for_lookup
                                        .lock()
                                        .await
                                        .insert(bhid, lookup.opponent);
                                }
                                Ok((bhid, Err(error))) => {
                                    log::warn!("Failed to fetch bhid {bhid}: {error}");
                                    opponent_cache_for_lookup
                                        .lock()
                                        .await
                                        .entry(bhid)
                                        .and_modify(|cached| {
                                            cached.refresh_state =
                                                api_client::RefreshState::ApiFailure;
                                        })
                                        .or_insert_with(|| {
                                            api_client::OpponentData::api_failure(bhid)
                                        });
                                }
                                Err(error) => log::warn!("Fetch task panicked: {error}"),
                            }

                            let opponents = {
                                let cache = opponent_cache_for_lookup.lock().await;
                                opponent_bhids
                                    .iter()
                                    .filter_map(|bhid| cache.get(bhid).cloned())
                                    .collect()
                            };
                            let _ = app_handle_for_lookup.emit(
                                "game-event",
                                &LegacyMatchFound {
                                    event: "match_found",
                                    opponents,
                                    is_ranked,
                                    local_player_id: local_player_bhid,
                                    acceptance_sample_id: acceptance_sample_id.clone(),
                                },
                            );
                        }

                        let started_at = tokio::time::Instant::now();
                        let deadline = started_at + POLL_DEADLINE;
                        let mut pending: HashMap<u32, tokio::time::Instant> = poll_delays
                            .into_iter()
                            .map(|(bhid, delay)| (bhid, started_at + delay))
                            .collect();

                        while !pending.is_empty() && tokio::time::Instant::now() < deadline {
                            let next_due = pending.values().copied().min().unwrap_or(deadline);
                            if next_due >= deadline {
                                tokio::time::sleep_until(deadline).await;
                                break;
                            }
                            tokio::time::sleep_until(next_due).await;

                            let now = tokio::time::Instant::now();
                            let due_bhids: Vec<u32> = pending
                                .iter()
                                .filter_map(|(bhid, due)| (*due <= now).then_some(*bhid))
                                .collect();
                            let mut poll_fetches = tokio::task::JoinSet::new();
                            for bhid in due_bhids {
                                let api = api_for_lookup.clone();
                                poll_fetches.spawn(async move {
                                    (
                                        bhid,
                                        tokio::time::timeout_at(deadline, api.fetch_opponent(bhid))
                                            .await,
                                    )
                                });
                            }

                            while let Some(task) = poll_fetches.join_next().await {
                                let should_emit = match task {
                                    Ok((bhid, Ok(Ok(lookup)))) => {
                                        pending.remove(&bhid);
                                        if let Some(delay) = lookup.poll_after {
                                            pending
                                                .insert(bhid, tokio::time::Instant::now() + delay);
                                        }
                                        opponent_cache_for_lookup
                                            .lock()
                                            .await
                                            .insert(bhid, lookup.opponent);
                                        true
                                    }
                                    Ok((bhid, Ok(Err(error)))) => {
                                        log::warn!("Poll failed for bhid {bhid}: {error}");
                                        pending.remove(&bhid);
                                        opponent_cache_for_lookup
                                            .lock()
                                            .await
                                            .entry(bhid)
                                            .and_modify(|cached| {
                                                cached.refresh_state =
                                                    api_client::RefreshState::ApiFailure;
                                            })
                                            .or_insert_with(|| {
                                                api_client::OpponentData::api_failure(bhid)
                                            });
                                        true
                                    }
                                    Ok((_bhid, Err(_elapsed))) => false,
                                    Err(error) => {
                                        log::warn!("Poll task panicked: {error}");
                                        false
                                    }
                                };

                                if should_emit {
                                    let opponents = {
                                        let cache = opponent_cache_for_lookup.lock().await;
                                        opponent_bhids
                                            .iter()
                                            .filter_map(|bhid| cache.get(bhid).cloned())
                                            .collect()
                                    };
                                    let _ = app_handle_for_lookup.emit(
                                        "game-event",
                                        &LegacyMatchFound {
                                            event: "match_found",
                                            opponents,
                                            is_ranked,
                                            local_player_id: local_player_bhid,
                                            acceptance_sample_id: acceptance_sample_id.clone(),
                                        },
                                    );
                                }
                            }
                        }

                        let should_emit_deadline = {
                            let mut cache = opponent_cache_for_lookup.lock().await;
                            api_client::finish_poll_deadline(&mut cache, &pending)
                        };
                        if should_emit_deadline {
                            let opponents = {
                                let cache = opponent_cache_for_lookup.lock().await;
                                opponent_bhids
                                    .iter()
                                    .filter_map(|bhid| cache.get(bhid).cloned())
                                    .collect()
                            };
                            let _ = app_handle_for_lookup.emit(
                                "game-event",
                                &LegacyMatchFound {
                                    event: "match_found",
                                    opponents,
                                    is_ranked,
                                    local_player_id: local_player_bhid,
                                    acceptance_sample_id: acceptance_sample_id.clone(),
                                },
                            );
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
pub fn spawn(
    _app: &tauri::AppHandle,
    _state: Arc<DetectionState>,
    _acceptance_probe: Arc<crate::windows_acceptance::AcceptanceProbe>,
) {
}
