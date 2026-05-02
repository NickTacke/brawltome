//! Brawlhalla game detection: memory scanning and match-state tracking.
//! Exposes a single DetectionService implementation; everything else is internal.

#[cfg(target_os = "windows")]
mod memory;

#[cfg(target_os = "windows")]
mod scanner;

#[cfg(target_os = "windows")]
mod game_detection;

#[cfg(target_os = "windows")]
pub use game_detection::WindowsDetectionService;
