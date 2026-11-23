//! nothing to read outside windows, so a match on a mac during development records no usage

use super::ProcessTreeSample;

pub fn sample_process_tree(_at_ms: u64) -> Option<ProcessTreeSample> {
    None
}
