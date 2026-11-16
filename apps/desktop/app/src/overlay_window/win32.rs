//! The Win32 calls that put the overlay on screen without taking focus from the game.

use std::mem;

use windows_sys::Win32::Foundation::{GetLastError, SetLastError, BOOL, HWND, LPARAM, RECT};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowLongW, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
    SetWindowLongW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE,
    SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, WS_EX_NOACTIVATE,
};

use super::placement::Rect;

/// moves, sizes, raises and shows in one call that cannot activate the window
pub fn place_without_activating(window_handle: isize, rect: Rect) -> Result<(), String> {
    let width = i32::try_from(rect.width).map_err(|_| {
        format!(
            "place the overlay window: width {} is too large",
            rect.width
        )
    })?;
    let height = i32::try_from(rect.height).map_err(|_| {
        format!(
            "place the overlay window: height {} is too large",
            rect.height
        )
    })?;

    // SAFETY: SetWindowPos only reads its arguments; a stale handle makes it fail, not crash
    let succeeded = unsafe {
        SetWindowPos(
            window_handle as HWND,
            HWND_TOPMOST,
            rect.x,
            rect.y,
            width,
            height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
    };
    if succeeded == 0 {
        // SAFETY: GetLastError reads the calling thread's own error code
        let error_code = unsafe { GetLastError() };
        return Err(format!(
            "place the overlay window at {},{} size {}x{}: SetWindowPos failed with error {error_code}",
            rect.x, rect.y, rect.width, rect.height
        ));
    }

    Ok(())
}

/// adds WS_EX_NOACTIVATE when it is missing; true when it had to
pub fn ensure_never_activates(window_handle: isize) -> bool {
    let handle = window_handle as HWND;

    let Some(extended_style) = read_extended_style(handle) else {
        return false;
    };
    if extended_style & WS_EX_NOACTIVATE != 0 {
        return false;
    }

    if !write_extended_style(handle, extended_style | WS_EX_NOACTIVATE) {
        return false;
    }

    // the style is cached until the frame is told it changed
    // SAFETY: SetWindowPos only refreshes this window's cached frame
    unsafe {
        SetWindowPos(
            handle,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }

    true
}

/// None when the read failed; GetWindowLongW returns 0 for both "no style" and "bad handle"
fn read_extended_style(handle: HWND) -> Option<u32> {
    // SAFETY: both calls only touch the calling thread's error code and read the window
    let (style, error_code) = unsafe {
        SetLastError(0);
        let style = GetWindowLongW(handle, GWL_EXSTYLE);
        (style, GetLastError())
    };
    if style == 0 && error_code != 0 {
        return None;
    }

    Some(style as u32)
}

/// false when the write failed; SetWindowLongW returns the old value, which can be 0
fn write_extended_style(handle: HWND, extended_style: u32) -> bool {
    // SAFETY: SetWindowLongW only changes this window's style
    let (previous_style, error_code) = unsafe {
        SetLastError(0);
        let previous_style = SetWindowLongW(handle, GWL_EXSTYLE, extended_style as i32);
        (previous_style, GetLastError())
    };

    previous_style != 0 || error_code == 0
}

/// centre of the largest visible top-level window of the process
pub fn game_window_center(process_id: u32) -> Option<(i32, i32)> {
    // process 0 is the idle process, and a failed owner lookup also reports 0
    if process_id == 0 {
        return None;
    }

    let mut search = WindowSearch {
        process_id,
        largest: None,
    };

    // SAFETY: the callback only runs inside this call, while `search` is alive and not aliased
    unsafe {
        EnumWindows(
            Some(visit_window),
            &mut search as *mut WindowSearch as LPARAM,
        );
    }

    let window = search.largest?;

    Some((
        window.left + (window.right - window.left) / 2,
        window.top + (window.bottom - window.top) / 2,
    ))
}

struct WindowSearch {
    process_id: u32,
    largest: Option<RECT>,
}

/// keeps the largest visible window of the wanted process; always asks for the next window
unsafe extern "system" fn visit_window(window: HWND, search_address: LPARAM) -> BOOL {
    const KEEP_ENUMERATING: BOOL = 1;

    // SAFETY: `search_address` is the `&mut WindowSearch` passed to EnumWindows by game_window_center
    let search = unsafe { &mut *(search_address as *mut WindowSearch) };

    let mut window_process_id = 0u32;
    // SAFETY: both calls take the window handle EnumWindows just handed us and a valid out pointer
    let is_visible = unsafe { IsWindowVisible(window) } != 0;
    unsafe { GetWindowThreadProcessId(window, &mut window_process_id) };
    let is_wanted_process = window_process_id != 0 && window_process_id == search.process_id;
    if !is_visible || !is_wanted_process {
        return KEEP_ENUMERATING;
    }

    // SAFETY: an all-zero RECT is valid, and GetWindowRect fills it
    let mut bounds: RECT = unsafe { mem::zeroed() };
    if unsafe { GetWindowRect(window, &mut bounds) } == 0 {
        return KEEP_ENUMERATING;
    }

    let area = window_area(&bounds);
    let largest_area = search.largest.as_ref().map_or(0, window_area);
    if area > largest_area {
        search.largest = Some(bounds);
    }

    KEEP_ENUMERATING
}

fn window_area(bounds: &RECT) -> i64 {
    let width = i64::from(bounds.right) - i64::from(bounds.left);
    let height = i64::from(bounds.bottom) - i64::from(bounds.top);

    width.max(0) * height.max(0)
}

#[cfg(test)]
mod tests {
    use std::ptr::null;
    use std::ptr::null_mut;

    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DestroyWindow, GetForegroundWindow, WS_EX_TOPMOST, WS_POPUP,
    };

    use super::*;

    /// a hidden popup of the system "STATIC" class, destroyed when dropped
    struct TestWindow(HWND);

    impl TestWindow {
        fn new() -> Self {
            let class_name: Vec<u16> = "STATIC\0".encode_utf16().collect();
            // SAFETY: the class is a system class and every pointer argument is null or valid
            let handle = unsafe {
                CreateWindowExW(
                    0,
                    class_name.as_ptr(),
                    null(),
                    WS_POPUP,
                    0,
                    0,
                    10,
                    10,
                    null_mut(),
                    null_mut(),
                    null_mut(),
                    null(),
                )
            };
            assert!(!handle.is_null(), "create the test window");

            Self(handle)
        }

        fn handle(&self) -> isize {
            self.0 as isize
        }
    }

    impl Drop for TestWindow {
        fn drop(&mut self) {
            // SAFETY: the window was created on this thread and is destroyed once
            unsafe { DestroyWindow(self.0) };
        }
    }

    #[test]
    fn placing_shows_the_window_where_asked_and_keeps_the_foreground() {
        let window = TestWindow::new();
        // SAFETY: GetForegroundWindow takes no arguments
        let foreground_before = unsafe { GetForegroundWindow() };

        let placed = place_without_activating(
            window.handle(),
            Rect {
                x: 40,
                y: 50,
                width: 340,
                height: 131,
            },
        );

        assert_eq!(placed, Ok(()));
        // SAFETY: the handle is the live test window; the RECT is a valid out pointer
        let is_visible = unsafe { IsWindowVisible(window.0) } != 0;
        let mut bounds: RECT = unsafe { mem::zeroed() };
        unsafe { GetWindowRect(window.0, &mut bounds) };
        let foreground_after = unsafe { GetForegroundWindow() };
        let extended_style = unsafe { GetWindowLongW(window.0, GWL_EXSTYLE) } as u32;
        assert!(is_visible);
        assert_eq!(
            (bounds.left, bounds.top, bounds.right, bounds.bottom),
            (40, 50, 380, 181)
        );
        assert_eq!(foreground_after, foreground_before);
        assert_ne!(foreground_after, window.0);
        assert_ne!(extended_style & WS_EX_TOPMOST, 0);
    }

    #[test]
    fn a_window_that_could_activate_is_fixed() {
        let window = TestWindow::new();

        assert!(ensure_never_activates(window.handle()));
        assert!(!ensure_never_activates(window.handle()));
    }

    #[test]
    fn an_invalid_handle_is_not_fixed() {
        assert!(!ensure_never_activates(0));
    }

    #[test]
    fn a_process_without_windows_has_no_centre() {
        assert_eq!(game_window_center(0), None);
    }
}
