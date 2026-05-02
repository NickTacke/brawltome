#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "windows")]
mod api_client;

use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Arc;
use tauri::{
    Manager,
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
};
use tokio::time::{sleep, Duration};

#[cfg(target_os = "windows")]
use brawltome_events::{DetectionConfig, DetectionService, GameEvent};

#[cfg(target_os = "windows")]
#[derive(serde::Serialize, Clone)]
struct LegacyMatchFound {
    event: &'static str,
    opponents: Vec<api_client::OpponentData>,
    #[serde(rename = "isRanked")]
    is_ranked: bool,
    #[serde(rename = "localPlayerId")]
    local_player_id: u32,
}

#[cfg(target_os = "windows")]
#[derive(serde::Serialize, Clone)]
struct LegacyMatchEnded {
    event: &'static str,
}

#[cfg(target_os = "windows")]
#[derive(serde::Serialize, Clone)]
struct LegacyScanning {
    event: &'static str,
}

/// Screen-space bounding box of interactive content, updated by the frontend.
struct ContentBounds {
    x: AtomicI32,
    y: AtomicI32,
    w: AtomicI32,
    h: AtomicI32,
}

struct OverlayState {
    clickthrough: AtomicBool,
    bounds: ContentBounds,
}

#[tauri::command]
fn set_clickthrough(
    window: tauri::Window,
    ignore: bool,
    state: tauri::State<'_, Arc<OverlayState>>,
) {
    let _ = window.set_ignore_cursor_events(ignore);
    state.clickthrough.store(ignore, Ordering::Relaxed);
}

/// Called by the frontend whenever the card panel resizes/moves.
#[tauri::command]
fn update_content_bounds(
    window: tauri::Window,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    state: tauri::State<'_, Arc<OverlayState>>,
) {
    // x/y from getBoundingClientRect are relative to the webview.
    // Convert to screen coordinates using the window position.
    let scale = window.scale_factor().unwrap_or(1.0);
    let win_pos = window.outer_position().unwrap_or(tauri::PhysicalPosition::new(0, 0));

    state.bounds.x.store(win_pos.x + (x * scale) as i32, Ordering::Relaxed);
    state.bounds.y.store(win_pos.y + (y * scale) as i32, Ordering::Relaxed);
    state.bounds.w.store((width * scale) as i32, Ordering::Relaxed);
    state.bounds.h.store((height * scale) as i32, Ordering::Relaxed);
}

fn main() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![set_clickthrough, update_content_bounds])
        .setup(|app| {
            let window = app.get_webview_window("overlay").unwrap();

            // Position window on right edge
            if let Ok(Some(monitor)) = window.primary_monitor() {
                let screen_size = monitor.size();
                let screen_pos = monitor.position();
                let window_width = 350;
                let scale = monitor.scale_factor();

                let x = screen_pos.x + (screen_size.width as i32)
                    - (window_width as f64 * scale) as i32;
                let y = screen_pos.y;
                let height = screen_size.height as f64 / scale;

                window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x, y),
                ))?;
                window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                    350.0, height,
                )))?;
            }

            // Start with click-through enabled
            #[cfg(target_os = "windows")]
            window.set_ignore_cursor_events(true)?;

            // Prevent the overlay from stealing focus when clicked
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

            let overlay_state = Arc::new(OverlayState {
                clickthrough: AtomicBool::new(true),
                bounds: ContentBounds {
                    x: AtomicI32::new(0),
                    y: AtomicI32::new(0),
                    w: AtomicI32::new(0),
                    h: AtomicI32::new(0),
                },
            });

            // Cursor position monitor: only disables click-through when the
            // cursor is over the content bounding box reported by the frontend.
            #[cfg(target_os = "windows")]
            {
                let handle = app.handle().clone();
                let state = overlay_state.clone();
                tauri::async_runtime::spawn(async move {
                    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
                    use windows_sys::Win32::Foundation::POINT;

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

            app.manage(overlay_state);

            // Build tray menu
            let toggle = MenuItemBuilder::with_id("toggle", "Show/Hide").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&toggle)
                .separator()
                .item(&quit)
                .build()?;

            // Build tray icon
            let _tray = TrayIconBuilder::new()
                .icon(Image::from_bytes(include_bytes!("../icons/tray.png"))?)
                .menu(&menu)
                .tooltip("BrawlTome Overlay")
                .on_menu_event(move |app: &tauri::AppHandle, event| {
                    match event.id().as_ref() {
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
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            #[cfg(target_os = "windows")]
            {
                let app_handle = app.handle().clone();
                let api_url = std::env::var("BRAWLTOME_API_URL")
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|_| "https://brawltome.app".into());

                tauri::async_runtime::spawn(async move {
                    use std::collections::HashMap;
                    use tauri::Emitter;

                    let api = std::sync::Arc::new(api_client::ApiClient::new(api_url));
                    let (event_tx, mut event_rx) = tokio::sync::mpsc::channel::<GameEvent>(32);

                    // Now inside Tokio runtime context, so the inner `tokio::spawn` in start() works.
                    let svc = brawltome_detection::WindowsDetectionService;
                    let _detection_handle = svc.start(
                        DetectionConfig {
                            target_process: "Brawlhalla.exe".into(),
                            poll_interval_ms: 100,
                        },
                        event_tx,
                    ).expect("detection failed to start");

                    let mut opponent_cache: HashMap<u32, api_client::OpponentData> = HashMap::new();

                    while let Some(event) = event_rx.recv().await {
                        match event {
                            GameEvent::Scanning(_) => {
                                let _ = app_handle.emit("game-event", &LegacyScanning { event: "scanning" });
                            }
                            GameEvent::MatchEnded(p) => {
                                opponent_cache.clear();
                                let _ = app_handle.emit("game-event", &LegacyMatchEnded { event: "match_ended" });
                                let _ = p; // local_player_bhid currently unused on the React side
                            }
                            GameEvent::MatchStarted(p) => {
                                // Fetch opponent data for any BhIDs not already cached.
                                let new_bhids: Vec<u32> = p.opponent_bhids.iter()
                                    .filter(|bhid| !opponent_cache.contains_key(bhid))
                                    .copied()
                                    .collect();

                                let mut fetches = Vec::new();
                                for bhid in new_bhids {
                                    let api = api.clone();
                                    fetches.push(tokio::spawn(async move {
                                        (bhid, api.fetch_opponent(bhid).await)
                                    }));
                                }
                                for task in fetches {
                                    match task.await {
                                        Ok((bhid, Ok(data))) => { opponent_cache.insert(bhid, data); }
                                        Ok((bhid, Err(e))) => log::warn!("Failed to fetch bhid {bhid}: {e}"),
                                        Err(e) => log::warn!("Fetch task panicked: {e}"),
                                    }
                                }

                                let opponents: Vec<api_client::OpponentData> = p.opponent_bhids.iter()
                                    .filter_map(|bhid| opponent_cache.get(bhid).cloned())
                                    .collect();

                                if !opponents.is_empty() {
                                    let is_ranked = opponents.len() == 1;
                                    let _ = app_handle.emit("game-event", &LegacyMatchFound {
                                        event: "match_found",
                                        opponents,
                                        is_ranked,
                                        local_player_id: p.local_player_bhid,
                                    });
                                }
                            }
                            GameEvent::OffsetsBroken(_) => {
                                // Not yet wired to React; logged for now.
                                log::warn!("Memory offsets appear broken");
                            }
                        }
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
