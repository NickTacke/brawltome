//! Updates from the desktop feed: when to check, when to install.
//! Nothing happens while the game runs, so a match never shares the network or frames with an update.

use std::future::Future;
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_updater::{Update, Updater, UpdaterExt};
use tokio::sync::watch;
use tokio::time::Instant;

use crate::app_status::{AppStatus, GameStatus, ServiceStatus, UpdateStatus};
use crate::quiet_relaunch;
use crate::session::Input;
use crate::session_runner::SessionHandle;
use crate::tray;

/// tauri.conf.json's only updater endpoint; a test keeps the two equal
pub const UPDATE_FEED_URL: &str =
    "https://github.com/NickTacke/brawltome/releases/download/desktop-latest/latest.json";

/// 6 hours
pub const UPDATE_CHECK_INTERVAL_MS: u64 = 21_600_000;

/// detection finds a running game at its first look, within a second or two of the start; it says nothing while
/// the game is closed, so the first check waits this long instead of for an answer that never comes
pub const FIRST_CHECK_HOLD_OFF_MS: u64 = 10_000;

/// when the api refuses this version
pub const REQUIRED_UPDATE_RECHECK_MS: u64 = 600_000;

/// a stalled connection (a half-open socket after sleep, a captive portal) would otherwise hold the loop for good
pub const UPDATE_CHECK_TIMEOUT_MS: u64 = 30_000;

/// the installer is a few MB, so this only ends a stalled download
pub const UPDATE_DOWNLOAD_TIMEOUT_MS: u64 = 600_000;

#[derive(Debug, PartialEq, Eq)]
pub enum RequestOutcome<T> {
    Finished(T),
    TimedOut,
    GameStarted,
}

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
        return wait_until(FIRST_CHECK_HOLD_OFF_MS, now_ms);
    };

    let interval_ms = if is_update_required {
        REQUIRED_UPDATE_RECHECK_MS
    } else {
        UPDATE_CHECK_INTERVAL_MS
    };
    let next_check_ms = last_check_ms.saturating_add(interval_ms);

    wait_until(next_check_ms, now_ms)
}

fn wait_until(check_at_ms: u64, now_ms: u64) -> UpdaterStep {
    if now_ms >= check_at_ms {
        return UpdaterStep::CheckNow;
    }

    UpdaterStep::WaitMs(check_at_ms - now_ms)
}

/// checks the feed in the background for as long as the app runs; debug builds never update
pub fn spawn(app: &AppHandle, session: SessionHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    let built = app
        .updater_builder()
        .on_before_exit(leave_for_installer(app.clone()))
        .build();

    let updater = match built {
        Ok(updater) => updater,
        Err(error) => {
            log::warn!("start the updater for {UPDATE_FEED_URL}: {error}");
            return;
        }
    };

    tauri::async_runtime::spawn(run(updater, session, app.clone()));
}

/// on windows the install quits the app to run the installer, which starts it again with this start's arguments
fn leave_for_installer(app: AppHandle) -> impl Fn() + Send + Sync + 'static {
    move || {
        log::info!("update downloaded, quitting so the installer can replace the app");

        // a start by hand would otherwise come back with its window open, long after the player looked at it
        if let Some(directory) = quiet_relaunch::directory(&app) {
            if let Err(error) = quiet_relaunch::mark(&directory) {
                log::warn!("{error}");
            }
        }

        tray::set_visible(&app, false);
    }
}

/// the installer didn't start, so the app stays; safe whether or not the exit hook ran
fn stay_after_failed_install(app: &AppHandle) {
    if let Some(directory) = quiet_relaunch::directory(app) {
        quiet_relaunch::clear(&directory);
    }

    tray::set_visible(app, true);
}

async fn run(updater: Updater, session: SessionHandle, app: AppHandle) {
    let mut status = session.status();
    let started_at = Instant::now();
    let mut last_check_ms = None;

    while wait_until_check_is_due(&mut status, started_at, last_check_ms).await {
        let attempt = update_if_available(&updater, &session, &app, &mut status).await;

        if attempt == Attempt::Counted {
            last_check_ms = Some(elapsed_ms(started_at));
        }
    }
}

/// waits on the status and the clock until a check is due; false once the session has stopped
async fn wait_until_check_is_due(
    status: &mut watch::Receiver<AppStatus>,
    started_at: Instant,
    last_check_ms: Option<u64>,
) -> bool {
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
            UpdaterStep::CheckNow => return true,
            UpdaterStep::WaitForGameToClose => wait_for_game_to_close(status).await,
            UpdaterStep::WaitMs(wait_ms) => sleep_or_status_change(status, wait_ms).await,
        };

        if !is_session_running {
            return false;
        }
    }
}

/// how an update attempt ended, for the loop's next step
#[derive(Debug, PartialEq, Eq)]
enum Attempt {
    /// checked, or failed, or timed out: the next check waits for its interval
    Counted,
    /// the game started: the loop checks again once it closes
    GaveWayToGame,
}

async fn update_if_available(
    updater: &Updater,
    session: &SessionHandle,
    app: &AppHandle,
    status: &mut watch::Receiver<AppStatus>,
) -> Attempt {
    let update = match find_update(updater, status).await {
        Ok(update) => update,
        Err(attempt) => return attempt,
    };

    log::info!(
        "update {} -> {} found, downloading",
        update.current_version,
        update.version
    );
    session.send(Input::UpdateStatusChanged(UpdateStatus::Downloading {
        version: update.version.clone(),
    }));

    let bytes = match download_update(&update, status).await {
        Ok(bytes) => bytes,
        Err(attempt) => {
            session.send(Input::UpdateStatusChanged(UpdateStatus::Idle));
            return attempt;
        }
    };

    install_when_game_is_closed(&update, &bytes, session, app, status).await;

    Attempt::Counted
}

/// the error is how the attempt ended without an update; failures are only logged
async fn find_update(
    updater: &Updater,
    status: &mut watch::Receiver<AppStatus>,
) -> Result<Update, Attempt> {
    let outcome = run_while_game_is_closed(updater.check(), status, UPDATE_CHECK_TIMEOUT_MS).await;

    match outcome {
        RequestOutcome::Finished(Ok(Some(update))) => Ok(update),
        RequestOutcome::Finished(Ok(None)) => Err(Attempt::Counted),
        RequestOutcome::Finished(Err(error)) => {
            log::warn!("check for updates at {UPDATE_FEED_URL}: {error}");
            Err(Attempt::Counted)
        }
        RequestOutcome::TimedOut => {
            let limit_s = UPDATE_CHECK_TIMEOUT_MS / 1_000;
            log::warn!("check for updates at {UPDATE_FEED_URL}: timed out after {limit_s} s");
            Err(Attempt::Counted)
        }
        RequestOutcome::GameStarted => Err(Attempt::GaveWayToGame),
    }
}

/// the error is how the attempt ended without the installer; failures are only logged
async fn download_update(
    update: &Update,
    status: &mut watch::Receiver<AppStatus>,
) -> Result<Vec<u8>, Attempt> {
    let download = update.download(|_, _| {}, || {});
    let outcome = run_while_game_is_closed(download, status, UPDATE_DOWNLOAD_TIMEOUT_MS).await;
    let failed_download = format!(
        "download update {} from {}",
        update.version, update.download_url
    );

    match outcome {
        RequestOutcome::Finished(Ok(bytes)) => Ok(bytes),
        RequestOutcome::Finished(Err(error)) => {
            log::warn!("{failed_download}: {error}");
            Err(Attempt::Counted)
        }
        RequestOutcome::TimedOut => {
            let limit_s = UPDATE_DOWNLOAD_TIMEOUT_MS / 1_000;
            log::warn!("{failed_download}: timed out after {limit_s} s");
            Err(Attempt::Counted)
        }
        RequestOutcome::GameStarted => Err(Attempt::GaveWayToGame),
    }
}

/// the game may have started since the download finished; the bytes wait for it to close
async fn install_when_game_is_closed(
    update: &Update,
    bytes: &[u8],
    session: &SessionHandle,
    app: &AppHandle,
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
        stay_after_failed_install(app);
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

/// runs a request only while the game stays closed, and never longer than its time limit
pub async fn run_while_game_is_closed<F: Future>(
    request: F,
    status: &mut watch::Receiver<AppStatus>,
    time_limit_ms: u64,
) -> RequestOutcome<F::Output> {
    let limited_request = tokio::time::timeout(Duration::from_millis(time_limit_ms), request);

    // biased: a game that already runs wins over a request that would finish at once
    tokio::select! {
        biased;
        _ = game_start(status) => RequestOutcome::GameStarted,
        finished = limited_request => match finished {
            Ok(output) => RequestOutcome::Finished(output),
            Err(_) => RequestOutcome::TimedOut,
        },
    }
}

/// resolves when the game runs; a stopped session can't tell, so the request then runs to its time limit
async fn game_start(status: &mut watch::Receiver<AppStatus>) {
    let has_session = status.wait_for(is_game_running).await.is_ok();

    if !has_session {
        std::future::pending::<()>().await;
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
    fn the_first_check_gives_detection_time_to_find_the_game() {
        assert_eq!(
            next_updater_step(false, false, None, 0),
            UpdaterStep::WaitMs(FIRST_CHECK_HOLD_OFF_MS)
        );
        assert_eq!(
            next_updater_step(false, false, None, 4_000),
            UpdaterStep::WaitMs(FIRST_CHECK_HOLD_OFF_MS - 4_000)
        );
    }

    #[test]
    fn checks_after_the_hold_off_when_the_game_is_closed() {
        assert_eq!(
            next_updater_step(false, false, None, FIRST_CHECK_HOLD_OFF_MS),
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

    fn game_running() -> AppStatus {
        AppStatus {
            game: GameStatus::Running { game_version: None },
            ..AppStatus::default()
        }
    }

    #[tokio::test(start_paused = true)]
    async fn the_first_check_is_due_after_the_hold_off() {
        let (_sender, mut status) = watch::channel(AppStatus::default());
        let started_at = Instant::now();

        let is_due = wait_until_check_is_due(&mut status, started_at, None).await;

        assert!(is_due);
        assert_eq!(
            started_at.elapsed(),
            Duration::from_millis(FIRST_CHECK_HOLD_OFF_MS)
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_game_found_during_the_hold_off_holds_the_first_check_until_it_closes() {
        let (sender, mut status) = watch::channel(AppStatus::default());
        let started_at = Instant::now();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(1_000)).await;
            sender.send_replace(game_running());
            tokio::time::sleep(Duration::from_millis(59_000)).await;
            sender.send_replace(AppStatus::default());
            std::future::pending::<()>().await;
        });

        let is_due = wait_until_check_is_due(&mut status, started_at, None).await;

        assert!(is_due);
        assert_eq!(started_at.elapsed(), Duration::from_millis(60_000));
    }

    #[tokio::test(start_paused = true)]
    async fn a_stopped_session_ends_the_wait() {
        let (sender, mut status) = watch::channel(AppStatus::default());
        drop(sender);

        let is_due = wait_until_check_is_due(&mut status, Instant::now(), None).await;

        assert!(!is_due);
    }

    #[tokio::test(start_paused = true)]
    async fn a_request_finishes_while_the_game_stays_closed() {
        let (_sender, mut status) = watch::channel(AppStatus::default());

        let outcome = run_while_game_is_closed(async { 7 }, &mut status, 30_000).await;

        assert_eq!(outcome, RequestOutcome::Finished(7));
    }

    #[tokio::test(start_paused = true)]
    async fn a_stalled_request_times_out_at_its_limit() {
        let (_sender, mut status) = watch::channel(AppStatus::default());
        let started_at = Instant::now();

        let outcome =
            run_while_game_is_closed(std::future::pending::<()>(), &mut status, 30_000).await;

        assert_eq!(outcome, RequestOutcome::TimedOut);
        assert_eq!(started_at.elapsed(), Duration::from_millis(30_000));
    }

    #[tokio::test(start_paused = true)]
    async fn a_game_start_drops_the_request() {
        let (sender, mut status) = watch::channel(AppStatus::default());
        let started_at = Instant::now();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(1_000)).await;
            sender.send_replace(game_running());
        });

        let slow_request = tokio::time::sleep(Duration::from_millis(20_000));
        let outcome = run_while_game_is_closed(slow_request, &mut status, 30_000).await;

        assert_eq!(outcome, RequestOutcome::GameStarted);
        assert_eq!(started_at.elapsed(), Duration::from_millis(1_000));
    }

    #[tokio::test(start_paused = true)]
    async fn a_running_game_wins_over_a_ready_request() {
        let (_sender, mut status) = watch::channel(game_running());

        let outcome = run_while_game_is_closed(async { 7 }, &mut status, 30_000).await;

        assert_eq!(outcome, RequestOutcome::GameStarted);
    }

    #[tokio::test(start_paused = true)]
    async fn a_stopped_session_keeps_the_time_limit() {
        let (sender, mut status) = watch::channel(AppStatus::default());
        drop(sender);

        let finished = run_while_game_is_closed(async { 7 }, &mut status, 30_000).await;
        let stalled =
            run_while_game_is_closed(std::future::pending::<()>(), &mut status, 30_000).await;

        assert_eq!(finished, RequestOutcome::Finished(7));
        assert_eq!(stalled, RequestOutcome::TimedOut);
    }
}
