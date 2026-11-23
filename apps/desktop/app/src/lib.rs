//! BrawlTome desktop overlay library entrypoint.
//! Tauri builder + plugin wiring + setup callback that wires the focused modules.

pub mod app_status;
pub mod autostart;
pub mod detection_source;
pub mod lobby_client;
mod log_prune;
pub mod main_window;
pub mod overlay_view;
pub mod overlay_window;
pub mod post_match;
pub mod session;
pub mod session_runner;
pub mod settings;
pub mod tray;
pub mod updater;
pub mod updater_artifact;

use std::sync::Arc;

use brawltome_detection::Event;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::mpsc;

use autostart::was_autostarted;
use lobby_client::LobbyClient;
use overlay_window::{OverlayPosition, OverlayWindow};
use session_runner::{LinkOpener, OverlaySurface, SessionHandle};
use settings::SettingsStore;

const DEFAULT_API_URL: &str = "https://api.brawltome.app";

/// Build the log plugin with our standard config: rotating per-launch files
/// in the platform log dir, plus stdout + webview targets in dev only.
fn build_log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri_plugin_log::{Target, TargetKind};

    // One log file per launch. Timestamp keeps filenames sortable and unique;
    // colons are not legal on Windows so the format uses dashes.
    let stamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();
    let file_name = format!("BrawlTome_{stamp}");

    let mut builder = tauri_plugin_log::Builder::default()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir {
            file_name: Some(file_name),
        }))
        .level(if cfg!(debug_assertions) {
            log::LevelFilter::Debug
        } else {
            log::LevelFilter::Info
        });

    // Stdout + webview console only in dev. Stdout is redundant on installed
    // Windows builds (no console attached), and the webview console isn't
    // useful when devtools is gated to debug builds.
    if cfg!(debug_assertions) {
        builder = builder
            .target(Target::new(TargetKind::Stdout))
            .target(Target::new(TargetKind::Webview));
    }

    builder.build()
}

pub fn run() {
    tauri::Builder::default()
        // first, so a second start hands over and exits before any other plugin starts
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _directory| main_window::open(app),
        ))
        .plugin(autostart::plugin())
        .plugin(build_log_plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            overlay_window::overlay_content_resized,
            overlay_window::get_overlay_view,
            overlay_window::open_player_profile,
            overlay_window::retry_lookup,
            settings::get_settings,
            settings::set_overlay_position,
            autostart::set_starts_with_windows,
            main_window::get_app_status,
            main_window::hide_main_window,
            main_window::set_overlay_paused,
        ])
        .setup(|app| {
            // Best-effort: keep the log dir bounded. Runs synchronously on
            // startup; ~tens of ms even with 10+ files, so it's fine before
            // the window is shown.
            if let Ok(log_dir) = app.path().app_log_dir() {
                log_prune::prune_log_dir(&log_dir, 10);
            }

            let settings = open_settings(app.handle());
            start_overlay(app.handle(), settings.get().overlay_position)?;

            // before the window reads the setting; a failure is not worth stopping the app
            if let Err(error) = autostart::sync_at_start(app.handle(), &settings) {
                log::warn!("{error}");
            }

            app.manage(settings);
            let session = app.state::<SessionHandle>().inner().clone();
            updater::spawn(app.handle(), session.clone());
            tray::install(app.handle(), session)?;

            let launch_arguments: Vec<String> = std::env::args().collect();
            start_main_window(app.handle(), !was_autostarted(&launch_arguments));

            // Open devtools automatically in dev builds. Tauri compiles devtools
            // into debug builds only; this just auto-launches the panel so we
            // don't have to find the small, mostly hidden overlay to open it.
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("overlay") {
                    window.open_devtools();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn open_settings(app: &AppHandle) -> SettingsStore {
    let directory = app.path().app_config_dir().unwrap_or_else(|error| {
        // the app config folder can't be named without a home folder; the temp folder always can, so the app
        // still starts, with settings that may not outlive the session
        let fallback = std::env::temp_dir().join(&app.config().identifier);
        log::warn!(
            "find the config folder for settings: {error}; using {}",
            fallback.display()
        );
        fallback
    });

    SettingsStore::open(&directory)
}

/// detection feeds the session, and the session drives the overlay window
fn start_overlay(app: &AppHandle, position: OverlayPosition) -> Result<(), String> {
    let overlay = OverlayWindow::new(app);
    overlay.set_position(position);
    let app_version = app.package_info().version.to_string();
    let lookup = LobbyClient::new(&api_url(), &app_version)
        .map_err(|error| format!("start the lobby client: {error}"))?;
    let cache_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("find the cache folder for detection: {error}"))?;

    // the detection source and the runner spawn tokio tasks, so they start inside tauri's runtime
    let runtime = tauri::async_runtime::handle();
    let _runtime_context = runtime.inner().enter();
    let detection_events = detection_source::start(cache_directory);
    let session_events = tap_game_process(detection_events, Arc::clone(&overlay));
    let session = session_runner::spawn(
        session_events,
        Arc::new(lookup),
        Arc::clone(&overlay) as Arc<dyn OverlaySurface>,
        Arc::new(BrowserLinks(app.clone())),
    );

    app.manage(overlay);
    app.manage(session);

    Ok(())
}

/// the window follows the session's status; a start at login keeps it closed, in the tray
fn start_main_window(app: &AppHandle, should_open: bool) {
    let status = app.state::<SessionHandle>().status();

    main_window::hide_on_close(app);
    main_window::forward_status(app, status);

    if should_open {
        main_window::open(app);
    }
}

fn api_url() -> String {
    let configured = std::env::var("BRAWLTOME_API_URL").unwrap_or_default();
    let configured = configured.trim();

    if configured.is_empty() {
        return DEFAULT_API_URL.to_string();
    }

    configured.to_string()
}

/// the overlay finds the game's monitor through its process; the session gets every event unchanged
fn tap_game_process(
    mut detection_events: mpsc::Receiver<Event>,
    overlay: Arc<OverlayWindow>,
) -> mpsc::Receiver<Event> {
    let (sender, receiver) = mpsc::channel(32);

    tokio::spawn(async move {
        while let Some(event) = detection_events.recv().await {
            match &event {
                Event::GameFound { process_id } => overlay.set_game_process(Some(*process_id)),
                Event::GameClosed => overlay.set_game_process(None),
                _ => {}
            }

            if sender.send(event).await.is_err() {
                break;
            }
        }
    });

    receiver
}

/// opens profile links in the default browser
struct BrowserLinks(AppHandle);

impl LinkOpener for BrowserLinks {
    fn open(&self, url: &str) {
        if let Err(error) = self.0.opener().open_url(url, None::<&str>) {
            log::warn!("open {url} in the browser: {error}");
        }
    }
}
