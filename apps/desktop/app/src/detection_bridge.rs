//! Bridge between detection's typed GameEvent channel and the Tauri-emit-to-React contract.
//! Owns BhID enrichment via api_client and the 2s post-MatchStarted refetch.

#[cfg(target_os = "windows")]
use brawltome_events::{DetectionConfig, DetectionService, GameEvent};

#[cfg(target_os = "windows")]
use crate::api_client;

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

/// Spawn the bridge task. Builds an ApiClient from BRAWLTOME_API_URL (default
/// https://api.brawltome.app), starts WindowsDetectionService, and forwards
/// enriched events to the React UI on the "game-event" Tauri channel.
#[cfg(target_os = "windows")]
pub fn spawn(app: &tauri::AppHandle) {
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
                GameEvent::MatchEnded(p) => {
                    if let Some(h) = pending_refetch.take() {
                        h.abort();
                    }
                    opponent_cache.clear();
                    let _ = app_handle.emit("game-event", &LegacyMatchEnded { event: "match_ended" });
                    let _ = p; // local_player_bhid currently unused on the React side
                }
                GameEvent::MatchStarted(p) => {
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
pub fn spawn(_app: &tauri::AppHandle) {}
