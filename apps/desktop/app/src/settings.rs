//! The settings file: two fields in `settings.json` inside the app's config folder.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::overlay_window::{OverlayPosition, OverlayWindow};

const FILE_NAME: &str = "settings.json";
const TEMP_FILE_NAME: &str = "settings.json.tmp";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub overlay_position: OverlayPosition,
    pub starts_with_windows: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            overlay_position: OverlayPosition::default(),
            starts_with_windows: true,
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    settings: Mutex<Settings>,
    was_created_now: bool,
}

impl SettingsStore {
    /// reads `<directory>/settings.json`; whatever it can't read becomes the default. never fails
    pub fn open(directory: &Path) -> Self {
        let path = directory.join(FILE_NAME);
        let (settings, was_created_now) = read_settings(&path);

        Self {
            path,
            settings: Mutex::new(settings),
            was_created_now,
        }
    }

    /// no file existed: the first start
    pub fn was_created_now(&self) -> bool {
        self.was_created_now
    }

    pub fn get(&self) -> Settings {
        self.lock().clone()
    }

    /// changes, then writes a temp file and renames it over the old one
    pub fn update(&self, change: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
        // the lock is held through the write, so two updates can't write in the wrong order
        let mut current = self.lock();
        let mut changed = current.clone();

        change(&mut changed);
        write_settings(&self.path, &changed)?;
        *current = changed.clone();

        Ok(changed)
    }

    fn lock(&self) -> MutexGuard<'_, Settings> {
        // a holder that panicked can't leave the settings half written: they are replaced whole
        self.settings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// the settings in the file, and whether there was no file at all
fn read_settings(path: &Path) -> (Settings, bool) {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return (Settings::default(), true),
        Err(error) => {
            log::warn!("read settings from {}: {error}", path.display());
            return (Settings::default(), false);
        }
    };

    (parse_settings(&text), false)
}

/// each field is taken on its own, so one bad field doesn't cost the others
fn parse_settings(text: &str) -> Settings {
    let defaults = Settings::default();
    let Ok(file) = serde_json::from_str::<Value>(text) else {
        return defaults;
    };

    Settings {
        overlay_position: read_field(&file, "overlayPosition", defaults.overlay_position),
        starts_with_windows: read_field(&file, "startsWithWindows", defaults.starts_with_windows),
    }
}

fn read_field<T: DeserializeOwned>(file: &Value, name: &str, fallback: T) -> T {
    let Some(value) = file.get(name) else {
        return fallback;
    };

    serde_json::from_value(value.clone()).unwrap_or(fallback)
}

/// a temp file renamed over the old one, so a crash can't leave half a file
fn write_settings(path: &Path, settings: &Settings) -> Result<(), String> {
    let describe =
        |error: &dyn std::fmt::Display| format!("save settings to {}: {error}", path.display());
    let text = serde_json::to_string_pretty(settings).map_err(|error| describe(&error))?;
    let temp_path = path.with_file_name(TEMP_FILE_NAME);

    std::fs::write(&temp_path, text).map_err(|error| describe(&error))?;
    std::fs::rename(&temp_path, path).map_err(|error| describe(&error))?;

    Ok(())
}

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

#[tauri::command]
pub fn set_overlay_position(
    position: OverlayPosition,
    store: State<'_, SettingsStore>,
    overlay: State<'_, Arc<OverlayWindow>>,
) -> Result<Settings, String> {
    let settings = store.update(|settings| settings.overlay_position = position)?;
    overlay.set_position(position);

    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_settings_file(directory: &Path, text: &str) {
        std::fs::write(directory.join(FILE_NAME), text).unwrap();
    }

    fn assert_defaults(settings: &Settings) {
        assert_eq!(settings.overlay_position, OverlayPosition::MiddleRight);
        assert!(settings.starts_with_windows);
    }

    #[test]
    fn a_first_start_has_the_defaults_and_knows_it_is_the_first() {
        let directory = tempfile::tempdir().unwrap();

        let store = SettingsStore::open(directory.path());

        assert_defaults(&store.get());
        assert!(store.was_created_now());
    }

    #[test]
    fn a_change_is_there_after_reopening() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(directory.path());

        store
            .update(|settings| settings.overlay_position = OverlayPosition::BottomRight)
            .unwrap();
        let reopened = SettingsStore::open(directory.path());

        assert_eq!(
            reopened.get().overlay_position,
            OverlayPosition::BottomRight
        );
        assert!(!reopened.was_created_now());
    }

    #[test]
    fn a_cut_off_file_falls_back_to_defaults() {
        let directory = tempfile::tempdir().unwrap();
        write_settings_file(directory.path(), "{\"overlayPosi");

        let store = SettingsStore::open(directory.path());
        assert_defaults(&store.get());
        store
            .update(|settings| settings.starts_with_windows = false)
            .unwrap();
        let reopened = SettingsStore::open(directory.path());

        assert!(!store.was_created_now());
        assert!(!reopened.get().starts_with_windows);
        assert_eq!(
            reopened.get().overlay_position,
            OverlayPosition::MiddleRight
        );
    }

    #[test]
    fn an_empty_file_falls_back_to_defaults() {
        let directory = tempfile::tempdir().unwrap();
        write_settings_file(directory.path(), "");

        let store = SettingsStore::open(directory.path());

        assert_defaults(&store.get());
    }

    #[test]
    fn a_field_from_a_newer_version_is_ignored_and_the_rest_kept() {
        let directory = tempfile::tempdir().unwrap();
        write_settings_file(
            directory.path(),
            r#"{"overlayPosition":"center","replayFolder":"C:\\x"}"#,
        );

        let settings = SettingsStore::open(directory.path()).get();

        assert_eq!(settings.overlay_position, OverlayPosition::Center);
        assert!(settings.starts_with_windows);
    }

    #[test]
    fn a_position_this_version_does_not_know_becomes_the_default_and_keeps_the_rest() {
        let directory = tempfile::tempdir().unwrap();
        write_settings_file(
            directory.path(),
            r#"{"overlayPosition":"underTheHud","startsWithWindows":false}"#,
        );

        let settings = SettingsStore::open(directory.path()).get();

        assert_eq!(settings.overlay_position, OverlayPosition::MiddleRight);
        assert!(!settings.starts_with_windows);
    }

    #[test]
    fn a_failed_write_says_where() {
        let directory = tempfile::tempdir().unwrap();
        let folder = directory.path().join("config");
        std::fs::create_dir(&folder).unwrap();
        let store = SettingsStore::open(&folder);
        std::fs::remove_dir(&folder).unwrap();

        let result = store.update(|settings| settings.starts_with_windows = false);

        let message = result.unwrap_err();
        assert!(message.contains("save settings to"), "{message}");
        assert!(store.get().starts_with_windows);
    }
}
