#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let window = app.get_webview_window("overlay").unwrap();

            if let Ok(Some(monitor)) = window.primary_monitor() {
                let screen_size = monitor.size();
                let screen_pos = monitor.position();
                let window_width = 350;
                let scale = monitor.scale_factor();

                let x = screen_pos.x + (screen_size.width as i32) - (window_width as f64 * scale) as i32;
                let y = screen_pos.y;
                let height = screen_size.height as f64 / scale;

                window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x, y),
                ))?;
                window.set_size(tauri::Size::Logical(
                    tauri::LogicalSize::new(350.0, height),
                ))?;
            }

            window.set_ignore_cursor_events(true)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
