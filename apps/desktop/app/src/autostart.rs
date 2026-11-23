//! Start with Windows: what to register at start, and the setting's command.

use tauri::plugin::TauriPlugin;
use tauri::State;
use tauri::{AppHandle, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::settings::{Settings, SettingsStore};

/// the launch argument the registration carries, so a start at login can be told from a click
pub const AUTOSTART_ARGUMENT: &str = "--autostarted";

#[derive(Debug, PartialEq, Eq)]
pub enum AutostartChange {
    Enable,
    Disable,
    Keep,
}

/// what to do at start so the system matches the setting
pub fn autostart_change(wants_autostart: bool, is_registered: bool) -> AutostartChange {
    match (wants_autostart, is_registered) {
        (true, false) => AutostartChange::Enable,
        (false, true) => AutostartChange::Disable,
        _ => AutostartChange::Keep,
    }
}

pub fn was_autostarted(arguments: &[String]) -> bool {
    arguments
        .iter()
        .any(|argument| argument == AUTOSTART_ARGUMENT)
}

/// registers the app to start at login, with the argument that marks such a start
pub fn plugin() -> TauriPlugin<Wry> {
    tauri_plugin_autostart::Builder::new()
        .arg(AUTOSTART_ARGUMENT)
        .build()
}

/// makes the system's registration match the setting; debug builds leave it alone, so a dev binary is never registered
pub fn apply(app: &AppHandle, wants_autostart: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }

    let launcher = app.autolaunch();
    let is_registered = launcher
        .is_enabled()
        .map_err(|error| format!("register autostart: {error}"))?;

    let result = match autostart_change(wants_autostart, is_registered) {
        AutostartChange::Enable => launcher.enable(),
        AutostartChange::Disable => launcher.disable(),
        AutostartChange::Keep => Ok(()),
    };

    result.map_err(|error| format!("register autostart: {error}"))
}

/// saves the setting, then applies it; a refusal puts the setting back
fn change_setting(
    store: &SettingsStore,
    is_enabled: bool,
    apply: impl FnOnce(bool) -> Result<(), String>,
) -> Result<Settings, String> {
    let previous = store.get().starts_with_windows;
    let settings = store.update(|settings| settings.starts_with_windows = is_enabled)?;

    let Err(error) = apply(is_enabled) else {
        return Ok(settings);
    };

    if let Err(restore_error) = store.update(|settings| settings.starts_with_windows = previous) {
        log::warn!("put the start with Windows setting back: {restore_error}");
    }

    Err(error)
}

#[tauri::command]
pub fn set_starts_with_windows(
    is_enabled: bool,
    app: AppHandle,
    store: State<'_, SettingsStore>,
) -> Result<Settings, String> {
    change_setting(&store, is_enabled, |wants_autostart| {
        apply(&app, wants_autostart)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn registers_when_wanted_and_missing() {
        assert_eq!(autostart_change(true, false), AutostartChange::Enable);
        assert_eq!(autostart_change(false, true), AutostartChange::Disable);
        assert_eq!(autostart_change(true, true), AutostartChange::Keep);
        assert_eq!(autostart_change(false, false), AutostartChange::Keep);
    }

    #[test]
    fn knows_an_autostart_from_a_click() {
        assert!(was_autostarted(&arguments(&[
            "app.exe",
            AUTOSTART_ARGUMENT
        ])));
        assert!(!was_autostarted(&arguments(&["app.exe"])));
    }

    #[test]
    fn a_change_that_applies_is_saved() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(directory.path());
        let mut applied = Vec::new();

        let settings = change_setting(&store, false, |is_enabled| {
            applied.push(is_enabled);
            Ok(())
        })
        .unwrap();

        assert!(!settings.starts_with_windows);
        assert_eq!(applied, vec![false]);
        assert!(
            !SettingsStore::open(directory.path())
                .get()
                .starts_with_windows
        );
    }

    #[test]
    fn a_refused_change_puts_the_setting_back_and_says_why() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(directory.path());
        store
            .update(|settings| settings.starts_with_windows = true)
            .unwrap();

        let result = change_setting(&store, false, |_| {
            Err("register autostart: access denied".to_string())
        });

        assert_eq!(result.unwrap_err(), "register autostart: access denied");
        assert!(store.get().starts_with_windows);
        assert!(
            SettingsStore::open(directory.path())
                .get()
                .starts_with_windows
        );
    }
}
