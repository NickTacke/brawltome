use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[cfg(target_os = "windows")]
const DEFAULT_MAX_OUTSTANDING_SAMPLES: usize = 32;

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AcceptanceCheck {
    GameProcessDetected,
    ProcessAttached,
    DetectionReady,
    RankedOpponentDetected,
    ProcessDetached,
    OverlayVisible,
    OverlayAlwaysOnTop,
    ClickThroughEnabled,
    ClickThroughDisabled,
    TrayHidden,
    TrayShown,
    TrayQuit,
    ApiFailurePresented,
    AppSurvivedApiFailure,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AcceptanceMode {
    Ranked1v1,
    Ranked2v2,
    Ranked3v3,
    Other,
}

impl AcceptanceMode {
    fn is_ranked(self) -> bool {
        !matches!(self, Self::Other)
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SampleOutcome {
    OpponentRendered,
    ApiFailureRendered,
}

#[derive(Debug, Clone, Copy)]
pub struct SampleCompletion {
    pub duration_ms: u64,
    pub mode: AcceptanceMode,
}

struct OutstandingSample {
    started_at: Instant,
    mode: AcceptanceMode,
}

struct ProbeState {
    session_id: uuid::Uuid,
    next_sample_id: u64,
    outstanding: HashMap<String, OutstandingSample>,
}

struct EnabledProbe {
    path: PathBuf,
    max_outstanding_samples: usize,
    state: Mutex<ProbeState>,
}

pub struct AcceptanceProbe {
    enabled: Option<EnabledProbe>,
}

#[derive(serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum EvidenceRecord<'a> {
    Check {
        name: AcceptanceCheck,
        #[serde(rename = "sessionId")]
        session_id: uuid::Uuid,
        #[serde(rename = "observedAt")]
        observed_at: String,
    },
    OpponentRendered {
        #[serde(rename = "sampleId")]
        sample_id: &'a str,
        #[serde(rename = "durationMs")]
        duration_ms: u64,
        ranked: bool,
        mode: AcceptanceMode,
        outcome: SampleOutcome,
        #[serde(rename = "sessionId")]
        session_id: uuid::Uuid,
        #[serde(rename = "observedAt")]
        observed_at: String,
    },
}

impl AcceptanceProbe {
    #[cfg(target_os = "windows")]
    pub fn from_environment() -> Self {
        match std::env::var_os("BRAWLTOME_WINDOWS_ACCEPTANCE_EVIDENCE") {
            Some(path) if !path.is_empty() => {
                Self::enabled(PathBuf::from(path), DEFAULT_MAX_OUTSTANDING_SAMPLES)
            }
            _ => Self::disabled(),
        }
    }

    #[cfg(not(target_os = "windows"))]
    pub fn from_environment() -> Self {
        Self::disabled()
    }

    pub fn disabled() -> Self {
        Self { enabled: None }
    }

    pub fn enabled(path: PathBuf, max_outstanding_samples: usize) -> Self {
        Self {
            enabled: Some(EnabledProbe {
                path,
                max_outstanding_samples: max_outstanding_samples.max(1),
                state: Mutex::new(ProbeState {
                    session_id: uuid::Uuid::new_v4(),
                    next_sample_id: 1,
                    outstanding: HashMap::new(),
                }),
            }),
        }
    }

    pub fn record_check(&self, name: AcceptanceCheck) -> Result<(), String> {
        let Some(enabled) = &self.enabled else {
            return Ok(());
        };
        let state = enabled
            .state
            .lock()
            .map_err(|_| "acceptance evidence state lock was poisoned".to_string())?;
        write_record(
            &enabled.path,
            &EvidenceRecord::Check {
                name,
                session_id: state.session_id,
                observed_at: chrono::Utc::now().to_rfc3339(),
            },
        )
    }

    pub fn start_opponent_sample(&self, mode: AcceptanceMode) -> Result<Option<String>, String> {
        let Some(enabled) = &self.enabled else {
            return Ok(None);
        };
        let mut state = enabled
            .state
            .lock()
            .map_err(|_| "acceptance evidence state lock was poisoned".to_string())?;
        if state.outstanding.len() >= enabled.max_outstanding_samples {
            return Ok(None);
        }
        let sample_id = format!("{}-{}", state.session_id, state.next_sample_id);
        state.next_sample_id = state.next_sample_id.saturating_add(1);
        state.outstanding.insert(
            sample_id.clone(),
            OutstandingSample {
                started_at: Instant::now(),
                mode,
            },
        );
        Ok(Some(sample_id))
    }

    pub fn complete_opponent_sample(
        &self,
        sample_id: &str,
        outcome: SampleOutcome,
    ) -> Result<Option<SampleCompletion>, String> {
        let Some(enabled) = &self.enabled else {
            return Ok(None);
        };
        let mut state = enabled
            .state
            .lock()
            .map_err(|_| "acceptance evidence state lock was poisoned".to_string())?;
        let Some(sample) = state.outstanding.remove(sample_id) else {
            return Ok(None);
        };
        let completion = SampleCompletion {
            duration_ms: sample
                .started_at
                .elapsed()
                .as_millis()
                .min(u128::from(u64::MAX)) as u64,
            mode: sample.mode,
        };
        write_record(
            &enabled.path,
            &EvidenceRecord::OpponentRendered {
                sample_id,
                duration_ms: completion.duration_ms,
                ranked: completion.mode.is_ranked(),
                mode: completion.mode,
                outcome,
                session_id: state.session_id,
                observed_at: chrono::Utc::now().to_rfc3339(),
            },
        )?;
        Ok(Some(completion))
    }

    pub fn abort_opponent_samples(&self) {
        if let Some(enabled) = &self.enabled {
            if let Ok(mut state) = enabled.state.lock() {
                state.outstanding.clear();
            }
        }
    }
}

#[tauri::command]
pub fn complete_acceptance_sample(
    sample_id: String,
    api_failure_presented: bool,
    probe: tauri::State<'_, Arc<AcceptanceProbe>>,
) -> Result<(), String> {
    let outcome = if api_failure_presented {
        SampleOutcome::ApiFailureRendered
    } else {
        SampleOutcome::OpponentRendered
    };
    let completed = probe.complete_opponent_sample(&sample_id, outcome)?;
    if completed.is_some() && api_failure_presented {
        probe.record_check(AcceptanceCheck::ApiFailurePresented)?;
        probe.record_check(AcceptanceCheck::AppSurvivedApiFailure)?;
    }
    Ok(())
}

fn write_record(path: &PathBuf, record: &EvidenceRecord<'_>) -> Result<(), String> {
    let serialized = serde_json::to_string(record)
        .map_err(|error| format!("failed to serialize acceptance evidence: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| format!("failed to open acceptance evidence: {error}"))?;
    writeln!(file, "{serialized}")
        .map_err(|error| format!("failed to write acceptance evidence: {error}"))
}
