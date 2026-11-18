//! BrawlTome desktop overlay library entrypoint.
//! Tauri builder + plugin wiring + setup callback that wires the focused modules.

pub mod app_status;
pub mod detection_source;
pub mod lobby_client;
mod log_prune;
pub mod overlay_view;
pub mod overlay_window;
pub mod session;
pub mod session_runner;
pub mod tray;
pub mod updater_artifact;

use std::sync::Arc;

use brawltome_detection::Event;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::mpsc;

use lobby_client::LobbyClient;
use overlay_window::OverlayWindow;
use session_runner::{LinkOpener, OverlaySurface};

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
        .plugin(build_log_plugin())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            overlay_window::overlay_content_resized,
            overlay_window::get_overlay_view,
            overlay_window::open_player_profile,
            overlay_window::retry_lookup,
        ])
        .setup(|app| {
            // Best-effort: keep the log dir bounded. Runs synchronously on
            // startup; ~tens of ms even with 10+ files, so it's fine before
            // the window is shown.
            if let Ok(log_dir) = app.path().app_log_dir() {
                log_prune::prune_log_dir(&log_dir, 10);
            }

            start_overlay(app.handle())?;
            tray::install(app.handle())?;

            // Open devtools automatically in dev builds. Tauri compiles devtools
            // into debug builds only; this just auto-launches the panel so we
            // don't have to find the small, mostly hidden overlay to open it.
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("overlay") {
                    window.open_devtools();
                }
            }

            // Background update check on startup. Silent: download + install
            // without UI. On Windows, Tauri exits the app to let the installer
            // replace the running binary; on_before_exit logs the imminent quit
            // so it isn't mysterious in beta-tester logs. Skipped in dev builds.
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_updater::UpdaterExt;
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let updater = match app_handle
                        .updater_builder()
                        .on_before_exit(|| {
                            log::info!("Update downloaded; app is about to quit so the installer can replace the running binary");
                        })
                        .build()
                    {
                        Ok(u) => u,
                        Err(e) => {
                            log::warn!("Updater not available: {e}");
                            return;
                        }
                    };
                    match updater.check().await {
                        Ok(Some(update)) => {
                            log::info!(
                                "Update available: {} -> {}. App will quit and silently install when download completes.",
                                update.current_version,
                                update.version
                            );
                            if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                                log::warn!("Update install failed: {e}");
                            }
                        }
                        Ok(None) => log::debug!("No update available"),
                        Err(e) => log::warn!("Update check failed: {e}"),
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// detection feeds the session, and the session drives the overlay window
fn start_overlay(app: &AppHandle) -> Result<(), String> {
    let overlay = OverlayWindow::new(app);
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
