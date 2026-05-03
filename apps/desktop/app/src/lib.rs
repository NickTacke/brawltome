//! BrawlTome desktop overlay library entrypoint.
//! Tauri builder + plugin wiring + setup callback that wires the focused modules.

#[cfg(target_os = "windows")]
mod api_client;
mod detection_bridge;
mod overlay;
mod tray;

use tauri::Manager;

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            overlay::set_clickthrough,
            overlay::update_content_bounds,
        ])
        .setup(|app| {
            overlay::position_overlay_window(app.handle())?;

            let overlay_state = overlay::OverlayState::new();
            overlay::spawn_cursor_monitor(app.handle(), overlay_state.clone());
            app.manage(overlay_state);

            tray::install(app.handle())?;

            detection_bridge::spawn(app.handle());

            // Background update check on startup. Silent: download + queue install
            // for next launch. Skipped in dev builds so cargo run doesn't try to
            // update itself.
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_updater::UpdaterExt;
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match app_handle.updater() {
                        Ok(updater) => match updater.check().await {
                            Ok(Some(update)) => {
                                log::info!(
                                    "Update available: {} -> {}",
                                    update.current_version,
                                    update.version
                                );
                                if let Err(e) = update.download_and_install(|_, _| {}, || {}).await {
                                    log::warn!("Update install failed: {e}");
                                } else {
                                    log::info!("Update queued; will apply on next launch");
                                }
                            }
                            Ok(None) => log::debug!("No update available"),
                            Err(e) => log::warn!("Update check failed: {e}"),
                        },
                        Err(e) => log::warn!("Updater not available: {e}"),
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
