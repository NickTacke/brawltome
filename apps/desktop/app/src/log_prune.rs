//! Pure utility: keep only the newest N files in a directory matching a
//! given filename prefix. Used at app launch to bound the log directory's
//! footprint without manually rotating mid-session.

use std::path::PathBuf;

/// Given an iterable of log file paths and their last-modified epoch seconds,
/// return the subset that should be deleted to keep at most `keep` newest.
///
/// Pure (no fs access) so it's trivially testable. Caller is responsible for
/// listing the directory and deleting the returned paths.
pub fn paths_to_delete(mut entries: Vec<(PathBuf, u64)>, keep: usize) -> Vec<PathBuf> {
    if entries.len() <= keep {
        return Vec::new();
    }
    // Sort newest-first by mtime epoch.
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    entries.into_iter().skip(keep).map(|(p, _)| p).collect()
}

/// Read directory entries matching `*.log`, compute their mtime epoch seconds,
/// and delete all but the newest `keep` files. Errors are logged and ignored:
/// log pruning is best-effort, never fatal.
pub fn prune_log_dir(log_dir: &std::path::Path, keep: usize) {
    let read_dir = match std::fs::read_dir(log_dir) {
        Ok(rd) => rd,
        Err(e) => {
            log::warn!("log prune: failed to read {}: {e}", log_dir.display());
            return;
        }
    };

    let mut entries: Vec<(std::path::PathBuf, u64)> = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("log") {
            continue;
        }
        // Skip entries with unreadable mtime instead of treating them as
        // epoch 0. Treating them as oldest would risk pruning a fresh log
        // file whose metadata happened to be momentarily unreadable (e.g.,
        // permissions race). Best-effort: leave such files alone.
        let Ok(mtime_st) = entry.metadata().and_then(|m| m.modified()) else {
            continue;
        };
        let mtime = mtime_st
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        entries.push((path, mtime));
    }

    for path in paths_to_delete(entries, keep) {
        if let Err(e) = std::fs::remove_file(&path) {
            log::warn!("log prune: failed to delete {}: {e}", path.display());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn empty_input_returns_empty() {
        let got = paths_to_delete(Vec::new(), 10);
        assert!(got.is_empty());
    }

    #[test]
    fn fewer_than_keep_returns_empty() {
        let got = paths_to_delete(vec![(p("a.log"), 1), (p("b.log"), 2)], 10);
        assert!(got.is_empty());
    }

    #[test]
    fn exactly_keep_returns_empty() {
        let got = paths_to_delete(vec![(p("a.log"), 1), (p("b.log"), 2)], 2);
        assert!(got.is_empty());
    }

    #[test]
    fn deletes_oldest_when_over_keep() {
        let entries = vec![
            (p("oldest.log"), 1),
            (p("middle.log"), 2),
            (p("newest.log"), 3),
        ];
        let got = paths_to_delete(entries, 2);
        assert_eq!(got, vec![p("oldest.log")]);
    }

    #[test]
    fn keeps_n_newest_drops_the_rest() {
        let entries = vec![
            (p("a.log"), 5),
            (p("b.log"), 1),
            (p("c.log"), 4),
            (p("d.log"), 2),
            (p("e.log"), 3),
        ];
        let mut got = paths_to_delete(entries, 2);
        got.sort();
        let mut want = vec![p("b.log"), p("d.log"), p("e.log")];
        want.sort();
        assert_eq!(got, want);
    }

    #[test]
    fn ties_on_mtime_use_input_order_stably() {
        // Three files with identical mtime, keep=1. Rust's sort_by is stable,
        // so the FIRST entry in input order wins (becomes "newest" after the
        // descending stable sort), and the rest are deleted. Pinning this
        // behavior via test guards against accidental migration to an
        // unstable sort, which would make tie-breaking non-deterministic
        // and could silently regress which file survives.
        let entries = vec![
            (p("first.log"), 100),
            (p("second.log"), 100),
            (p("third.log"), 100),
        ];
        let got = paths_to_delete(entries, 1);
        assert_eq!(got, vec![p("second.log"), p("third.log")]);
    }
}
