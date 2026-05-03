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
