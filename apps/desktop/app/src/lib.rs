//! BrawlTome desktop overlay library entrypoint.
//! Tauri builder + plugin wiring + setup callback that wires the focused modules.

pub mod api_client;
mod detection_bridge;
mod log_prune;
mod overlay;
mod tray;

use tauri::Manager;

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
        .target(Target::new(TargetKind::LogDir { file_name: Some(file_name) }))
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            overlay::set_clickthrough,
            overlay::update_content_bounds,
            detection_bridge::get_detection_state,
        ])
        .setup(|app| {
            // Best-effort: keep the log dir bounded. Runs synchronously on
            // startup; ~tens of ms even with 10+ files, so it's fine before
            // the window is shown.
            if let Ok(log_dir) = app.path().app_log_dir() {
                log_prune::prune_log_dir(&log_dir, 10);
            }

            overlay::position_overlay_window(app.handle())?;

            let overlay_state = overlay::OverlayState::new();
            overlay::spawn_cursor_monitor(app.handle(), overlay_state.clone());
            app.manage(overlay_state);

            tray::install(app.handle())?;

            let detection_state = detection_bridge::DetectionState::new();
            app.manage(detection_state.clone());
            detection_bridge::spawn(app.handle(), detection_state);

            // Open devtools automatically in dev builds. Tauri compiles devtools
            // into debug builds only; this just auto-launches the panel so we
            // don't have to right-click the (transparent, click-through) overlay
            // to find it.
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
