//! what the app itself used during a match, from two readings of the totals windows keeps per process

use std::collections::{HashMap, HashSet};

use serde::Serialize;

#[cfg(not(windows))]
mod dev_platform;
#[cfg(windows)]
mod win32;

#[cfg(not(windows))]
pub use dev_platform::sample_process_tree;
#[cfg(windows)]
pub use win32::sample_process_tree;

const BYTES_PER_MB: u64 = 1024 * 1024;
const LOWEST_SHOWN_PERCENT: f64 = 0.01;

/// the app's processes at one moment: the cpu time each has used since it started, and the memory it holds now
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ProcessTreeSample {
    pub cpu_ms_by_pid: HashMap<u32, u64>,
    pub working_set_bytes_by_pid: HashMap<u32, u64>,
    /// on the session's clock
    pub at_ms: u64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchUsage {
    pub cpu_ms: u64,
    /// of the whole machine over the match, all cores together, the way task manager counts
    pub cpu_percent: f64,
    /// the working set at the end of the match
    pub ram_mb: u64,
    pub request_count: u32,
    pub duration_ms: u64,
}

pub fn usage_between(
    start: &ProcessTreeSample,
    end: &ProcessTreeSample,
    logical_cores: u32,
    request_count: u32,
) -> MatchUsage {
    let duration_ms = end.at_ms.saturating_sub(start.at_ms);
    // a process that exited during the match is only in the start reading; windows drops its totals with it, so
    // what it used is lost
    let cpu_ms = end
        .cpu_ms_by_pid
        .iter()
        .map(|(pid, end_cpu_ms)| cpu_used_ms(start, *pid, *end_cpu_ms))
        .sum();
    let working_set_bytes: u64 = end.working_set_bytes_by_pid.values().sum();

    MatchUsage {
        cpu_ms,
        cpu_percent: cpu_percent(cpu_ms, duration_ms, logical_cores),
        ram_mb: rounded_mb(working_set_bytes),
        request_count,
        duration_ms,
    }
}

/// a process only in the end reading started during the match, so all of its time falls in it
fn cpu_used_ms(start: &ProcessTreeSample, pid: u32, end_cpu_ms: u64) -> u64 {
    let Some(start_cpu_ms) = start.cpu_ms_by_pid.get(&pid).copied() else {
        return end_cpu_ms;
    };

    // fewer ms than at the start means windows gave the id to a newer process
    if start_cpu_ms > end_cpu_ms {
        return end_cpu_ms;
    }

    end_cpu_ms - start_cpu_ms
}

fn cpu_percent(cpu_ms: u64, duration_ms: u64, logical_cores: u32) -> f64 {
    let capacity_ms = duration_ms.saturating_mul(u64::from(logical_cores.max(1)));
    if capacity_ms == 0 {
        return 0.0;
    }

    // one division of whole numbers, so the result is the nearest float to the true share
    (cpu_ms as f64 * 100.0) / capacity_ms as f64
}

fn rounded_mb(bytes: u64) -> u64 {
    bytes.saturating_add(BYTES_PER_MB / 2) / BYTES_PER_MB
}

/// the app's own process, the processes it started, and theirs in turn
pub fn process_tree(root_pid: u32, parent_by_pid: &[(u32, u32)]) -> Vec<u32> {
    let mut tree = vec![root_pid];
    let mut seen = HashSet::from([root_pid]);
    let mut next_index = 0;

    while let Some(parent_pid) = tree.get(next_index).copied() {
        let children: Vec<u32> = parent_by_pid
            .iter()
            .filter(|(pid, parent)| *parent == parent_pid && seen.insert(*pid))
            .map(|(pid, _)| *pid)
            .collect();

        tree.extend(children);
        next_index += 1;
    }

    tree
}

/// "<0.01%" for a share too small to show in two decimals, so it never reads as nothing or as more
pub fn percent_text(percent: f64) -> String {
    if percent < LOWEST_SHOWN_PERCENT {
        return "<0.01%".to_string();
    }

    format!("{percent:.2}%")
}

impl MatchUsage {
    /// "match usage: cpu 40 ms (0.02%), ram 92 MB, 1 request, 182 s"
    pub fn log_line(&self) -> String {
        let requests = match self.request_count {
            1 => "1 request".to_string(),
            count => format!("{count} requests"),
        };
        let seconds = (self.duration_ms + 500) / 1_000;

        format!(
            "match usage: cpu {} ms ({}), ram {} MB, {requests}, {seconds} s",
            self.cpu_ms,
            percent_text(self.cpu_percent),
            self.ram_mb
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MB: u64 = BYTES_PER_MB;

    fn sample(
        at_ms: u64,
        cpu_ms: &[(u32, u64)],
        working_set_bytes: &[(u32, u64)],
    ) -> ProcessTreeSample {
        ProcessTreeSample {
            cpu_ms_by_pid: cpu_ms.iter().copied().collect(),
            working_set_bytes_by_pid: working_set_bytes.iter().copied().collect(),
            at_ms,
        }
    }

    #[test]
    fn the_cpu_used_is_the_difference_over_every_process() {
        let start = sample(0, &[(10, 5_000), (11, 1_200)], &[]);
        let end = sample(182_000, &[(10, 5_030), (11, 1_210)], &[]);

        let usage = usage_between(&start, &end, 8, 1);

        assert_eq!(usage.cpu_ms, 40);
        assert_eq!(usage.duration_ms, 182_000);
        assert_eq!(usage.request_count, 1);
    }

    #[test]
    fn processes_that_came_or_went_during_the_match() {
        let cases = [
            (
                "started during the match: all of its time",
                sample(0, &[(10, 5_000)], &[]),
                sample(1_000, &[(10, 5_010), (12, 300)], &[]),
                310,
            ),
            (
                "exited during the match: lost with it",
                sample(0, &[(10, 5_000), (11, 900)], &[]),
                sample(1_000, &[(10, 5_010)], &[]),
                10,
            ),
            (
                "a reused process id: the newer process, from its start",
                sample(0, &[(10, 5_000)], &[]),
                sample(1_000, &[(10, 70)], &[]),
                70,
            ),
        ];

        for (description, start, end, cpu_ms) in cases {
            let usage = usage_between(&start, &end, 8, 0);

            assert_eq!(usage.cpu_ms, cpu_ms, "{description}");
        }
    }

    #[test]
    fn the_ram_is_the_working_set_at_the_end() {
        let start = sample(0, &[], &[(10, 300 * MB)]);
        let end = sample(1_000, &[], &[(10, 41 * MB), (11, 51 * MB)]);

        let usage = usage_between(&start, &end, 8, 0);

        assert_eq!(usage.ram_mb, 92);
    }

    #[test]
    fn the_percent_is_of_every_core_over_the_match() {
        let cases = [
            ("eight cores", 290, 200_000, 8, 0.018_125),
            ("one core, all of it", 1_000, 1_000, 1, 100.0),
            ("zero cores counts as one", 500, 1_000, 0, 50.0),
            ("a zero-length match", 40, 0, 8, 0.0),
        ];

        for (description, cpu_ms, duration_ms, logical_cores, percent) in cases {
            let start = sample(0, &[(10, 0)], &[]);
            let end = sample(duration_ms, &[(10, cpu_ms)], &[]);

            let usage = usage_between(&start, &end, logical_cores, 0);

            assert_eq!(usage.cpu_percent, percent, "{description}");
        }
    }

    #[test]
    fn the_tree_is_the_app_and_everything_below_it() {
        let parent_by_pid = [
            (4, 0),
            (100, 4),
            (200, 100),
            (300, 200),
            (301, 200),
            (400, 300),
            (500, 4),
        ];

        let mut tree = process_tree(200, &parent_by_pid);
        tree.sort_unstable();

        assert_eq!(tree, vec![200, 300, 301, 400]);
    }

    #[test]
    fn a_process_that_names_itself_as_parent_is_walked_once() {
        let parent_by_pid = [(0, 0), (200, 0), (300, 200)];

        let mut tree = process_tree(0, &parent_by_pid);
        tree.sort_unstable();

        assert_eq!(tree, vec![0, 200, 300]);
    }

    #[test]
    fn a_tiny_share_stays_honest() {
        let cases = [
            (0.0, "<0.01%"),
            (0.004, "<0.01%"),
            (0.018_125, "0.02%"),
            (1.5, "1.50%"),
        ];

        for (percent, text) in cases {
            assert_eq!(percent_text(percent), text, "{percent}");
        }
    }

    #[test]
    fn the_log_line_reads_like_a_sentence() {
        let usage = |request_count| MatchUsage {
            cpu_ms: 40,
            cpu_percent: 0.024,
            ram_mb: 92,
            request_count,
            duration_ms: 182_400,
        };

        assert_eq!(
            usage(1).log_line(),
            "match usage: cpu 40 ms (0.02%), ram 92 MB, 1 request, 182 s"
        );
        assert_eq!(
            usage(3).log_line(),
            "match usage: cpu 40 ms (0.02%), ram 92 MB, 3 requests, 182 s"
        );
    }
}
