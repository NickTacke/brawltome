//! runs the rewritten detection behind the 0.1.x event interface, until the app is rebuilt on the new events

use brawltome_detection::{Event, MatchSnapshot, MatchType as NewMatchType};
use brawltome_events::{
    AttachedPayload, DetachReason, DetachedPayload, GameEvent, LocalPlayerFoundPayload,
    MatchEndedPayload, MatchStartedPayload, MatchType, OffsetsBrokenPayload, ReadyPayload,
    ScanningPayload,
};

/// 0.1.x has no replay watcher to say when a match ends, so it keeps one 4-byte read a second during a match
pub const IN_MATCH_POLL_MS: u64 = 1_000;

// between one match and the next there are only a few seconds of scoreboard and queue
const _: () = assert!(IN_MATCH_POLL_MS <= 1_000);

/// pure: one new event → the old events the 0.1.x bridge understands
pub fn to_legacy_events(event: &Event, local_brawlhalla_id: &mut Option<u32>) -> Vec<GameEvent> {
    match event {
        Event::GameFound { process_id } => {
            vec![GameEvent::Attached(AttachedPayload { pid: *process_id })]
        }
        Event::Ready {
            local_brawlhalla_id: id,
            ..
        } => {
            *local_brawlhalla_id = Some(*id);
            vec![
                GameEvent::LocalPlayerFound(LocalPlayerFoundPayload { bhid: *id }),
                GameEvent::Ready(ReadyPayload),
            ]
        }
        Event::MatchStarted(snapshot) => match_started(snapshot, *local_brawlhalla_id),
        Event::MatchEnded => local_brawlhalla_id
            .map(|id| {
                vec![GameEvent::MatchEnded(MatchEndedPayload {
                    local_player_bhid: id,
                })]
            })
            .unwrap_or_default(),
        Event::GameClosed => {
            *local_brawlhalla_id = None;
            vec![GameEvent::Detached(DetachedPayload {
                reason: DetachReason::ProcessGone,
            })]
        }
        Event::Unsupported { game_version, .. } => {
            vec![GameEvent::OffsetsBroken(OffsetsBrokenPayload {
                detected_version: game_version.clone(),
            })]
        }
        Event::Queueing | Event::MatchSkipped { .. } => Vec::new(),
    }
}

/// opponents are everyone not on the local player's team
fn match_started(snapshot: &MatchSnapshot, remembered_local_id: Option<u32>) -> Vec<GameEvent> {
    let local = snapshot.players.iter().find(|player| player.is_local);
    let Some(local_player_bhid) = local
        .map(|player| player.brawlhalla_id)
        .or(remembered_local_id)
    else {
        return Vec::new();
    };

    let local_team = local.map(|player| player.team);
    let opponent_bhids: Vec<u32> = snapshot
        .players
        .iter()
        .filter(|player| Some(player.team) != local_team)
        .map(|player| player.brawlhalla_id)
        .collect();
    if opponent_bhids.is_empty() {
        return Vec::new();
    }

    let payload = MatchStartedPayload {
        match_type: legacy_match_type(&snapshot.match_type),
        local_player_bhid,
        opponent_bhids,
    };

    vec![
        GameEvent::Scanning(ScanningPayload),
        GameEvent::MatchStarted(payload),
    ]
}

fn legacy_match_type(match_type: &NewMatchType) -> MatchType {
    match match_type {
        NewMatchType::Ranked1v1 => MatchType::Ranked1v1,
        NewMatchType::Ranked2v2 => MatchType::Ranked2v2,
        NewMatchType::Custom => MatchType::Custom,
        NewMatchType::Other(_) => MatchType::Unknown,
    }
}

#[cfg(target_os = "windows")]
pub use windows_service::LegacyDetectionService;

#[cfg(target_os = "windows")]
mod windows_service {
    use brawltome_detection::Config;
    use brawltome_events::{
        DetectionConfig, DetectionError, DetectionHandle, DetectionService, GameEvent,
    };
    use tokio::sync::{mpsc, oneshot};

    use super::{to_legacy_events, IN_MATCH_POLL_MS};

    pub struct LegacyDetectionService;

    impl DetectionService for LegacyDetectionService {
        fn start(
            &self,
            config: DetectionConfig,
            events: mpsc::Sender<GameEvent>,
        ) -> Result<DetectionHandle, DetectionError> {
            let detection_config = Config {
                process_name: config.target_process,
                in_match_poll_ms: Some(IN_MATCH_POLL_MS),
                ..Config::default()
            };
            let (new_events, received_events) = std::sync::mpsc::channel();
            let detection = brawltome_detection::start(detection_config, new_events);

            std::thread::Builder::new()
                .name("brawltome-legacy-events".to_string())
                .spawn(move || forward_events(received_events, events))
                .map_err(|error| {
                    DetectionError::StartFailed(format!("spawn the event forwarder: {error}"))
                })?;

            let (stop_tx, stop_rx) = oneshot::channel::<()>();
            let join = tokio::spawn(async move {
                let _ = stop_rx.await;
                let _ = tokio::task::spawn_blocking(move || detection.stop()).await;
            });

            Ok(DetectionHandle { stop_tx, join })
        }
    }

    /// ends when detection stops or the bridge stops listening
    fn forward_events(
        received_events: std::sync::mpsc::Receiver<brawltome_detection::Event>,
        events: mpsc::Sender<GameEvent>,
    ) {
        let mut local_brawlhalla_id = None;
        for event in received_events {
            for legacy_event in to_legacy_events(&event, &mut local_brawlhalla_id) {
                if events.blocking_send(legacy_event).is_err() {
                    return;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use brawltome_detection::{
        Event, MatchSnapshot, MatchType as NewMatchType, Player, SkipReason, UnsupportedReason,
    };
    use brawltome_events::{
        DetachReason, DetachedPayload, GameEvent, LocalPlayerFoundPayload, MatchStartedPayload,
        MatchType, OffsetsBrokenPayload, ReadyPayload, ScanningPayload,
    };

    fn player(id: u32, team: u32) -> Player {
        Player {
            brawlhalla_id: id,
            name: format!("P{id}"),
            team,
            legend: None,
            is_local: id == 1,
            personal_rating_2v2: None,
        }
    }

    fn two_versus_two() -> MatchSnapshot {
        MatchSnapshot {
            match_type: NewMatchType::Ranked2v2,
            players: vec![player(1, 1), player(2, 1), player(3, 2), player(4, 2)],
        }
    }

    #[test]
    fn a_2v2_match_lists_only_the_other_team_as_opponents() {
        let mut local = Some(1);
        let events = to_legacy_events(&Event::MatchStarted(two_versus_two()), &mut local);
        assert_eq!(
            events,
            vec![
                GameEvent::Scanning(ScanningPayload),
                GameEvent::MatchStarted(MatchStartedPayload {
                    match_type: MatchType::Ranked2v2,
                    local_player_bhid: 1,
                    opponent_bhids: vec![3, 4]
                }),
            ]
        );
    }

    #[test]
    fn ready_sends_the_local_player_first() {
        let mut local = None;
        let events = to_legacy_events(
            &Event::Ready {
                local_brawlhalla_id: 42,
                game_version: "11.00.36258".into(),
            },
            &mut local,
        );
        assert_eq!(
            events,
            vec![
                GameEvent::LocalPlayerFound(LocalPlayerFoundPayload { bhid: 42 }),
                GameEvent::Ready(ReadyPayload)
            ]
        );
        assert_eq!(local, Some(42));
    }

    #[test]
    fn an_unsupported_patch_becomes_offsets_broken_with_the_version() {
        let mut local = None;
        let event = Event::Unsupported {
            game_version: Some("11.01.1".into()),
            reason: UnsupportedReason::MissingRole("lobby".into()),
        };
        let events = to_legacy_events(&event, &mut local);
        assert_eq!(
            events,
            vec![GameEvent::OffsetsBroken(OffsetsBrokenPayload {
                detected_version: Some("11.01.1".into())
            })]
        );
    }

    #[test]
    fn a_custom_room_maps_to_custom_and_a_skipped_match_to_nothing() {
        let mut local = Some(1);
        let custom = MatchSnapshot {
            match_type: NewMatchType::Custom,
            players: vec![player(1, 1), player(5, 2)],
        };
        let events = to_legacy_events(&Event::MatchStarted(custom), &mut local);
        assert!(
            matches!(&events[1], GameEvent::MatchStarted(payload) if payload.match_type == MatchType::Custom)
        );

        let skipped = Event::MatchSkipped {
            reason: SkipReason::Spectating,
        };
        assert_eq!(to_legacy_events(&skipped, &mut local), vec![]);
        assert_eq!(to_legacy_events(&Event::Queueing, &mut local), vec![]);
    }

    #[test]
    fn a_room_with_no_opponents_starts_no_match() {
        // 0.1.x only ever sent a match with opponents; an empty one would start a lookup that never ends
        let mut local = Some(1);
        let solo = MatchSnapshot {
            match_type: NewMatchType::Custom,
            players: vec![player(1, 1)],
        };
        assert_eq!(
            to_legacy_events(&Event::MatchStarted(solo), &mut local),
            vec![]
        );
    }

    #[test]
    fn closing_the_game_detaches_and_forgets_the_player() {
        let mut local = Some(1);
        let events = to_legacy_events(&Event::GameClosed, &mut local);
        assert_eq!(
            events,
            vec![GameEvent::Detached(DetachedPayload {
                reason: DetachReason::ProcessGone
            })]
        );
        assert_eq!(local, None);
    }
}
