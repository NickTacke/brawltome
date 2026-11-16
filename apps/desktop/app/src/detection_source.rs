//! starts detection on windows and hands its events to the async side of the app

use std::path::PathBuf;

use brawltome_detection::Event;
use tokio::sync::mpsc;

/// a read a second while a match runs, until the replay watcher can say when it ends
pub const IN_MATCH_POLL_MS: u64 = 1_000;

// detection sends a handful of events per match, so a small buffer never fills
const EVENT_BUFFER: usize = 32;

/// windows: starts detection with the map cache in `cache_directory` and forwards its events; elsewhere the
/// receiver never yields. detection stops when the receiver is dropped
#[cfg(windows)]
pub fn start(cache_directory: PathBuf) -> mpsc::Receiver<Event> {
    let (sender, receiver) = mpsc::channel(EVENT_BUFFER);
    let config = brawltome_detection::Config {
        in_match_poll_ms: Some(IN_MATCH_POLL_MS),
        cache_directory,
        ..brawltome_detection::Config::default()
    };

    let forwarder = std::thread::Builder::new()
        .name("brawltome-detection-events".to_string())
        .spawn(move || forward(config, sender));
    if let Err(error) = forwarder {
        log::error!("start the detection event thread: {error}");
    }

    receiver
}

/// runs until detection ends or the app stops listening, then stops detection
#[cfg(windows)]
fn forward(config: brawltome_detection::Config, sender: mpsc::Sender<Event>) {
    let (detection_sender, detection_events) = std::sync::mpsc::channel();
    let detection = brawltome_detection::start(config, detection_sender);

    for event in detection_events {
        log::info!("detection: {event:?}");

        // the app stops listening only when it shuts down; detection notices at its next event
        if sender.blocking_send(event).is_err() {
            break;
        }
    }

    detection.stop();
}

/// windows: starts detection with the map cache in `cache_directory` and forwards its events; elsewhere the
/// receiver never yields. detection stops when the receiver is dropped
#[cfg(not(windows))]
pub fn start(cache_directory: PathBuf) -> mpsc::Receiver<Event> {
    let (sender, receiver) = mpsc::channel(EVENT_BUFFER);
    log::info!(
        "detection runs on windows only; map cache would be in {}",
        cache_directory.display()
    );

    // holding the sender keeps the receiver open, so the session waits instead of stopping
    tokio::spawn(async move { sender.closed().await });

    receiver
}
