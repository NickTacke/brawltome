//! Plain tauri window calls, so the app runs on a mac during development; windows uses win32.rs.

use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

use super::placement::Rect;

pub fn make_never_activate(_window: &WebviewWindow) {}

pub fn place(window: &WebviewWindow, rect: Rect) -> Result<(), String> {
    let size = PhysicalSize::new(rect.width, rect.height);
    let position = PhysicalPosition::new(rect.x, rect.y);

    window
        .set_size(size)
        .and_then(|()| window.set_position(position))
        .and_then(|()| window.show())
        .map_err(|error| format!("place the overlay window at {},{}: {error}", rect.x, rect.y))
}

pub fn hide(window: &WebviewWindow) -> Result<(), String> {
    window
        .hide()
        .map_err(|error| format!("hide the overlay window: {error}"))
}

/// there is no game to find outside windows
pub fn game_window_center(_process_id: u32) -> Option<(i32, i32)> {
    None
}
