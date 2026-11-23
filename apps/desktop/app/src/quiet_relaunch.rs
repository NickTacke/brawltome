//! A marker the updater leaves before the installer restarts the app, so that restart keeps the window closed.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "relaunch-quietly";

/// the installer restarts the app within a minute; an older marker is from an install that never got that far
pub const QUIET_RELAUNCH_MAX_AGE_MS: u64 = 600_000;

/// the app's cache folder; none when it can't be named, and then every start opens the window as usual
pub fn directory(app: &AppHandle) -> Option<PathBuf> {
    match app.path().app_cache_dir() {
        Ok(directory) => Some(directory),
        Err(error) => {
            log::warn!("find the cache folder for the quiet relaunch marker: {error}");
            None
        }
    }
}

/// asks the next start to keep the window closed
pub fn mark(directory: &Path) -> Result<(), String> {
    let path = directory.join(FILE_NAME);

    std::fs::create_dir_all(directory)
        .and_then(|()| std::fs::write(&path, ""))
        .map_err(|error| {
            format!(
                "write the quiet relaunch marker {}: {error}",
                path.display()
            )
        })
}

/// whether this start is the installer's restart; true at most once, as the marker is removed
pub fn take(directory: &Path, now: SystemTime) -> bool {
    let path = directory.join(FILE_NAME);
    let Ok(metadata) = std::fs::metadata(&path) else {
        return false;
    };

    clear(directory);

    let Ok(written_at) = metadata.modified() else {
        return false;
    };

    is_recent(written_at, now)
}

/// drops the request, for an install that didn't start
pub fn clear(directory: &Path) {
    let path = directory.join(FILE_NAME);

    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => log::warn!(
            "remove the quiet relaunch marker {}: {error}",
            path.display()
        ),
    }
}

fn is_recent(written_at: SystemTime, now: SystemTime) -> bool {
    // a marker from the future means the clock moved back since it was written
    let age = now.duration_since(written_at).unwrap_or(Duration::ZERO);

    age <= Duration::from_millis(QUIET_RELAUNCH_MAX_AGE_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_start_without_a_marker_opens_the_window() {
        let directory = tempfile::tempdir().unwrap();

        assert!(!take(directory.path(), SystemTime::now()));
    }

    #[test]
    fn the_restart_after_an_update_keeps_the_window_closed_once() {
        let directory = tempfile::tempdir().unwrap();
        mark(directory.path()).unwrap();

        assert!(take(directory.path(), SystemTime::now()));
        assert!(!take(directory.path(), SystemTime::now()));
    }

    #[test]
    fn a_marker_of_an_install_that_never_restarted_is_ignored_and_removed() {
        let directory = tempfile::tempdir().unwrap();
        mark(directory.path()).unwrap();
        let later = SystemTime::now() + Duration::from_millis(QUIET_RELAUNCH_MAX_AGE_MS + 60_000);

        assert!(!take(directory.path(), later));
        assert!(!directory.path().join(FILE_NAME).exists());
    }

    #[test]
    fn the_marker_makes_its_folder() {
        let directory = tempfile::tempdir().unwrap();
        let folder = directory.path().join("cache");

        mark(&folder).unwrap();

        assert!(take(&folder, SystemTime::now()));
    }

    #[test]
    fn a_cleared_marker_opens_the_window() {
        let directory = tempfile::tempdir().unwrap();
        mark(directory.path()).unwrap();

        clear(directory.path());

        assert!(!take(directory.path(), SystemTime::now()));
    }
}
