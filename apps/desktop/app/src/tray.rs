//! System tray icon + menu (Show/Hide, Quit) + click handlers.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
use tauri_plugin_shell::ShellExt;

use crate::overlay::OverlayState;

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItemBuilder::with_id("toggle", "Show/Hide").build(app)?;
    let open_logs = MenuItemBuilder::with_id("open_logs", "Open log folder").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&toggle)
        .item(&open_logs)
        .separator()
        .item(&quit)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .menu(&menu)
        .tooltip("BrawlTome")
        .on_menu_event(move |app: &AppHandle, event| match event.id().as_ref() {
            "toggle" => {
                if let Some(w) = app.get_webview_window("overlay") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.set_ignore_cursor_events(true);
                        let st: tauri::State<Arc<OverlayState>> = app.state();
                        st.clickthrough.store(true, Ordering::Relaxed);
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                    }
                }
            }
            "open_logs" => {
                if let Ok(log_dir) = app.path().app_log_dir() {
                    if let Some(path_str) = log_dir.to_str() {
                        // Opens the dir in Windows Explorer (or platform equivalent) via
                        // the shell plugin. Errors are silently ignored: this is a UX
                        // affordance, not a critical operation.
                        let _ = app.shell().open(path_str, None);
                    }
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(())
}
