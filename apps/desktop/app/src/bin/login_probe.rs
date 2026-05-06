//! Login-readiness probe for the v0.2.0 detection rewrite.
//!
//! Captures Brawlhalla window-state transitions during launch and login so
//! we can identify a cheap, reliable signal that says "Brawlhalla is logged
//! in, scan now." Today the detection cycle starts polling `find_my_bhid`
//! immediately after attaching to the process, which costs ~55 s of wasted
//! full-heap scanning during pre-login. The rewrite's Probing state will
//! gate `find_my_bhid` on this signal.
//!
//! Usage:
//!   1. Start this probe BEFORE launching Brawlhalla (so we catch the
//!      pre-process state too):
//!        cargo run -p brawltome-desktop --bin login_probe \
//!          --features login-probe-tool --release
//!   2. Launch Brawlhalla. Wait through splash, login screen, log in,
//!      reach the main menu.
//!   3. Press Ctrl+C to stop the probe.
//!
//! Output:
//!   %LOCALAPPDATA%\com.brawltome.overlay\dumps\login_probe_<launch_ts>.txt
//!
//! Each line records: ISO-ish timestamp, Brawlhalla.exe pid (or
//! "not_running"), and one entry per top-level window owned by the process
//! formatted as `[<visible flag><title flag>] "<title>" / <class>`.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use brawltome_detection::memory;

use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, TRUE};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible,
};

const POLL_INTERVAL: Duration = Duration::from_millis(1000);

#[derive(Debug, Clone)]
struct WindowInfo {
    title: String,
    class: String,
    visible: bool,
}

struct EnumCtx {
    target_pid: u32,
    windows: Vec<WindowInfo>,
}

extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
    // Safety: lparam was set by the only caller of EnumWindows below to a
    // pointer to a stack-resident EnumCtx that outlives the call.
    let ctx = unsafe { &mut *(lparam as *mut EnumCtx) };

    let mut wnd_pid: u32 = 0;
    unsafe {
        GetWindowThreadProcessId(hwnd, &mut wnd_pid);
    }
    if wnd_pid != ctx.target_pid {
        return TRUE;
    }

    let mut title_buf = [0u16; 256];
    let title_len =
        unsafe { GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32) };
    let title = String::from_utf16_lossy(&title_buf[..title_len.max(0) as usize]);

    let mut class_buf = [0u16; 256];
    let class_len =
        unsafe { GetClassNameW(hwnd, class_buf.as_mut_ptr(), class_buf.len() as i32) };
    let class = String::from_utf16_lossy(&class_buf[..class_len.max(0) as usize]);

    let visible = unsafe { IsWindowVisible(hwnd) != 0 };

    ctx.windows.push(WindowInfo {
        title,
        class,
        visible,
    });
    TRUE
}

fn enumerate_windows_for_pid(pid: u32) -> Vec<WindowInfo> {
    let mut ctx = EnumCtx {
        target_pid: pid,
        windows: Vec::new(),
    };
    unsafe {
        EnumWindows(Some(enum_proc), &mut ctx as *mut _ as LPARAM);
    }
    ctx.windows
}

fn main() {
    let launch_ts = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let local_appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    let dumps_dir = PathBuf::from(local_appdata)
        .join("com.brawltome.overlay")
        .join("dumps");
    if let Err(e) = std::fs::create_dir_all(&dumps_dir) {
        eprintln!("Couldn't create {}: {}", dumps_dir.display(), e);
        std::process::exit(1);
    }
    let session_path = dumps_dir.join(format!("login_probe_{launch_ts}.txt"));
    println!("Login probe running. Output: {}", session_path.display());
    println!("Launch Brawlhalla now. Press Ctrl+C when you've reached the main menu.");

    let mut log_file = match OpenOptions::new()
        .create(true)
        .append(true)
        .open(&session_path)
    {
        Ok(f) => f,
        Err(e) => {
            eprintln!("Couldn't open session file: {e}");
            std::process::exit(1);
        }
    };

    let _ = writeln!(log_file, "=== BrawlTome login-readiness probe ===");
    let _ = writeln!(log_file, "Launch timestamp: {launch_ts}");
    let _ = writeln!(log_file, "Polling every {} ms", POLL_INTERVAL.as_millis());
    let _ = writeln!(log_file);

    loop {
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        match memory::find_process_id("Brawlhalla.exe") {
            None => {
                let line = format!("[{now}] not_running");
                println!("{line}");
                let _ = writeln!(log_file, "{line}");
            }
            Some(pid) => {
                let windows = enumerate_windows_for_pid(pid);
                let summary: String = if windows.is_empty() {
                    "(no top-level windows)".to_string()
                } else {
                    windows
                        .iter()
                        .map(|w| {
                            format!(
                                "[{}{}] \"{}\" / {}",
                                if w.visible { 'V' } else { '_' },
                                if w.title.is_empty() { '_' } else { 'T' },
                                w.title,
                                w.class
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(" | ")
                };
                let line = format!("[{now}] pid={pid} windows={}: {}", windows.len(), summary);
                println!("{line}");
                let _ = writeln!(log_file, "{line}");
            }
        }

        std::thread::sleep(POLL_INTERVAL);
    }
}
