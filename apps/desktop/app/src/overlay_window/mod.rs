//! Show, size and place the overlay window without taking focus from the game.

// the controller that calls these lands in a later change
#[allow(dead_code)]
mod placement;
#[allow(dead_code)]
#[cfg(windows)]
mod win32;

pub use placement::{OverlayPosition, Rect};
