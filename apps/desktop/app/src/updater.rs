//! Updates from the desktop feed: when to check, when to install.
//! Nothing happens while the game runs, so a match never shares the network or frames with an update.

use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};
use tokio::sync::watch;
use tokio::time::Instant;

use crate::app_status::{AppStatus, GameStatus, ServiceStatus, UpdateStatus};
use crate::session::Input;
use crate::session_runner::SessionHandle;

/// tauri.conf.json's only updater endpoint; a test keeps the two equal
pub const UPDATE_FEED_URL: &str =
    "https://github.com/NickTacke/brawltome/releases/download/desktop-latest/latest.json";

/// 6 hours
pub const UPDATE_CHECK_INTERVAL_MS: u64 = 21_600_000;

/// when the api refuses this version
pub const REQUIRED_UPDATE_RECHECK_MS: u64 = 600_000;

#[derive(Debug, PartialEq, Eq)]
pub enum UpdaterStep {
    WaitForGameToClose,
    WaitMs(u64),
    CheckNow,
}

pub fn next_updater_step(
    is_game_running: bool,
    is_update_required: bool,
    last_check_ms: Option<u64>,
    now_ms: u64,
) -> UpdaterStep {
    if is_game_running {
        return UpdaterStep::WaitForGameToClose;
    }

    let Some(last_check_ms) = last_check_ms else {
        return UpdaterStep::CheckNow;
    };

    let interval_ms = if is_update_required {
        REQUIRED_UPDATE_RECHECK_MS
    } else {
        UPDATE_CHECK_INTERVAL_MS
    };
    let next_check_ms = last_check_ms.saturating_add(interval_ms);

    if now_ms >= next_check_ms {
        return UpdaterStep::CheckNow;
    }

    UpdaterStep::WaitMs(next_check_ms - now_ms)
}

/// checks the feed in the background for as long as the app runs; debug builds never update
pub fn spawn(app: &AppHandle, session: SessionHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    // on windows the install quits the app to run the installer; the log line explains the quit
    let built = app
        .updater_builder()
        .on_before_exit(|| {
            log::info!("update downloaded, quitting so the installer can replace the app")
        })
        .build();

    let updater = match built {
        Ok(updater) => updater,
        Err(error) => {
            log::warn!("start the updater for {UPDATE_FEED_URL}: {error}");
            return;
        }
    };

    tauri::async_runtime::spawn(run(updater, session));
}

async fn run(updater: Updater, session: SessionHandle) {
    let mut status = session.status();
    let started_at = Instant::now();
    let mut last_check_ms = None;

    loop {
        let step = {
            let current = status.borrow_and_update();
            let now_ms = elapsed_ms(started_at);
            next_updater_step(
                is_game_running(&current),
                is_update_required(&current),
                last_check_ms,
                now_ms,
            )
        };

        let is_session_running = match step {
            UpdaterStep::WaitForGameToClose => wait_for_game_to_close(&mut status).await,
            UpdaterStep::WaitMs(wait_ms) => sleep_or_status_change(&mut status, wait_ms).await,
            UpdaterStep::CheckNow => {
                update_if_available(&updater, &session, &mut status).await;
                last_check_ms = Some(elapsed_ms(started_at));
                true
            }
        };

        if !is_session_running {
            return;
        }
    }
}

/// a failed check or download is only logged; the loop counts it as a check either way
async fn update_if_available(
    updater: &Updater,
    session: &SessionHandle,
    status: &mut watch::Receiver<AppStatus>,
) {
    let update = match updater.check().await {
        Ok(Some(update)) => update,
        Ok(None) => return,
        Err(error) => {
            log::warn!("check for updates at {UPDATE_FEED_URL}: {error}");
            return;
        }
    };

    let version = update.version.clone();
    log::info!(
        "update {} -> {version} found, downloading",
        update.current_version
    );
    session.send(Input::UpdateStatusChanged(UpdateStatus::Downloading {
        version: version.clone(),
    }));

    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(bytes) => bytes,
        Err(error) => {
            log::warn!(
                "download update {version} from {}: {error}",
                update.download_url
            );
            session.send(Input::UpdateStatusChanged(UpdateStatus::Idle));
            return;
        }
    };

    install_when_game_is_closed(&update, &bytes, session, status).await;
}

/// the game may have started during the download; the bytes wait for it to close
async fn install_when_game_is_closed(
    update: &Update,
    bytes: &[u8],
    session: &SessionHandle,
    status: &mut watch::Receiver<AppStatus>,
) {
    let version = update.version.clone();
    let is_game_running_now = is_game_running(&status.borrow_and_update());

    if is_game_running_now {
        session.send(Input::UpdateStatusChanged(
            UpdateStatus::ReadyWhenGameCloses {
                version: version.clone(),
            },
        ));

        if !wait_for_game_to_close(status).await {
            return;
        }
    }

    // on windows this only returns on failure, a started installer quits the app
    if let Err(error) = update.install(bytes) {
        log::warn!("install update {version}: {error}");
        session.send(Input::UpdateStatusChanged(UpdateStatus::Idle));
    }
}

/// no timer is armed here, only the status is watched; false once the session has stopped
async fn wait_for_game_to_close(status: &mut watch::Receiver<AppStatus>) -> bool {
    let closed = status.wait_for(|current| !is_game_running(current)).await;

    closed.is_ok()
}

/// a status change wakes the loop early, so a game start drops the timer; false once the session has stopped
async fn sleep_or_status_change(status: &mut watch::Receiver<AppStatus>, wait_ms: u64) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_millis(wait_ms)) => true,
        changed = status.changed() => changed.is_ok(),
    }
}

fn is_game_running(status: &AppStatus) -> bool {
    matches!(status.game, GameStatus::Running { .. })
}

fn is_update_required(status: &AppStatus) -> bool {
    matches!(status.service, ServiceStatus::UpdateRequired { .. })
}

fn elapsed_ms(started_at: Instant) -> u64 {
    let elapsed = started_at.elapsed().as_millis();

    u64::try_from(elapsed).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_at_start_when_the_game_is_closed() {
        assert_eq!(
            next_updater_step(false, false, None, 0),
            UpdaterStep::CheckNow
        );
    }

    #[test]
    fn never_checks_while_the_game_runs() {
        assert_eq!(
            next_updater_step(true, false, None, 0),
            UpdaterStep::WaitForGameToClose
        );
        assert_eq!(
            next_updater_step(true, true, None, 0),
            UpdaterStep::WaitForGameToClose
        );
        assert_eq!(
            next_updater_step(true, true, Some(0), 99_999_999),
            UpdaterStep::WaitForGameToClose
        );
    }

    #[test]
    fn waits_out_the_six_hours() {
        assert_eq!(
            next_updater_step(false, false, Some(0), 3_600_000),
            UpdaterStep::WaitMs(18_000_000)
        );
    }

    #[test]
    fn checks_when_six_hours_have_passed() {
        assert_eq!(
            next_updater_step(false, false, Some(0), 21_600_000),
            UpdaterStep::CheckNow
        );
    }

    #[test]
    fn a_required_update_is_checked_as_soon_as_the_game_closes() {
        assert_eq!(
            next_updater_step(false, true, Some(0), 600_000),
            UpdaterStep::CheckNow
        );
    }

    #[test]
    fn a_required_update_does_not_hammer_the_feed() {
        assert_eq!(
            next_updater_step(false, true, Some(0), 60_000),
            UpdaterStep::WaitMs(540_000)
        );
    }

    #[test]
    fn the_feed_is_the_desktop_one() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let endpoints = config.pointer("/plugins/updater/endpoints").unwrap();

        assert_eq!(
            UPDATE_FEED_URL,
            "https://github.com/NickTacke/brawltome/releases/download/desktop-latest/latest.json"
        );
        assert_eq!(endpoints, &serde_json::json!([UPDATE_FEED_URL]));
    }
}
