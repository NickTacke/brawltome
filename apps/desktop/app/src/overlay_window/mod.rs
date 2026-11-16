//! Show, size and place the overlay window without taking focus from the game.

#[cfg(not(windows))]
mod dev_platform;
mod placement;
#[cfg(windows)]
mod win32;

// on windows, never call tauri's window setters on the overlay (show, hide, set_always_on_top, set_focusable, …):
// tao still thinks the window is hidden, so its apply_diff would hide it and rewrite its extended style. every
// window call goes through `platform`
#[cfg(not(windows))]
use dev_platform as platform;
#[cfg(windows)]
use win32 as platform;

use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, State, WindowEvent};

use crate::overlay_view::{Card, OverlayView};
use crate::session::Input;
use crate::session_runner::{OverlaySurface, SessionHandle};
use placement::{
    monitor_for, overlay_rect, physical_size, primary_first, rescaled_size, REFERENCE_HEIGHT_PX,
};

pub use placement::{BannerSide, OverlayPosition, Rect};

const OVERLAY_LABEL: &str = "overlay";
const VIEW_EVENT: &str = "overlay://view";
const CLEAR_EVENT: &str = "overlay://clear";

/// the cards' size at the reference height until the page has measured them
/// (a diamond banner hangs below both kinds of card, so it sets their height)
const FIRST_SOLO_SIZE_PX: (u32, u32) = (392, 179);
const FIRST_TEAM_SIZE_PX: (u32, u32) = (392, 179);

/// what the overlay page draws, how tall the monitor it draws on is, and which side the banners hang on
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverlayEnvelope {
    pub view: OverlayView,
    pub monitor_height_px: u32,
    pub banner_side: BannerSide,
}

pub struct OverlayWindow {
    app: AppHandle,
    state: Arc<Mutex<OverlayState>>,
}

#[derive(Default)]
struct OverlayState {
    game_process_id: Option<u32>,
    position: OverlayPosition,
    /// none while the window is hidden
    shown: Option<ShownCards>,
    measured_solo: Option<MeasuredSize>,
    measured_team: Option<MeasuredSize>,
}

struct ShownCards {
    envelope: OverlayEnvelope,
    monitor: Rect,
    kind: CardKind,
    /// where the window is meant to be; a placement for any other rect is stale
    rect: Option<Rect>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CardKind {
    Solo,
    Team,
}

/// the physical size the page reported, and the height of the monitor it was on
#[derive(Clone, Copy)]
struct MeasuredSize {
    size_px: (u32, u32),
    monitor_height_px: u32,
}

impl OverlayWindow {
    pub fn new(app: &AppHandle) -> Arc<Self> {
        let overlay = Arc::new(Self {
            app: app.clone(),
            state: Arc::new(Mutex::new(OverlayState::default())),
        });

        let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
            log::error!("set up the overlay window: there is no window labelled {OVERLAY_LABEL}");
            return overlay;
        };
        platform::make_never_activate(&window);
        let for_events = Arc::clone(&overlay);
        window.on_window_event(move |event| {
            if let WindowEvent::ScaleFactorChanged { .. } = event {
                for_events.place_again_later();
            }
        });

        overlay
    }

    pub fn set_game_process(&self, process_id: Option<u32>) {
        self.state().game_process_id = process_id;
    }

    /// used from the next lobby on
    pub fn set_position(&self, position: OverlayPosition) {
        self.state().position = position;
    }

    pub fn current_envelope(&self) -> Option<OverlayEnvelope> {
        let state = self.state();

        state.shown.as_ref().map(|shown| shown.envelope.clone())
    }

    /// cuts the window to the size the page measured for the lobby it shows
    pub fn content_resized(
        &self,
        lobby_id: u64,
        width_css_px: f64,
        height_css_px: f64,
        device_pixel_ratio: f64,
    ) {
        let Some(size_px) = physical_size(width_css_px, height_css_px, device_pixel_ratio) else {
            log::warn!(
                "size the overlay for lobby {lobby_id}: unusable size {width_css_px}x{height_css_px} at ratio {device_pixel_ratio}"
            );
            return;
        };

        let rect = self.state().resize_shown(lobby_id, size_px);

        if let Some(rect) = rect {
            self.place_later(rect);
        }
    }

    /// a newer view of the lobby on screen stays where it is
    fn update_shown_lobby(&self, view: &OverlayView) -> Option<OverlayEnvelope> {
        let mut state = self.state();
        let shown = state
            .shown
            .as_mut()
            .filter(|shown| shown.envelope.view.lobby_id == view.lobby_id)?;

        shown.envelope.view = view.clone();

        Some(shown.envelope.clone())
    }

    /// a new lobby goes to the game's monitor at once, at the size its kind had last time
    fn show_new_lobby(&self, view: &OverlayView) -> Option<OverlayEnvelope> {
        let game_process_id = self.state().game_process_id;
        let monitor = self.game_monitor(game_process_id)?;
        let kind = CardKind::of(view);
        let envelope = OverlayEnvelope {
            view: view.clone(),
            monitor_height_px: monitor.height,
            banner_side: self.state().position.banner_side(),
        };

        let rect = {
            let mut state = self.state();
            let (width_px, height_px) = state.first_frame_size(kind, monitor.height);
            let rect = overlay_rect(monitor, width_px, height_px, state.position);
            state.shown = Some(ShownCards {
                envelope: envelope.clone(),
                monitor,
                kind,
                rect,
            });
            rect
        };

        // the page may not lay out while the window is hidden, so the window can't wait for its size
        if let Some(rect) = rect {
            self.place_later(rect);
        }

        Some(envelope)
    }

    /// the monitor showing the game; the primary one when the game has no window on any monitor
    fn game_monitor(&self, game_process_id: Option<u32>) -> Option<Rect> {
        let game_centre = game_process_id.and_then(platform::game_window_center);
        let monitors = self.monitors_primary_first();

        monitor_for(game_centre, &monitors)
    }

    /// a minimized game sits at -32000,-32000, off every monitor
    fn monitors_primary_first(&self) -> Vec<Rect> {
        let primary = self.app.primary_monitor().ok().flatten();
        let monitors = match self.app.available_monitors() {
            Ok(monitors) => monitors.iter().map(monitor_rect).collect(),
            Err(error) => {
                log::warn!("list the monitors for the overlay: {error}");
                Vec::new()
            }
        };

        primary_first(monitors, primary.as_ref().map(monitor_rect))
    }

    /// tao resizes the window for a new scale factor after a move, so the cards are put back
    fn place_again_later(&self) {
        let rect = self.state().shown.as_ref().and_then(|shown| shown.rect);

        if let Some(rect) = rect {
            self.place_later(rect);
        }
    }

    /// places on the main thread after the window message being handled now, unless the cards moved on
    fn place_later(&self, rect: Rect) {
        let app = self.app.clone();
        let state = Arc::clone(&self.state);

        // a task posted from the main thread would run at once, inside the message being handled
        tauri::async_runtime::spawn(async move {
            let main_thread_app = app.clone();
            let posted = app.run_on_main_thread(move || {
                let wanted_rect = lock(&state).shown.as_ref().and_then(|shown| shown.rect);
                if wanted_rect == Some(rect) {
                    place_window(&main_thread_app, rect);
                }
            });

            if let Err(error) = posted {
                log::warn!("place the overlay window at {},{}: {error}", rect.x, rect.y);
            }
        });
    }

    /// hides on the main thread, after any placement already queued there, unless a new lobby came in
    fn hide_later(&self) {
        let app = self.app.clone();
        let state = Arc::clone(&self.state);

        let posted = self.app.run_on_main_thread(move || {
            let is_showing_again = lock(&state).shown.is_some();
            if !is_showing_again {
                hide_window(&app);
            }
        });

        if let Err(error) = posted {
            log::warn!("hide the overlay window: {error}");
        }
    }

    fn state(&self) -> MutexGuard<'_, OverlayState> {
        lock(&self.state)
    }
}

impl OverlaySurface for OverlayWindow {
    fn show(&self, view: &OverlayView) {
        let envelope = self
            .update_shown_lobby(view)
            .or_else(|| self.show_new_lobby(view));
        let Some(envelope) = envelope else {
            log::warn!(
                "show the overlay for lobby {}: no monitor found",
                view.lobby_id
            );
            return;
        };

        if let Err(error) = self.app.emit_to(OVERLAY_LABEL, VIEW_EVENT, &envelope) {
            log::warn!("send lobby {} to the overlay page: {error}", view.lobby_id);
        }
    }

    fn hide(&self) {
        self.state().shown = None;

        if let Err(error) = self.app.emit_to(OVERLAY_LABEL, CLEAR_EVENT, ()) {
            log::warn!("clear the overlay page: {error}");
        }

        self.hide_later();
    }
}

impl OverlayState {
    fn first_frame_size(&self, kind: CardKind, monitor_height_px: u32) -> (u32, u32) {
        let measured = match kind {
            CardKind::Solo => self.measured_solo,
            CardKind::Team => self.measured_team,
        };
        let measured = measured.unwrap_or(MeasuredSize {
            size_px: kind.first_size_px(),
            monitor_height_px: REFERENCE_HEIGHT_PX,
        });

        rescaled_size(
            measured.size_px,
            measured.monitor_height_px,
            monitor_height_px,
        )
    }

    /// the rect for the measured size; none when the cards on screen are of another lobby or the size is empty
    fn resize_shown(&mut self, lobby_id: u64, size_px: (u32, u32)) -> Option<Rect> {
        // an empty report would cancel the first-frame placement and spoil the next first frame
        if size_px.0 == 0 || size_px.1 == 0 {
            return None;
        }

        let position = self.position;
        let shown = self
            .shown
            .as_mut()
            .filter(|shown| shown.envelope.view.lobby_id == lobby_id)?;

        shown.rect = overlay_rect(shown.monitor, size_px.0, size_px.1, position);
        let rect = shown.rect;
        let kind = shown.kind;
        let measured = MeasuredSize {
            size_px,
            monitor_height_px: shown.monitor.height,
        };

        match kind {
            CardKind::Solo => self.measured_solo = Some(measured),
            CardKind::Team => self.measured_team = Some(measured),
        }

        rect
    }
}

impl CardKind {
    fn of(view: &OverlayView) -> Self {
        match view.cards.first() {
            Some(Card::Team { .. }) => Self::Team,
            _ => Self::Solo,
        }
    }

    fn first_size_px(self) -> (u32, u32) {
        match self {
            Self::Solo => FIRST_SOLO_SIZE_PX,
            Self::Team => FIRST_TEAM_SIZE_PX,
        }
    }
}

fn lock(state: &Mutex<OverlayState>) -> MutexGuard<'_, OverlayState> {
    // every write is a plain assignment, so a holder that panicked can't leave it half done
    state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn monitor_rect(monitor: &Monitor) -> Rect {
    let position = monitor.position();
    let size = monitor.size();

    Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    }
}

/// runs on the main thread, where a move onto a monitor of another scale is handled before it returns
fn place_window(app: &AppHandle, rect: Rect) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        log::warn!("place the overlay window: there is no window labelled {OVERLAY_LABEL}");
        return;
    };

    let scale_before = window.scale_factor().ok();
    if let Err(error) = platform::place(&window, rect) {
        log::warn!("{error}");
        return;
    }

    // crossing onto a monitor of another scale makes tao resize the window for it
    if window.scale_factor().ok() == scale_before {
        return;
    }
    if let Err(error) = platform::place(&window, rect) {
        log::warn!("{error}");
    }
}

fn hide_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
        return;
    };

    if let Err(error) = platform::hide(&window) {
        log::warn!("{error}");
    }
}

#[tauri::command]
pub fn overlay_content_resized(
    lobby_id: u64,
    width_px: f64,
    height_px: f64,
    device_pixel_ratio: f64,
    overlay: State<'_, Arc<OverlayWindow>>,
) {
    overlay.content_resized(lobby_id, width_px, height_px, device_pixel_ratio);
}

#[tauri::command]
pub fn get_overlay_view(overlay: State<'_, Arc<OverlayWindow>>) -> Option<OverlayEnvelope> {
    overlay.current_envelope()
}

#[tauri::command]
pub fn open_player_profile(brawlhalla_id: u32, session: State<'_, SessionHandle>) {
    session.send(Input::ProfileClicked { brawlhalla_id });
}

#[tauri::command]
pub fn retry_lookup(session: State<'_, SessionHandle>) {
    session.send(Input::RetryClicked);
}

#[cfg(test)]
mod tests {
    use super::*;

    const MONITOR: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

    fn showing_lobby(lobby_id: u64, rect: Rect) -> OverlayState {
        let view = OverlayView {
            lobby_id,
            cards: Vec::new(),
            visible_ms: 12_000,
        };
        let shown = ShownCards {
            envelope: OverlayEnvelope {
                view,
                monitor_height_px: MONITOR.height,
                banner_side: BannerSide::Right,
            },
            monitor: MONITOR,
            kind: CardKind::Solo,
            rect: Some(rect),
        };

        OverlayState {
            shown: Some(shown),
            ..OverlayState::default()
        }
    }

    #[test]
    fn an_empty_size_report_keeps_the_placement() {
        let first_frame = Rect {
            x: 790,
            y: 24,
            width: 340,
            height: 131,
        };
        let mut state = showing_lobby(7, first_frame);

        let zero_width = state.resize_shown(7, (0, 131));
        let zero_height = state.resize_shown(7, (340, 0));

        assert_eq!((zero_width, zero_height), (None, None));
        assert_eq!(
            state.shown.as_ref().and_then(|shown| shown.rect),
            Some(first_frame)
        );
        assert!(state.measured_solo.is_none());
    }

    #[test]
    fn a_size_report_moves_the_cards_and_is_remembered() {
        let mut state = showing_lobby(7, MONITOR);

        let rect = state.resize_shown(7, (340, 150));
        let other_lobby = state.resize_shown(8, (340, 131));

        // the middle of the right edge by default: 1920 - 24 - 340, (1080 - 150) / 2
        let expected = Rect {
            x: 1556,
            y: 465,
            width: 340,
            height: 150,
        };
        assert_eq!(rect, Some(expected));
        assert_eq!(other_lobby, None);
        assert_eq!(
            state.shown.as_ref().and_then(|shown| shown.rect),
            Some(expected)
        );
        assert_eq!(state.first_frame_size(CardKind::Solo, 1080), (340, 150));
    }
}
