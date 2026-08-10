use std::fs;

use base64::Engine;
use brawltome_desktop::updater_artifact::{verify_updater_artifacts, UpdaterArtifactInput};

const PUBLIC_KEY: &str = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
const SIGNATURE: &str = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==";

fn fixture() -> (tempfile::TempDir, UpdaterArtifactInput) {
    let directory = tempfile::tempdir().expect("create artifact directory");
    let installer = directory.path().join("BrawlTome-Setup.exe");
    let signature = directory.path().join("BrawlTome-Setup.exe.sig");
    let latest = directory.path().join("latest.json");
    let encoded_signature = base64::engine::general_purpose::STANDARD.encode(SIGNATURE);
    fs::write(&installer, b"test").expect("write installer fixture");
    fs::write(&signature, &encoded_signature).expect("write signature fixture");
    fs::write(
        &latest,
        serde_json::json!({
            "version": "0.1.4",
            "notes": "fixture",
            "pub_date": "2026-08-10T20:00:00Z",
            "platforms": {
                "windows-x86_64": {
                    "signature": encoded_signature,
                    "url": "https://github.com/NickTacke/brawltome/releases/download/v0.1.4/BrawlTome-Setup.exe"
                }
            }
        })
        .to_string(),
    )
    .expect("write latest fixture");

    let input = UpdaterArtifactInput {
        installer_path: installer,
        signature_path: signature,
        latest_json_path: latest,
        encoded_public_key: base64::engine::general_purpose::STANDARD.encode(PUBLIC_KEY),
        expected_version: "0.1.4".to_string(),
        expected_url:
            "https://github.com/NickTacke/brawltome/releases/download/v0.1.4/BrawlTome-Setup.exe"
                .to_string(),
    };
    (directory, input)
}

#[test]
fn verifies_installer_signature_and_exact_update_metadata() {
    let (_directory, input) = fixture();

    let evidence = verify_updater_artifacts(&input).expect("valid updater artifacts");

    assert_eq!(evidence.version, "0.1.4");
    assert_eq!(evidence.platform, "windows-x86_64");
    assert_eq!(
        evidence.installer_sha256,
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    );
    assert!(evidence.signature_verified);
    assert!(!evidence.updater_install_claim);
}

#[test]
fn rejects_tampering_signature_drift_and_insecure_metadata() {
    let (_directory, input) = fixture();
    fs::write(&input.installer_path, b"Test").expect("tamper installer fixture");
    assert!(verify_updater_artifacts(&input)
        .expect_err("tampered installer is rejected")
        .contains("signature verification failed"));

    let (_directory, input) = fixture();
    let mut latest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&input.latest_json_path).expect("read latest"))
            .expect("parse latest");
    latest["platforms"]["windows-x86_64"]["signature"] = "different".into();
    fs::write(&input.latest_json_path, latest.to_string()).expect("write drifted latest");
    assert!(verify_updater_artifacts(&input)
        .expect_err("signature metadata drift is rejected")
        .contains("signature does not match"));

    let (_directory, mut input) = fixture();
    input.expected_url = input.expected_url.replacen("https://", "http://", 1);
    let mut latest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&input.latest_json_path).expect("read latest"))
            .expect("parse latest");
    latest["platforms"]["windows-x86_64"]["url"] = input.expected_url.clone().into();
    fs::write(&input.latest_json_path, latest.to_string()).expect("write insecure latest");
    assert!(verify_updater_artifacts(&input)
        .expect_err("insecure URL is rejected")
        .contains("HTTPS"));
}
