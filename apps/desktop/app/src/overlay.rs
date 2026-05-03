//! Overlay window state + commands + cursor forwarding + window positioning.

use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Manager};
#[cfg(target_os = "windows")]
use tokio::time::{sleep, Duration};

/// Screen-space bounding box of interactive content, updated by the frontend.
pub struct ContentBounds {
    pub x: AtomicI32,
    pub y: AtomicI32,
    pub w: AtomicI32,
    pub h: AtomicI32,
}

pub struct OverlayState {
    pub clickthrough: AtomicBool,
    pub bounds: ContentBounds,
}

impl OverlayState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            clickthrough: AtomicBool::new(true),
            bounds: ContentBounds {
                x: AtomicI32::new(0),
                y: AtomicI32::new(0),
                w: AtomicI32::new(0),
                h: AtomicI32::new(0),
            },
        })
    }
}

#[tauri::command]
pub fn set_clickthrough(
    window: tauri::Window,
    ignore: bool,
    state: tauri::State<'_, Arc<OverlayState>>,
) {
    let _ = window.set_ignore_cursor_events(ignore);
    state.clickthrough.store(ignore, Ordering::Relaxed);
}

#[tauri::command]
pub fn update_content_bounds(
    window: tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, Arc<OverlayState>>,
) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let win_pos = window
        .outer_position()
        .unwrap_or(tauri::PhysicalPosition::new(0, 0));

    state.bounds.x.store(win_pos.x + (x * scale) as i32, Ordering::Relaxed);
    state.bounds.y.store(win_pos.y + (y * scale) as i32, Ordering::Relaxed);
    state.bounds.w.store((width * scale) as i32, Ordering::Relaxed);
    state.bounds.h.store((height * scale) as i32, Ordering::Relaxed);
}

/// Run the initial window positioning + Windows window-style tweaks.
/// Call from the Tauri `setup` callback before spawning the cursor monitor.
pub fn position_overlay_window(app: &AppHandle) -> tauri::Result<()> {
    let window = app
        .get_webview_window("overlay")
        .expect("overlay window must exist");

    if let Ok(Some(monitor)) = window.primary_monitor() {
        let screen_size = monitor.size();
        let screen_pos = monitor.position();
        let window_width = 350;
        let scale = monitor.scale_factor();

        let x = screen_pos.x + (screen_size.width as i32) - (window_width as f64 * scale) as i32;
        let y = screen_pos.y;
        let height = screen_size.height as f64 / scale;

        window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y)))?;
        window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(350.0, height)))?;
    }

    #[cfg(target_os = "windows")]
    window.set_ignore_cursor_events(true)?;

    // Prevent the overlay from stealing focus when clicked.
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
        };
        let hwnd = window.hwnd().unwrap().0 as *mut std::ffi::c_void;
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | WS_EX_NOACTIVATE as isize);
        }
    }

    Ok(())
}

/// Spawn the background task that disables click-through when the cursor is
/// inside the content bounding box reported by the frontend.
#[cfg(target_os = "windows")]
pub fn spawn_cursor_monitor(app: &AppHandle, state: Arc<OverlayState>) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use windows_sys::Win32::Foundation::POINT;
        use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

        loop {
            sleep(Duration::from_millis(16)).await;

            if !state.clickthrough.load(Ordering::Relaxed) {
                continue;
            }

            let bw = state.bounds.w.load(Ordering::Relaxed);
            let bh = state.bounds.h.load(Ordering::Relaxed);
            if bw == 0 || bh == 0 {
                continue;
            }

            let mut pt = POINT { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut pt) } == 0 {
                continue;
            }

            let bx = state.bounds.x.load(Ordering::Relaxed);
            let by = state.bounds.y.load(Ordering::Relaxed);

            if pt.x >= bx && pt.x < bx + bw && pt.y >= by && pt.y < by + bh {
                if let Some(w) = handle.get_webview_window("overlay") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.set_ignore_cursor_events(false);
                        state.clickthrough.store(false, Ordering::Relaxed);
                    }
                }
            }
        }
    });
}

/// No-op on non-Windows so calling code doesn't need cfg gating.
#[cfg(not(target_os = "windows"))]
pub fn spawn_cursor_monitor(_app: &AppHandle, _state: Arc<OverlayState>) {}
