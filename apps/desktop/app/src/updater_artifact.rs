use std::fs;
use std::path::PathBuf;

use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use sha2::{Digest, Sha256};

const WINDOWS_PLATFORM: &str = "windows-x86_64";

pub struct UpdaterArtifactInput {
    pub installer_path: PathBuf,
    pub signature_path: PathBuf,
    pub latest_json_path: PathBuf,
    pub encoded_public_key: String,
    pub expected_version: String,
    pub expected_url: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterArtifactEvidence {
    pub version: String,
    pub platform: &'static str,
    pub installer_sha256: String,
    pub signature_verified: bool,
    pub updater_install_claim: bool,
}

pub fn verify_updater_artifacts(
    input: &UpdaterArtifactInput,
) -> Result<UpdaterArtifactEvidence, String> {
    let installer = fs::read(&input.installer_path)
        .map_err(|error| format!("failed to read updater installer: {error}"))?;
    if installer.is_empty() {
        return Err("updater installer must not be empty".to_string());
    }

    let signature_text = fs::read_to_string(&input.signature_path)
        .map_err(|error| format!("failed to read updater signature: {error}"))?;
    let decoded_signature = base64::engine::general_purpose::STANDARD
        .decode(signature_text.trim())
        .map_err(|error| format!("failed to decode updater signature base64: {error}"))?;
    let decoded_signature = String::from_utf8(decoded_signature)
        .map_err(|_| "decoded updater signature must be UTF-8".to_string())?;
    let signature = Signature::decode(decoded_signature.trim())
        .map_err(|error| format!("failed to decode updater signature: {error}"))?;
    let decoded_public_key = base64::engine::general_purpose::STANDARD
        .decode(input.encoded_public_key.trim())
        .map_err(|error| format!("failed to decode configured updater public key: {error}"))?;
    let public_key_text = String::from_utf8(decoded_public_key)
        .map_err(|_| "configured updater public key must be UTF-8".to_string())?;
    let public_key = PublicKey::decode(public_key_text.trim())
        .map_err(|error| format!("failed to parse configured updater public key: {error}"))?;
    public_key
        .verify(&installer, &signature, true)
        .map_err(|error| format!("updater signature verification failed: {error}"))?;

    if !input.expected_url.starts_with("https://") {
        return Err("updater URL must use HTTPS".to_string());
    }
    let installer_name = input
        .installer_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "updater installer filename must be UTF-8".to_string())?;
    if input.expected_url.rsplit('/').next() != Some(installer_name) {
        return Err("updater URL filename does not match the installer".to_string());
    }

    let latest_text = fs::read_to_string(&input.latest_json_path)
        .map_err(|error| format!("failed to read latest.json: {error}"))?;
    let latest: serde_json::Value = serde_json::from_str(&latest_text)
        .map_err(|error| format!("failed to parse latest.json: {error}"))?;
    if latest.get("version").and_then(serde_json::Value::as_str)
        != Some(input.expected_version.as_str())
    {
        return Err("latest.json version does not match the desktop version".to_string());
    }
    let platform = latest
        .get("platforms")
        .and_then(|platforms| platforms.get(WINDOWS_PLATFORM))
        .ok_or_else(|| format!("latest.json is missing {WINDOWS_PLATFORM}"))?;
    if platform
        .get("signature")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        != Some(signature_text.trim())
    {
        return Err("latest.json signature does not match the detached signature".to_string());
    }
    if platform.get("url").and_then(serde_json::Value::as_str) != Some(input.expected_url.as_str())
    {
        return Err("latest.json URL does not match the expected release artifact".to_string());
    }

    let installer_sha256 = Sha256::digest(&installer)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(UpdaterArtifactEvidence {
        version: input.expected_version.clone(),
        platform: WINDOWS_PLATFORM,
        installer_sha256,
        signature_verified: true,
        updater_install_claim: false,
    })
}
