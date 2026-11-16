//! what the main window and the tray show about the game, detection, the service and updates

use serde::Serialize;

use crate::overlay_view::PlayerHead;

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

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub game: GameStatus,
    pub detection: DetectionStatus,
    pub service: ServiceStatus,
    pub update: UpdateStatus,
    pub is_overlay_paused: bool,
    pub is_match_running: bool,
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
fn patch_of(game_version: &str) -> &str {
    match game_version.match_indices('.').nth(1) {
        Some((index, _)) => &game_version[..index],
        None => game_version,
    }
}
