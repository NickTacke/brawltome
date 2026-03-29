#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use tauri::Manager;
use tokio::time::{sleep, Duration};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Opponent {
    brawlhalla_id: u64,
    name: String,
    rating: u32,
    peak_rating: u32,
    playtime: f64,
    tier: String,
    region: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event")]
enum GameEvent {
    #[serde(rename = "match_found", rename_all = "camelCase")]
    MatchFound {
        opponents: Vec<Opponent>,
        is_ranked: bool,
        local_player_id: u64,
    },
    #[serde(rename = "match_ended")]
    MatchEnded,
}

fn mock_opponents() -> Vec<Opponent> {
    vec![Opponent {
        brawlhalla_id: 2836298,
        name: "Sandstorm".into(),
        rating: 2487,
        peak_rating: 2512,
        playtime: 4231.5,
        tier: "Diamond".into(),
        region: "US-E".into(),
    }]
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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

            window.set_ignore_cursor_events(true)?;

            // Spawn mock event loop
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    sleep(Duration::from_secs(5)).await;
                    let _ = handle.emit(
                        "game-event",
                        GameEvent::MatchFound {
                            opponents: mock_opponents(),
                            is_ranked: true,
                            local_player_id: 12345,
                        },
                    );

                    sleep(Duration::from_secs(15)).await;
                    let _ = handle.emit("game-event", GameEvent::MatchEnded);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
