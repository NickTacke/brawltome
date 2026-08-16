//! Shared event types and DetectionService trait between the Tauri app shell
//! and the (private) detection crate. Type definitions only, no runtime logic.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MatchType {
    Ranked1v1,
    Ranked2v2,
    Ranked3v3,
    Unranked,
    Custom,
    Ffa,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MatchStartedPayload {
    pub match_type: MatchType,
    pub local_player_bhid: u32,
    pub opponent_bhids: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MatchEndedPayload {
    pub local_player_bhid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScanningPayload;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OffsetsBrokenPayload {
    pub detected_version: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttachedPayload {
    pub pid: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DetachReason {
    ProcessGone,
    HandleInvalid,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct DetachedPayload {
    pub reason: DetachReason,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReadyPayload;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalPlayerFoundPayload {
    pub bhid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GameEvent {
    Scanning(ScanningPayload),
    MatchStarted(MatchStartedPayload),
    MatchEnded(MatchEndedPayload),
    OffsetsBroken(OffsetsBrokenPayload),
    Attached(AttachedPayload),
    Detached(DetachedPayload),
    Ready(ReadyPayload),
    LocalPlayerFound(LocalPlayerFoundPayload),
}

use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

#[derive(Debug, Clone)]
pub struct DetectionConfig {
    /// Process name to attach to (e.g. "Brawlhalla.exe").
    pub target_process: String,
    /// Base poll cadence in milliseconds. Implementations may adapt internally.
    pub poll_interval_ms: u32,
}

#[derive(Debug, thiserror::Error)]
pub enum DetectionError {
    #[error("failed to start detection: {0}")]
    StartFailed(String),
}

pub struct DetectionHandle {
    pub stop_tx: oneshot::Sender<()>,
    pub join: JoinHandle<()>,
}

impl DetectionHandle {
    pub async fn stop(self) -> Result<(), DetectionError> {
        let _ = self.stop_tx.send(());
        self.join
            .await
            .map_err(|e| DetectionError::StartFailed(format!("join failed: {e}")))?;
        Ok(())
    }
}

pub trait DetectionService: Send + Sync + 'static {
    fn start(
        &self,
        config: DetectionConfig,
        events: mpsc::Sender<GameEvent>,
    ) -> Result<DetectionHandle, DetectionError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn match_type_serializes_to_snake_case() {
        let json = serde_json::to_string(&MatchType::Ranked1v1).unwrap();
        assert_eq!(json, r#""ranked1v1""#);
    }

    #[test]
    fn match_type_round_trips() {
        let original = MatchType::Ranked2v2;
        let json = serde_json::to_string(&original).unwrap();
        let parsed: MatchType = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn match_started_round_trips() {
        let original = MatchStartedPayload {
            match_type: MatchType::Ranked1v1,
            local_player_bhid: 1,
            opponent_bhids: vec![2, 3],
        };
        let json = serde_json::to_string(&original).unwrap();
        let parsed: MatchStartedPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn game_event_scanning_serializes_with_type_tag() {
        let event = GameEvent::Scanning(ScanningPayload);
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"type":"scanning"}"#);
    }

    #[test]
    fn game_event_match_started_serializes_with_type_tag_and_payload() {
        let event = GameEvent::MatchStarted(MatchStartedPayload {
            match_type: MatchType::Ranked1v1,
            local_player_bhid: 1,
            opponent_bhids: vec![2],
        });
        let json = serde_json::to_string(&event).unwrap();
        assert!(
            json.starts_with(r#"{"type":"match_started""#),
            "got: {json}"
        );
    }

    #[test]
    fn game_event_round_trips() {
        let original = GameEvent::MatchEnded(MatchEndedPayload {
            local_player_bhid: 42,
        });
        let json = serde_json::to_string(&original).unwrap();
        let parsed: GameEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn game_event_attached_serializes_with_type_tag() {
        let event = GameEvent::Attached(AttachedPayload { pid: 1234 });
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"type":"attached","pid":1234}"#);
    }

    #[test]
    fn game_event_detached_serializes_with_type_tag_and_reason() {
        let event = GameEvent::Detached(DetachedPayload {
            reason: DetachReason::ProcessGone,
        });
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"type":"detached","reason":"process_gone"}"#);
    }

    #[test]
    fn game_event_attached_round_trips() {
        let original = GameEvent::Attached(AttachedPayload { pid: 9999 });
        let json = serde_json::to_string(&original).unwrap();
        let parsed: GameEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn game_event_detached_handle_invalid_round_trips() {
        let original = GameEvent::Detached(DetachedPayload {
            reason: DetachReason::HandleInvalid,
        });
        let json = serde_json::to_string(&original).unwrap();
        let parsed: GameEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn game_event_ready_serializes_with_type_tag() {
        let event = GameEvent::Ready(ReadyPayload);
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, r#"{"type":"ready"}"#);
    }

    #[test]
    fn game_event_ready_round_trips() {
        let original = GameEvent::Ready(ReadyPayload);
        let json = serde_json::to_string(&original).unwrap();
        let parsed: GameEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn game_event_local_player_found_round_trips() {
        let original = GameEvent::LocalPlayerFound(LocalPlayerFoundPayload { bhid: 42 });
        let json = serde_json::to_string(&original).unwrap();
        assert!(
            json.contains(r#""type":"local_player_found""#),
            "got: {json}"
        );
        assert!(json.contains(r#""bhid":42"#), "got: {json}");
        let parsed: GameEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[tokio::test]
    async fn fake_detection_service_emits_events() {
        use tokio::sync::mpsc;

        struct FakeDetection {
            scripted: Vec<GameEvent>,
        }

        impl DetectionService for FakeDetection {
            fn start(
                &self,
                _config: DetectionConfig,
                events: mpsc::Sender<GameEvent>,
            ) -> Result<DetectionHandle, DetectionError> {
                let scripted = self.scripted.clone();
                let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
                let join = tokio::spawn(async move {
                    for event in scripted {
                        if stop_rx.try_recv().is_ok() {
                            return;
                        }
                        let _ = events.send(event).await;
                    }
                });
                Ok(DetectionHandle { stop_tx, join })
            }
        }

        let (tx, mut rx) = mpsc::channel(32);
        let svc = FakeDetection {
            scripted: vec![
                GameEvent::Scanning(ScanningPayload),
                GameEvent::MatchEnded(MatchEndedPayload {
                    local_player_bhid: 7,
                }),
            ],
        };
        let handle = svc
            .start(
                DetectionConfig {
                    target_process: "Test.exe".into(),
                    poll_interval_ms: 100,
                },
                tx,
            )
            .expect("start should succeed");

        let first = rx.recv().await.expect("first event");
        assert_eq!(first, GameEvent::Scanning(ScanningPayload));

        let second = rx.recv().await.expect("second event");
        assert_eq!(
            second,
            GameEvent::MatchEnded(MatchEndedPayload {
                local_player_bhid: 7
            })
        );

        handle.stop().await.expect("stop should succeed");
    }
}
