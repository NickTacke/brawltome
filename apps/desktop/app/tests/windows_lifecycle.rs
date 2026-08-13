use brawltome_desktop::overlay::{cursor_effect, PhysicalPoint, PhysicalRect};
use brawltome_desktop::tray::{tray_effect, TrayEffect};

#[test]
fn cursor_enters_only_visible_nonempty_half_open_content_bounds() {
    let bounds = PhysicalRect {
        x: 100,
        y: 200,
        width: 300,
        height: 150,
    };

    assert!(cursor_effect(
        true,
        true,
        bounds,
        PhysicalPoint { x: 100, y: 200 }
    ));
    assert!(cursor_effect(
        true,
        true,
        bounds,
        PhysicalPoint { x: 399, y: 349 }
    ));
    assert!(!cursor_effect(
        true,
        true,
        bounds,
        PhysicalPoint { x: 400, y: 349 }
    ));
    assert!(!cursor_effect(
        true,
        true,
        bounds,
        PhysicalPoint { x: 399, y: 350 }
    ));
    assert!(!cursor_effect(
        false,
        true,
        bounds,
        PhysicalPoint { x: 150, y: 250 }
    ));
    assert!(!cursor_effect(
        true,
        false,
        bounds,
        PhysicalPoint { x: 150, y: 250 }
    ));
    assert!(!cursor_effect(
        true,
        true,
        PhysicalRect { width: 0, ..bounds },
        PhysicalPoint { x: 100, y: 200 },
    ));
}

#[test]
fn tray_menu_maps_to_reversible_lifecycle_effects() {
    assert_eq!(tray_effect("toggle", true), TrayEffect::HideOverlay);
    assert_eq!(tray_effect("toggle", false), TrayEffect::ShowOverlay);
    assert_eq!(tray_effect("open_logs", true), TrayEffect::OpenLogs);
    assert_eq!(tray_effect("quit", true), TrayEffect::Quit);
    assert_eq!(tray_effect("unknown", true), TrayEffect::None);
}
