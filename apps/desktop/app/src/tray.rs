//! System tray menu: open the window, pause the overlay, open the log folder, quit.

use tauri::{
    image::Image,
    menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};
use tauri_plugin_opener::OpenerExt;

use crate::app_status::{AppStatus, DetectionStatus, ServiceStatus};
use crate::main_window;
use crate::session::Input;
use crate::session_runner::SessionHandle;

const TRAY_ID: &str = "tray";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayEffect {
    OpenWindow,
    PauseOverlay,
    ResumeOverlay,
    OpenLogs,
    Quit,
    None,
}

pub fn tray_effect(menu_id: &str, is_overlay_paused: bool) -> TrayEffect {
    match (menu_id, is_overlay_paused) {
        ("open", _) => TrayEffect::OpenWindow,
        ("pause", false) => TrayEffect::PauseOverlay,
        ("pause", true) => TrayEffect::ResumeOverlay,
        ("open_logs", _) => TrayEffect::OpenLogs,
        ("quit", _) => TrayEffect::Quit,
        _ => TrayEffect::None,
    }
}

/// the most pressing state wins: paused, then an update the service demands, then an unknown patch
pub fn tray_tooltip(status: &AppStatus) -> String {
    if status.is_overlay_paused {
        return "BrawlTome: overlay paused".to_string();
    }

    if matches!(status.service, ServiceStatus::UpdateRequired { .. }) {
        return "BrawlTome: update required".to_string();
    }

    if matches!(status.detection, DetectionStatus::Unsupported { .. }) {
        return "BrawlTome: patch not supported".to_string();
    }

    "BrawlTome".to_string()
}

pub fn install(app: &AppHandle, session: SessionHandle) -> tauri::Result<()> {
    let status = session.status();
    let initial_status = status.borrow().clone();

    let open = MenuItemBuilder::with_id("open", "Open BrawlTome").build(app)?;
    let pause = CheckMenuItemBuilder::with_id("pause", "Pause overlay")
        .checked(initial_status.is_overlay_paused)
        .build(app)?;
    let open_logs = MenuItemBuilder::with_id("open_logs", "Open log folder").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&open)
        .item(&pause)
        .item(&open_logs)
        .separator()
        .item(&quit)
        .build()?;

    let session_for_menu = session.clone();
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip(tray_tooltip(&initial_status))
        .on_menu_event(move |app: &AppHandle, event| {
            run_menu_item(app, &session_for_menu, event.id().as_ref())
        })
        .on_tray_icon_event(|tray, event| open_window_on_left_click(tray.app_handle(), &event))
        .build(app)?;

    follow_status(tray, pause, session);

    Ok(())
}

/// returns once the main thread has done it; the update hides the icon itself, because its quit skips tauri's
/// cleanup and would leave the icon in the tray until the pointer passes over it
pub fn set_visible(app: &AppHandle, is_visible: bool) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    if let Err(error) = tray.set_visible(is_visible) {
        log::warn!("set the tray icon visible to {is_visible}: {error}");
    }
}

fn open_window_on_left_click(app: &AppHandle, event: &TrayIconEvent) {
    let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    else {
        return;
    };

    main_window::open(app);
}

fn run_menu_item(app: &AppHandle, session: &SessionHandle, menu_id: &str) {
    let is_overlay_paused = session.status().borrow().is_overlay_paused;

    match tray_effect(menu_id, is_overlay_paused) {
        TrayEffect::OpenWindow => main_window::open(app),
        TrayEffect::PauseOverlay => session.send(Input::OverlayPaused(true)),
        TrayEffect::ResumeOverlay => session.send(Input::OverlayPaused(false)),
        TrayEffect::OpenLogs => open_log_folder(app),
        TrayEffect::Quit => app.exit(0),
        TrayEffect::None => {}
    }
}

/// keeps the check mark and the tooltip in step with the session, whoever changed the pause
fn follow_status(tray: TrayIcon, pause: CheckMenuItem<tauri::Wry>, session: SessionHandle) {
    let mut status = session.status();

    tauri::async_runtime::spawn(async move {
        while status.changed().await.is_ok() {
            let current = status.borrow_and_update().clone();

            if let Err(error) = pause.set_checked(current.is_overlay_paused) {
                log::warn!("update the pause check mark in the tray: {error}");
            }

            if let Err(error) = tray.set_tooltip(Some(tray_tooltip(&current))) {
                log::warn!("update the tray tooltip: {error}");
            }
        }
    });
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
    fn the_menu_maps_to_effects() {
        assert_eq!(tray_effect("open", false), TrayEffect::OpenWindow);
        assert_eq!(tray_effect("open", true), TrayEffect::OpenWindow);
        assert_eq!(tray_effect("pause", false), TrayEffect::PauseOverlay);
        assert_eq!(tray_effect("pause", true), TrayEffect::ResumeOverlay);
        assert_eq!(tray_effect("open_logs", false), TrayEffect::OpenLogs);
        assert_eq!(tray_effect("quit", false), TrayEffect::Quit);
        assert_eq!(tray_effect("quit", true), TrayEffect::Quit);
        assert_eq!(tray_effect("other", false), TrayEffect::None);
    }

    #[test]
    fn the_tooltip_names_the_most_pressing_state() {
        let mut status = AppStatus::default();
        assert_eq!(tray_tooltip(&status), "BrawlTome");

        status.detection = DetectionStatus::Unsupported {
            message: "Patch 11.01 isn't supported yet".to_string(),
        };
        assert_eq!(tray_tooltip(&status), "BrawlTome: patch not supported");

        status.service = ServiceStatus::UpdateRequired {
            minimum_version: "0.3.0".to_string(),
        };
        assert_eq!(tray_tooltip(&status), "BrawlTome: update required");

        status.is_overlay_paused = true;
        assert_eq!(tray_tooltip(&status), "BrawlTome: overlay paused");
    }
}
