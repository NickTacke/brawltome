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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GameEvent {
    Scanning(ScanningPayload),
    MatchStarted(MatchStartedPayload),
    MatchEnded(MatchEndedPayload),
    OffsetsBroken(OffsetsBrokenPayload),
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
        assert!(json.starts_with(r#"{"type":"match_started""#), "got: {json}");
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
}
