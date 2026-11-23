//! Start with Windows: what to do with the registration at start, and the setting's command.

use tauri::plugin::TauriPlugin;
use tauri::State;
use tauri::{AppHandle, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::settings::{Settings, SettingsStore};

/// the launch argument the registration carries, so a start at login can be told from a click
pub const AUTOSTART_ARGUMENT: &str = "--autostarted";

#[derive(Debug, PartialEq, Eq)]
pub enum StartupAction {
    Register,
    Unregister,
    /// the player changed it in windows (task manager, startup apps); the setting follows
    AdoptSystemState,
    Keep,
}

/// what to do at start: the first start registers the default, later starts treat the system as the truth
pub fn startup_action(
    is_first_start: bool,
    wants_autostart: bool,
    is_registered: bool,
) -> StartupAction {
    if wants_autostart == is_registered {
        return StartupAction::Keep;
    }

    if !is_first_start {
        return StartupAction::AdoptSystemState;
    }

    if wants_autostart {
        return StartupAction::Register;
    }

    StartupAction::Unregister
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

/// brings the registration and the setting together at start; debug builds leave it alone, so a dev binary is
/// never registered
pub fn sync_at_start(app: &AppHandle, store: &SettingsStore) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }

    let launcher = app.autolaunch();
    // false too when the player turned it off in task manager, which leaves the registration but disables it
    let is_registered = launcher
        .is_enabled()
        .map_err(|error| format!("read autostart: {error}"))?;
    let wants_autostart = store.get().starts_with_windows;

    match startup_action(store.was_created_now(), wants_autostart, is_registered) {
        StartupAction::Register => set_registration(app, true),
        StartupAction::Unregister => set_registration(app, false),
        StartupAction::AdoptSystemState => adopt_system_state(store, is_registered),
        StartupAction::Keep => Ok(()),
    }
}

/// registers or unregisters, whatever the system has now; debug builds leave it alone
fn set_registration(app: &AppHandle, is_enabled: bool) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }

    let launcher = app.autolaunch();

    if is_enabled {
        return launcher
            .enable()
            .map_err(|error| format!("register autostart: {error}"));
    }

    launcher
        .disable()
        .map_err(|error| format!("unregister autostart: {error}"))
}

fn adopt_system_state(store: &SettingsStore, is_registered: bool) -> Result<(), String> {
    log::info!(
        "start with Windows was changed outside the app, the setting is now {is_registered}"
    );

    store.update(|settings| settings.starts_with_windows = is_registered)?;

    Ok(())
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
    let changed = change_setting(&store, is_enabled, |wants_autostart| {
        set_registration(&app, wants_autostart)
    });

    // the page's console reaches no log in release builds, so a refusal is logged here
    changed.inspect_err(|error| log::warn!("set start with Windows to {is_enabled}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn the_first_start_makes_the_system_match_the_setting() {
        assert_eq!(startup_action(true, true, false), StartupAction::Register);
        assert_eq!(startup_action(true, false, true), StartupAction::Unregister);
        assert_eq!(startup_action(true, true, true), StartupAction::Keep);
        assert_eq!(startup_action(true, false, false), StartupAction::Keep);
    }

    #[test]
    fn a_later_start_takes_what_the_player_set_in_windows() {
        assert_eq!(
            startup_action(false, true, false),
            StartupAction::AdoptSystemState
        );
        assert_eq!(
            startup_action(false, false, true),
            StartupAction::AdoptSystemState
        );
        assert_eq!(startup_action(false, true, true), StartupAction::Keep);
        assert_eq!(startup_action(false, false, false), StartupAction::Keep);
    }

    #[test]
    fn turning_it_off_in_windows_after_a_first_start_without_changes_is_adopted() {
        let directory = tempfile::tempdir().unwrap();
        let first = SettingsStore::open(directory.path());
        let first_action = startup_action(
            first.was_created_now(),
            first.get().starts_with_windows,
            false,
        );

        let second = SettingsStore::open(directory.path());
        let second_action = startup_action(
            second.was_created_now(),
            second.get().starts_with_windows,
            false,
        );

        assert_eq!(first_action, StartupAction::Register);
        assert_eq!(second_action, StartupAction::AdoptSystemState);
    }

    #[test]
    fn adopting_the_system_state_saves_it() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(directory.path());

        adopt_system_state(&store, false).unwrap();

        assert!(!store.get().starts_with_windows);
        assert!(
            !SettingsStore::open(directory.path())
                .get()
                .starts_with_windows
        );
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
