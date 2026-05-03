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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
