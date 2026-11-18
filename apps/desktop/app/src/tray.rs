//! System tray menu: open the log folder, quit.

use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayEffect {
    OpenLogs,
    Quit,
    None,
}

pub fn tray_effect(menu_id: &str) -> TrayEffect {
    match menu_id {
        "open_logs" => TrayEffect::OpenLogs,
        "quit" => TrayEffect::Quit,
        _ => TrayEffect::None,
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let open_logs = MenuItemBuilder::with_id("open_logs", "Open log folder").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&open_logs)
        .separator()
        .item(&quit)
        .build()?;

    let _tray = TrayIconBuilder::new()
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .menu(&menu)
        .tooltip("BrawlTome")
        .on_menu_event(|app: &AppHandle, event| run_menu_item(app, event.id().as_ref()))
        .build(app)?;

    Ok(())
}

fn run_menu_item(app: &AppHandle, menu_id: &str) {
    match tray_effect(menu_id) {
        TrayEffect::OpenLogs => open_log_folder(app),
        TrayEffect::Quit => app.exit(0),
        TrayEffect::None => {}
    }
}

fn open_log_folder(app: &AppHandle) {
    let log_dir = match app.path().app_log_dir() {
        Ok(log_dir) => log_dir,
        Err(error) => {
            log::warn!("find the log folder to open: {error}");
            return;
        }
    };

    let opened = app
        .opener()
        .open_path(log_dir.to_string_lossy().into_owned(), None::<String>);
    if let Err(error) = opened {
        log::warn!("open the log folder {}: {error}", log_dir.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_items_map_to_their_effects() {
        assert_eq!(tray_effect("open_logs"), TrayEffect::OpenLogs);
        assert_eq!(tray_effect("quit"), TrayEffect::Quit);
        assert_eq!(tray_effect("toggle"), TrayEffect::None);
    }
}
