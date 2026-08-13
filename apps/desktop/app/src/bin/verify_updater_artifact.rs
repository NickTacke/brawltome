use std::path::PathBuf;

use brawltome_desktop::updater_artifact::{verify_updater_artifacts, UpdaterArtifactInput};

fn run() -> Result<(), String> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.len() != 5 {
        return Err(
            "usage: verify_updater_artifact <installer> <signature> <latest.json> <tauri.conf.json> <expected-url>"
                .to_string(),
        );
    }

    let config_text = std::fs::read_to_string(&arguments[3])
        .map_err(|error| format!("failed to read Tauri configuration: {error}"))?;
    let config: serde_json::Value = serde_json::from_str(&config_text)
        .map_err(|error| format!("failed to parse Tauri configuration: {error}"))?;
    let version = config
        .get("version")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Tauri configuration is missing version".to_string())?;
    if version != env!("CARGO_PKG_VERSION") {
        return Err(format!(
            "Tauri version {version} does not match Cargo version {}",
            env!("CARGO_PKG_VERSION")
        ));
    }
    let public_key = config
        .pointer("/plugins/updater/pubkey")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "Tauri configuration is missing updater public key".to_string())?;

    let evidence = verify_updater_artifacts(&UpdaterArtifactInput {
        installer_path: PathBuf::from(&arguments[0]),
        signature_path: PathBuf::from(&arguments[1]),
        latest_json_path: PathBuf::from(&arguments[2]),
        encoded_public_key: public_key.to_string(),
        expected_version: version.to_string(),
        expected_url: arguments[4].clone(),
    })?;
    println!(
        "{}",
        serde_json::to_string_pretty(&evidence)
            .map_err(|error| format!("failed to serialize updater evidence: {error}"))?
    );
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
