//! what the main window and the tray show about the game, detection, the service and updates

use brawltome_detection::{MatchResult, MatchSnapshot, MatchType};
use serde::Serialize;

use crate::overlay_view::{LobbyOpponents, PlayerHead};

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum GameStatus {
    #[default]
    NotRunning,
    Running {
        game_version: Option<String>,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DetectionStatus {
    #[default]
    Waiting,
    Starting,
    Ready,
    Unsupported {
        message: String,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ServiceStatus {
    #[default]
    Ok,
    Offline,
    Unavailable,
    UpdateRequired {
        minimum_version: String,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateStatus {
    #[default]
    Idle,
    Downloading {
        version: String,
    },
    ReadyWhenGameCloses {
        version: String,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentMatch {
    pub started_at_ms: u64,
    pub opponents: Vec<PlayerHead>,
    /// none until the app reads how a match ended
    pub is_win: Option<bool>,
    pub rating_change: Option<i32>,
}

/// the local player's 1v1 standing as the game's memory gives it; the page derives the tier from it
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OwnStanding {
    pub name: String,
    pub legend: Option<String>,
    pub rating: u32,
    pub games: u32,
}

impl OwnStanding {
    /// the local player of a ranked 1v1 that reads cleanly; none for any other lobby
    pub fn read(snapshot: &MatchSnapshot) -> Option<Self> {
        if snapshot.match_type != MatchType::Ranked1v1 {
            return None;
        }

        // the same rule as the cards: a lobby that doesn't read cleanly gives nothing
        LobbyOpponents::read(snapshot)?;
        let local_player = snapshot.players.iter().find(|player| player.is_local)?;
        let ranked = local_player.ranked.as_ref()?;

        Some(Self {
            name: local_player.name.clone(),
            legend: local_player.legend.clone(),
            rating: ranked.rating,
            games: ranked.games,
        })
    }

    /// the results screen of a ranked 1v1 gives the elo after it
    pub fn apply_result(&mut self, result: &MatchResult) {
        self.rating = result.rating.after;
        self.games += 1;
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub game: GameStatus,
    pub detection: DetectionStatus,
    pub service: ServiceStatus,
    pub update: UpdateStatus,
    pub is_overlay_paused: bool,
    pub is_match_running: bool,
    /// none until the first ranked 1v1 of this run
    pub you: Option<OwnStanding>,
    pub recent_matches: Vec<RecentMatch>,
}

/// "Patch 11.01 isn't supported yet" for game version 11.01.36258
pub fn unsupported_message(game_version: Option<&str>) -> String {
    let known_version = game_version.filter(|version| !version.is_empty());

    match known_version {
        Some(version) => format!("Patch {} isn't supported yet", patch_of(version)),
        None => "This game version isn't supported yet".to_string(),
    }
}

/// the first two parts of a game version: 11.01.36258 is patch 11.01
pub fn patch_of(game_version: &str) -> &str {
    match game_version.match_indices('.').nth(1) {
        Some((index, _)) => &game_version[..index],
        None => game_version,
    }
}
