//! System tray menu: show/hide overlay, open logs, quit.

use crate::overlay::OverlayState;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayEffect {
    HideOverlay,
    ShowOverlay,
    OpenLogs,
    Quit,
    None,
}

pub fn tray_effect(menu_id: &str, overlay_visible: bool) -> TrayEffect {
    match menu_id {
        "toggle" if overlay_visible => TrayEffect::HideOverlay,
        "toggle" => TrayEffect::ShowOverlay,
        "open_logs" => TrayEffect::OpenLogs,
        "quit" => TrayEffect::Quit,
        _ => TrayEffect::None,
    }
}

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
        .on_menu_event(move |app: &AppHandle, event| {
            let overlay = app.get_webview_window("overlay");
            let visible = overlay
                .as_ref()
                .and_then(|window| window.is_visible().ok())
                .unwrap_or(false);
            match tray_effect(event.id().as_ref(), visible) {
                TrayEffect::HideOverlay => {
                    if let Some(window) = overlay {
                        match window.set_ignore_cursor_events(true) {
                            Ok(()) => {
                                let state: tauri::State<Arc<OverlayState>> = app.state();
                                state.clickthrough.store(true, Ordering::Relaxed);
                            }
                            Err(error) => {
                                log::warn!("Could not restore click-through before hiding overlay: {error}")
                            }
                        }
                        if let Err(error) = window.hide() {
                            log::warn!("Could not hide overlay from tray: {error}");
                        }
                    }
                }
                TrayEffect::ShowOverlay => {
                    if let Some(window) = overlay {
                        if let Err(error) = window.show() {
                            log::warn!("Could not show overlay from tray: {error}");
                        }
                    }
                }
                TrayEffect::OpenLogs => {
                    if let Ok(log_dir) = app.path().app_log_dir() {
                        // best-effort, opening Explorer may fail
                        let _ = app.opener().open_path(
                            log_dir.to_string_lossy().into_owned(),
                            None::<String>,
                        );
                    }
                }
                TrayEffect::Quit => {
                    app.exit(0);
                }
                TrayEffect::None => {}
            }
        })
        .build(app)?;

    Ok(())
}
