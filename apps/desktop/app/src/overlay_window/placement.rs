//! Pure geometry for the overlay: which monitor it is on and where the cards go.

use serde::{Deserialize, Serialize};

/// the height the edge margin is defined at
pub const REFERENCE_HEIGHT_PX: u32 = 1080;
/// distance from the monitor edge at the reference height
pub const EDGE_MARGIN_PX: u32 = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OverlayPosition {
    TopLeft,
    TopCenter,
    TopRight,
    MiddleLeft,
    Center,
    /// the owner's pick: the right edge is clear on the loading screen
    #[default]
    MiddleRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

enum Anchor {
    Start,
    Middle,
    End,
}

/// which side of the card the rank banner hangs on
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BannerSide {
    Left,
    Right,
}

impl OverlayPosition {
    /// the banner faces the nearest screen edge, so cards in the right column carry it on their right
    pub fn banner_side(self) -> BannerSide {
        match self.anchors() {
            (Anchor::End, _) => BannerSide::Right,
            _ => BannerSide::Left,
        }
    }

    fn anchors(self) -> (Anchor, Anchor) {
        match self {
            Self::TopLeft => (Anchor::Start, Anchor::Start),
            Self::TopCenter => (Anchor::Middle, Anchor::Start),
            Self::TopRight => (Anchor::End, Anchor::Start),
            Self::MiddleLeft => (Anchor::Start, Anchor::Middle),
            Self::Center => (Anchor::Middle, Anchor::Middle),
            Self::MiddleRight => (Anchor::End, Anchor::Middle),
            Self::BottomLeft => (Anchor::Start, Anchor::End),
            Self::BottomCenter => (Anchor::Middle, Anchor::End),
            Self::BottomRight => (Anchor::End, Anchor::End),
        }
    }
}

/// the monitor holding the point; the first one when there is no point or no monitor holds it; None without monitors
pub fn monitor_for(point: Option<(i32, i32)>, monitors: &[Rect]) -> Option<Rect> {
    let first = monitors.first().copied()?;
    let Some((x, y)) = point else {
        return Some(first);
    };

    let holding_point = monitors.iter().find(|monitor| contains(monitor, x, y));

    Some(holding_point.copied().unwrap_or(first))
}

/// the monitors with the primary one first, so monitor_for falls back to it
pub fn primary_first(mut monitors: Vec<Rect>, primary: Option<Rect>) -> Vec<Rect> {
    let Some(primary) = primary else {
        return monitors;
    };

    monitors.retain(|monitor| *monitor != primary);
    monitors.insert(0, primary);

    monitors
}

/// where the cards go, in physical pixels; None for an empty content size
pub fn overlay_rect(
    monitor: Rect,
    content_width_px: u32,
    content_height_px: u32,
    position: OverlayPosition,
) -> Option<Rect> {
    if content_width_px == 0 || content_height_px == 0 {
        return None;
    }

    // content bigger than the monitor is cut to it, so it never leaves the screen
    let width = content_width_px.min(monitor.width);
    let height = content_height_px.min(monitor.height);
    let margin_x = edge_margin_px(monitor.height).min(monitor.width - width);
    let margin_y = edge_margin_px(monitor.height).min(monitor.height - height);
    let (horizontal, vertical) = position.anchors();

    Some(Rect {
        x: monitor.x + offset(horizontal, monitor.width, width, margin_x),
        y: monitor.y + offset(vertical, monitor.height, height, margin_y),
        width,
        height,
    })
}

/// css size reported by the page -> physical pixels, rounded up
pub fn physical_size(
    width_css_px: f64,
    height_css_px: f64,
    device_pixel_ratio: f64,
) -> Option<(u32, u32)> {
    if !device_pixel_ratio.is_finite() || device_pixel_ratio <= 0.0 {
        return None;
    }

    let width = to_physical_px(width_css_px, device_pixel_ratio)?;
    let height = to_physical_px(height_css_px, device_pixel_ratio)?;

    Some((width, height))
}

/// a size measured on a monitor of one height, as big relative to a monitor of another height, rounded up
pub fn rescaled_size(size_px: (u32, u32), from_height_px: u32, to_height_px: u32) -> (u32, u32) {
    if from_height_px == 0 {
        return size_px;
    }

    let rescale = |length_px: u32| {
        let scaled =
            (u64::from(length_px) * u64::from(to_height_px)).div_ceil(u64::from(from_height_px));
        u32::try_from(scaled).unwrap_or(u32::MAX)
    };

    (rescale(size_px.0), rescale(size_px.1))
}

fn to_physical_px(css_px: f64, device_pixel_ratio: f64) -> Option<u32> {
    if !css_px.is_finite() || css_px < 0.0 {
        return None;
    }

    let physical_px = (css_px * device_pixel_ratio).ceil();
    if physical_px > f64::from(u32::MAX) {
        return None;
    }

    Some(physical_px as u32)
}

fn contains(monitor: &Rect, x: i32, y: i32) -> bool {
    let (x, y) = (i64::from(x), i64::from(y));
    let left = i64::from(monitor.x);
    let top = i64::from(monitor.y);

    x >= left
        && x < left + i64::from(monitor.width)
        && y >= top
        && y < top + i64::from(monitor.height)
}

/// the margin scales with the monitor height, rounded to the nearest pixel
fn edge_margin_px(monitor_height_px: u32) -> u32 {
    let scaled = u64::from(EDGE_MARGIN_PX) * u64::from(monitor_height_px);
    let reference = u64::from(REFERENCE_HEIGHT_PX);

    ((scaled + reference / 2) / reference) as u32
}

/// distance from the monitor's start edge on one axis; the caller keeps size and margin inside the monitor
fn offset(anchor: Anchor, monitor_px: u32, content_px: u32, margin_px: u32) -> i32 {
    let free_px = monitor_px - content_px;

    let offset_px = match anchor {
        Anchor::Start => margin_px,
        Anchor::Middle => free_px / 2,
        Anchor::End => free_px - margin_px,
    };

    // monitor sizes come from i32 coordinates, so the offset fits
    i32::try_from(offset_px).unwrap_or(i32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn top_centre_on_a_1080p_monitor() {
        let placed = overlay_rect(rect(0, 0, 1920, 1080), 340, 131, OverlayPosition::TopCenter);

        assert_eq!(placed, Some(rect(790, 24, 340, 131)));
    }

    #[test]
    fn the_margin_grows_with_the_monitor() {
        let placed = overlay_rect(rect(0, 0, 2560, 1440), 454, 175, OverlayPosition::TopCenter);

        assert_eq!(placed, Some(rect(1053, 32, 454, 175)));
    }

    #[test]
    fn every_position_keeps_the_margin() {
        let monitor = rect(0, 0, 1920, 1080);

        let bottom_right = overlay_rect(monitor, 340, 131, OverlayPosition::BottomRight).unwrap();
        let centre = overlay_rect(monitor, 340, 131, OverlayPosition::Center).unwrap();
        let middle_left = overlay_rect(monitor, 340, 131, OverlayPosition::MiddleLeft).unwrap();
        let bottom_center = overlay_rect(monitor, 340, 131, OverlayPosition::BottomCenter).unwrap();

        assert_eq!((bottom_right.x, bottom_right.y), (1556, 925));
        assert_eq!((centre.x, centre.y), (790, 474));
        assert_eq!((middle_left.x, middle_left.y), (24, 474));
        assert_eq!((bottom_center.x, bottom_center.y), (790, 925));
    }

    #[test]
    fn a_monitor_left_of_the_primary() {
        let monitor = rect(-2560, 0, 2560, 1440);

        let placed = overlay_rect(monitor, 454, 175, OverlayPosition::TopLeft).unwrap();

        assert_eq!((placed.x, placed.y), (-2528, 32));
    }

    #[test]
    fn content_bigger_than_the_monitor_stays_on_it() {
        let monitor = rect(100, 50, 1920, 1080);

        let placed = overlay_rect(monitor, 3000, 131, OverlayPosition::TopCenter).unwrap();

        assert_eq!((placed.x, placed.width), (monitor.x, 1920));
    }

    #[test]
    fn empty_content_has_no_rect() {
        let monitor = rect(0, 0, 1920, 1080);

        assert_eq!(overlay_rect(monitor, 0, 131, OverlayPosition::Center), None);
        assert_eq!(overlay_rect(monitor, 340, 0, OverlayPosition::Center), None);
    }

    #[test]
    fn picks_the_monitor_the_game_is_on() {
        let first = rect(0, 0, 1920, 1080);
        let second = rect(1920, 0, 2560, 1440);
        let monitors = [first, second];

        assert_eq!(monitor_for(Some((3000, 500)), &monitors), Some(second));
        assert_eq!(monitor_for(None, &monitors), Some(first));
        assert_eq!(monitor_for(Some((-50, -50)), &monitors), Some(first));
        assert_eq!(monitor_for(Some((10, 10)), &[]), None);
    }

    #[test]
    fn a_minimized_game_puts_the_cards_on_the_primary_monitor() {
        let left = rect(-2560, 0, 2560, 1440);
        let primary = rect(0, 0, 1920, 1080);
        let monitors = primary_first(vec![left, primary], Some(primary));

        // windows parks a minimized window at -32000,-32000
        let minimized_centre = Some((-32_000 + 80, -32_000 + 14));

        assert_eq!(monitors, vec![primary, left]);
        assert_eq!(monitor_for(minimized_centre, &monitors), Some(primary));
        assert_eq!(
            primary_first(vec![left, primary], None),
            vec![left, primary]
        );
    }

    #[test]
    fn css_pixels_become_physical_pixels() {
        assert_eq!(physical_size(340.0, 130.5, 1.25), Some((425, 164)));
        assert_eq!(physical_size(340.0, 130.0, f64::NAN), None);
        assert_eq!(physical_size(340.0, 130.0, 0.0), None);
        assert_eq!(physical_size(340.0, 130.0, -1.0), None);
        assert_eq!(physical_size(f64::NAN, 130.0, 1.0), None);
    }

    #[test]
    fn a_size_measured_on_one_monitor_fits_another() {
        assert_eq!(rescaled_size((340, 131), 1080, 1080), (340, 131));
        assert_eq!(rescaled_size((340, 155), 1080, 1440), (454, 207));
        assert_eq!(rescaled_size((454, 175), 1440, 1080), (341, 132));
        assert_eq!(rescaled_size((340, 131), 0, 1080), (340, 131));
    }

    #[test]
    fn the_position_setting_uses_camel_case_names() {
        let parsed: OverlayPosition = serde_json::from_str("\"bottomCenter\"").unwrap();

        assert_eq!(parsed, OverlayPosition::BottomCenter);
        assert_eq!(OverlayPosition::default(), OverlayPosition::MiddleRight);
    }

    #[test]
    fn the_banner_hangs_on_the_side_of_the_nearest_edge() {
        assert_eq!(OverlayPosition::TopRight.banner_side(), BannerSide::Right);
        assert_eq!(
            OverlayPosition::MiddleRight.banner_side(),
            BannerSide::Right
        );
        assert_eq!(
            OverlayPosition::BottomRight.banner_side(),
            BannerSide::Right
        );
        assert_eq!(OverlayPosition::TopCenter.banner_side(), BannerSide::Left);
        assert_eq!(OverlayPosition::BottomLeft.banner_side(), BannerSide::Left);
        assert_eq!(
            serde_json::to_string(&BannerSide::Right).unwrap(),
            "\"right\""
        );
    }
}
