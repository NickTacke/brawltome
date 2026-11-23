//! Open, close and place the main window; its commands and the status it is sent.

use std::sync::{Mutex, PoisonError};

use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, WebviewWindowBuilder,
};
use tokio::sync::watch;

use crate::app_status::AppStatus;
use crate::overlay_window::Rect;
use crate::session::Input;
use crate::session_runner::SessionHandle;

const MAIN_LABEL: &str = "main";
const STATUS_EVENT: &str = "app://status";

/// distance from the work area's edges, as in the mockup
const EDGE_MARGIN_PX: i64 = 16;

/// one open at a time, so two quick clicks on the tray can't both build the window
static OPENING: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MainWindowState {
    Closed,
    Hidden,
    OnScreen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpenSteps {
    pub should_create: bool,
    pub should_place: bool,
}

/// a closed window is built again from its config; a window already on screen stays where the player put it
pub fn open_steps(state: MainWindowState) -> OpenSteps {
    match state {
        MainWindowState::Closed => OpenSteps {
            should_create: true,
            should_place: true,
        },
        MainWindowState::Hidden => OpenSteps {
            should_create: false,
            should_place: true,
        },
        MainWindowState::OnScreen => OpenSteps {
            should_create: false,
            should_place: false,
        },
    }
}

/// build the window if it was closed, then place, show and focus it
pub fn open(app: &AppHandle) {
    let app = app.clone();

    // off the main thread: on windows, building a webview from a tray or second-launch handler there deadlocks
    tauri::async_runtime::spawn_blocking(move || open_now(&app));
}

fn open_now(app: &AppHandle) {
    // a poisoned lock only means an earlier open panicked; opening again is still right
    let _opening = OPENING.lock().unwrap_or_else(PoisonError::into_inner);

    let existing = app.get_webview_window(MAIN_LABEL);
    let steps = open_steps(window_state(existing.as_ref()));

    let window = if steps.should_create {
        create(app)
    } else {
        existing
    };
    let Some(window) = window else {
        return;
    };

    if steps.should_place {
        place(&window);
    }

    show(&window);
}

fn window_state(window: Option<&WebviewWindow>) -> MainWindowState {
    let Some(window) = window else {
        return MainWindowState::Closed;
    };

    if window.is_visible().unwrap_or(false) {
        return MainWindowState::OnScreen;
    }

    MainWindowState::Hidden
}

/// from its entry in tauri.conf.json, which tauri skips at start
fn create(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = &app.config().app.windows;
    let Some(config) = windows.iter().find(|config| config.label == MAIN_LABEL) else {
        log::error!("build the main window: tauri.conf.json has no window labelled {MAIN_LABEL}");
        return None;
    };

    let built = WebviewWindowBuilder::from_config(app, config).and_then(|builder| builder.build());

    match built {
        Ok(window) => Some(window),
        Err(error) => {
            log::error!("build the main window: {error}");
            None
        }
    }
}

fn show(window: &WebviewWindow) {
    let shown = window
        .show()
        .and_then(|()| window.unminimize())
        .and_then(|()| window.set_focus());

    if let Err(error) = shown {
        log::warn!("show the main window: {error}");
    }
}

/// sends the page every new status
pub fn forward_status(app: &AppHandle, mut status: watch::Receiver<AppStatus>) {
    let app = app.clone();

    tauri::async_runtime::spawn(async move {
        while status.changed().await.is_ok() {
            let current = status.borrow_and_update().clone();

            // nothing is drawn during a match; the change that ends it carries everything new
            if current.is_match_running {
                continue;
            }

            if let Err(error) = app.emit_to(MAIN_LABEL, STATUS_EVENT, &current) {
                log::warn!("send the app status to the main window: {error}");
            }
        }
    });
}

/// bottom right of the primary monitor's work area, clear of the taskbar
fn place(window: &WebviewWindow) {
    let monitor = match window.primary_monitor() {
        Ok(Some(monitor)) => monitor,
        Ok(None) => return,
        Err(error) => {
            log::warn!("find the monitor for the main window: {error}");
            return;
        }
    };
    let size = match window.outer_size() {
        Ok(size) => size,
        Err(error) => {
            log::warn!("read the main window's size: {error}");
            return;
        }
    };

    let work_area = monitor.work_area();
    let work_area = Rect {
        x: work_area.position.x,
        y: work_area.position.y,
        width: work_area.size.width,
        height: work_area.size.height,
    };
    let (x, y) = main_window_position(work_area, size.width, size.height);

    if let Err(error) = window.set_position(PhysicalPosition::new(x, y)) {
        log::warn!("place the main window at {x},{y}: {error}");
    }
}

#[tauri::command]
pub fn get_app_status(session: State<'_, SessionHandle>) -> AppStatus {
    let status = session.status();
    let current = status.borrow().clone();

    current
}

/// the title bar's close, the same as alt+f4: the window goes, and its webview's memory with it
///
/// async, so the close reaches the window through the event loop after this call, not inside it
#[tauri::command]
pub async fn close_main_window(window: WebviewWindow) {
    if let Err(error) = window.close() {
        log::warn!("close the main window: {error}");
    }
}

#[tauri::command]
pub fn set_overlay_paused(is_paused: bool, session: State<'_, SessionHandle>) {
    session.send(Input::OverlayPaused(is_paused));
}

/// bottom right of the work area, 16 px in, as in the mockup
pub fn main_window_position(
    work_area: Rect,
    window_width_px: u32,
    window_height_px: u32,
) -> (i32, i32) {
    // a window bigger than the work area keeps its title bar on screen, where it can be dragged
    let x = offset_from_start(work_area.width, window_width_px);
    let y = offset_from_start(work_area.height, window_height_px);

    (work_area.x + x, work_area.y + y)
}

/// how far in from the start a window ends one margin before the far edge; never before the start
fn offset_from_start(work_area_length_px: u32, window_length_px: u32) -> i32 {
    let offset = i64::from(work_area_length_px) - i64::from(window_length_px) - EDGE_MARGIN_PX;

    i32::try_from(offset.max(0)).unwrap_or(i32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opening_builds_only_a_closed_window_and_places_only_a_hidden_one() {
        let cases = [
            (
                MainWindowState::Closed,
                OpenSteps {
                    should_create: true,
                    should_place: true,
                },
            ),
            (
                MainWindowState::Hidden,
                OpenSteps {
                    should_create: false,
                    should_place: true,
                },
            ),
            (
                MainWindowState::OnScreen,
                OpenSteps {
                    should_create: false,
                    should_place: false,
                },
            ),
        ];

        for (state, steps) in cases {
            assert_eq!(open_steps(state), steps, "{state:?}");
        }
    }

    #[test]
    fn sits_in_the_bottom_right_of_the_work_area() {
        let work_area = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1032,
        };

        assert_eq!(main_window_position(work_area, 400, 620), (1504, 396));
    }

    #[test]
    fn stays_on_a_work_area_that_starts_off_origin() {
        let work_area = Rect {
            x: -2560,
            y: 0,
            width: 2560,
            height: 1392,
        };

        assert_eq!(main_window_position(work_area, 400, 620), (-416, 756));
    }

    #[test]
    fn a_window_bigger_than_the_work_area_keeps_its_top_left_corner_on_it() {
        let work_area = Rect {
            x: 0,
            y: 0,
            width: 1280,
            height: 600,
        };

        assert_eq!(main_window_position(work_area, 400, 620), (864, 0));
    }
}
