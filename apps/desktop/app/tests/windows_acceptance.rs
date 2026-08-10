use std::fs;
use std::time::Duration;

use brawltome_desktop::windows_acceptance::{
    AcceptanceCheck, AcceptanceMode, AcceptanceProbe, SampleOutcome,
};

#[test]
fn disabled_probe_never_creates_evidence() {
    let directory = tempfile::tempdir().expect("create test directory");
    let path = directory.path().join("disabled.jsonl");
    let probe = AcceptanceProbe::disabled();

    probe
        .record_check(AcceptanceCheck::GameProcessDetected)
        .expect("disabled probe is a no-op");
    assert!(probe
        .start_opponent_sample(AcceptanceMode::Ranked1v1)
        .expect("disabled sample start")
        .is_none());
    assert!(probe
        .complete_opponent_sample("sample-1", SampleOutcome::OpponentRendered)
        .expect("disabled sample completion")
        .is_none());
    probe.abort_opponent_samples();
    assert!(!path.exists());
}

#[test]
fn enabled_probe_records_identifier_free_checks_and_one_shot_samples() {
    let directory = tempfile::tempdir().expect("create test directory");
    let path = directory.path().join("acceptance.jsonl");
    let probe = AcceptanceProbe::enabled(path.clone(), 4);

    probe
        .record_check(AcceptanceCheck::ProcessAttached)
        .expect("record process check");
    let sample_id = probe
        .start_opponent_sample(AcceptanceMode::Ranked1v1)
        .expect("start sample")
        .expect("enabled probe returns sample ID");
    std::thread::sleep(Duration::from_millis(2));
    let completion = probe
        .complete_opponent_sample(&sample_id, SampleOutcome::OpponentRendered)
        .expect("complete sample")
        .expect("known sample completes");

    assert!(completion.duration_ms >= 1);
    assert_eq!(completion.mode, AcceptanceMode::Ranked1v1);
    assert!(probe
        .complete_opponent_sample(&sample_id, SampleOutcome::OpponentRendered)
        .expect("duplicate completion is harmless")
        .is_none());

    let contents = fs::read_to_string(path).expect("read evidence");
    let records: Vec<serde_json::Value> = contents
        .lines()
        .map(|line| serde_json::from_str(line).expect("valid JSONL record"))
        .collect();
    assert_eq!(records[0]["type"], "check");
    assert_eq!(records[0]["name"], "processAttached");
    assert_eq!(records[1]["type"], "opponent_rendered");
    assert_eq!(records[1]["sampleId"], sample_id);
    assert_eq!(records[1]["ranked"], true);
    assert_eq!(records[1]["mode"], "ranked1v1");
    assert_eq!(records[0]["sessionId"], records[1]["sessionId"]);
    assert!(contents.contains("durationMs"));
    for forbidden in [
        "brawlhallaId",
        "playerName",
        "apiUrl",
        "token",
        "credential",
    ] {
        assert!(!contents.contains(forbidden), "evidence leaked {forbidden}");
    }
}

#[test]
fn probe_bounds_and_aborts_outstanding_samples() {
    let directory = tempfile::tempdir().expect("create test directory");
    let probe = AcceptanceProbe::enabled(directory.path().join("acceptance.jsonl"), 2);

    let first = probe
        .start_opponent_sample(AcceptanceMode::Ranked1v1)
        .expect("first start")
        .expect("first ID");
    let second = probe
        .start_opponent_sample(AcceptanceMode::Other)
        .expect("second start")
        .expect("second ID");
    assert!(probe
        .start_opponent_sample(AcceptanceMode::Ranked2v2)
        .expect("bounded start")
        .is_none());

    probe.abort_opponent_samples();
    assert!(probe
        .complete_opponent_sample(&first, SampleOutcome::OpponentRendered)
        .expect("aborted completion")
        .is_none());
    assert!(probe
        .complete_opponent_sample(&second, SampleOutcome::ApiFailureRendered)
        .expect("aborted completion")
        .is_none());
    assert!(probe
        .start_opponent_sample(AcceptanceMode::Ranked3v3)
        .expect("start after abort")
        .is_some());
}

#[test]
fn write_failures_cannot_become_success_evidence() {
    let directory = tempfile::tempdir().expect("create test directory");
    let probe = AcceptanceProbe::enabled(directory.path().to_path_buf(), 1);

    let error = probe
        .record_check(AcceptanceCheck::OverlayVisible)
        .expect_err("directory path is not writable as a file");
    assert!(error.to_string().contains("acceptance evidence"));
}
