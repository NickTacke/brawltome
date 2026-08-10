use std::io::{Read, Write};
use std::net::TcpListener;

use brawltome_contracts::generated::Client;
use brawltome_contracts::generated::types::{
    ContractProof, ContractProofEvent, GetContractProofXInternalSecret, PlayerRankedProfile,
    RefreshOutcome,
};

const VALID_PRESENT: &str = include_str!("../../tests/fixtures/valid-present.json");
const VALID_MISSING_OPTIONAL: &str =
    include_str!("../../tests/fixtures/valid-missing-optional.json");
const VALID_NULL: &str = include_str!("../../tests/fixtures/valid-null.json");
const INVALID_MISSING_NULLABLE: &str =
    include_str!("../../tests/fixtures/invalid-missing-nullable.json");
const INVALID_NEGATIVE: &str = include_str!("../../tests/fixtures/invalid-negative.json");
const INVALID_OUT_OF_RANGE: &str = include_str!("../../tests/fixtures/invalid-out-of-range.json");
const INVALID_DATE_TIME: &str = include_str!("../../tests/fixtures/invalid-date-time.json");
const INVALID_OFFSET_DATE_TIME: &str =
    include_str!("../../tests/fixtures/invalid-offset-date-time.json");
const INVALID_UNION: &str = include_str!("../../tests/fixtures/invalid-union.json");
const PLAYER_RANKED_MEASURED_ZERO: &str =
    include_str!("../../tests/fixtures/player-ranked-measured-zero.json");
const REFRESH_OUTCOMES: [&str; 6] = [
    include_str!("../../tests/fixtures/refresh-accepted.json"),
    include_str!("../../tests/fixtures/refresh-already-refreshing.json"),
    include_str!("../../tests/fixtures/refresh-not-needed.json"),
    include_str!("../../tests/fixtures/refresh-verification-required.json"),
    include_str!("../../tests/fixtures/refresh-rate-limited.json"),
    include_str!("../../tests/fixtures/refresh-temporarily-unavailable.json"),
];

#[test]
fn accepts_optional_nullable_zero_datetime_and_union_variants() {
    let present: ContractProof =
        serde_json::from_str(VALID_PRESENT).expect("valid present fixture");
    assert_eq!(present.count, 0);
    assert_eq!(present.required_nullable.as_deref(), Some("present"));
    assert_eq!(present.optional_value.as_deref(), Some("optional"));
    assert_eq!(
        present.occurred_at.to_rfc3339(),
        "2026-08-09T12:34:56+00:00"
    );
    assert!(matches!(
        present.event,
        ContractProofEvent::Ready { attempt: 0 }
    ));

    let missing_optional: ContractProof =
        serde_json::from_str(VALID_MISSING_OPTIONAL).expect("valid missing optional fixture");
    assert_eq!(missing_optional.optional_value, None);

    let nullable: ContractProof = serde_json::from_str(VALID_NULL).expect("valid null fixture");
    assert_eq!(nullable.required_nullable, None);
    assert!(matches!(nullable.event, ContractProofEvent::Failed { .. }));

    for fixture in [VALID_PRESENT, VALID_MISSING_OPTIONAL, VALID_NULL] {
        let wire_value: serde_json::Value =
            serde_json::from_str(fixture).expect("valid JSON fixture");
        let generated: ContractProof =
            serde_json::from_value(wire_value.clone()).expect("valid generated type");
        assert_eq!(
            serde_json::to_value(generated).expect("serialize generated type"),
            wire_value
        );
    }
}

#[test]
fn rejects_missing_nullable_out_of_range_datetime_and_unknown_union() {
    for (name, invalid) in [
        ("missing nullable", INVALID_MISSING_NULLABLE),
        ("negative", INVALID_NEGATIVE),
        ("out of range", INVALID_OUT_OF_RANGE),
        ("date-time", INVALID_DATE_TIME),
        ("offset date-time", INVALID_OFFSET_DATE_TIME),
        ("union", INVALID_UNION),
    ] {
        assert!(
            serde_json::from_str::<ContractProof>(invalid).is_err(),
            "accepted invalid {name} fixture"
        );
    }
}

#[test]
fn generated_ranked_profile_preserves_measured_zero_and_solo_sentinel() {
    let wire: serde_json::Value =
        serde_json::from_str(PLAYER_RANKED_MEASURED_ZERO).expect("valid ranked fixture");
    let profile: PlayerRankedProfile =
        serde_json::from_value(wire.clone()).expect("generated ranked profile");
    assert_eq!(
        serde_json::to_value(profile).expect("serialize ranked profile"),
        wire
    );
}

#[test]
fn generated_ranked_profile_rejects_wire_values_rejected_by_zod() {
    for (name, pointer, invalid) in [
        (
            "negative rating",
            "/snapshot/oneVsOne/rating",
            serde_json::json!(-1),
        ),
        (
            "out-of-range player ID",
            "/brawlhallaId",
            serde_json::json!(2_147_483_648u64),
        ),
        (
            "out-of-range global rank",
            "/snapshot/oneVsOne/globalRank",
            serde_json::json!(2_147_483_648u64),
        ),
        (
            "freshness drift",
            "/freshForSeconds",
            serde_json::json!(3599),
        ),
        (
            "offset checked-at",
            "/checkedAt",
            serde_json::json!("2026-08-09T22:00:00+00:00"),
        ),
        (
            "offset last-success",
            "/lastSuccessAt",
            serde_json::json!("2026-08-09T22:00:00+00:00"),
        ),
        (
            "separator-only tier",
            "/snapshot/oneVsOne/tier",
            serde_json::json!(" \u{200b}"),
        ),
        (
            "nonzero Solo sentinel",
            "/snapshot/soloQueue/0/secondPlayerId",
            serde_json::json!(1),
        ),
    ] {
        let mut wire: serde_json::Value =
            serde_json::from_str(PLAYER_RANKED_MEASURED_ZERO).expect("valid ranked fixture");
        *wire.pointer_mut(pointer).expect("fixture pointer exists") = invalid;
        assert!(
            serde_json::from_value::<PlayerRankedProfile>(wire).is_err(),
            "accepted invalid ranked {name}"
        );
    }
}

#[test]
fn generated_refresh_outcomes_preserve_all_six_semantic_variants() {
    for fixture in REFRESH_OUTCOMES {
        let wire: serde_json::Value = serde_json::from_str(fixture).expect("valid refresh fixture");
        let outcome: RefreshOutcome =
            serde_json::from_value(wire.clone()).expect("generated refresh outcome");
        assert_eq!(
            serde_json::to_value(outcome).expect("serialize refresh outcome"),
            wire
        );
    }

    assert!(matches!(
        serde_json::from_str::<RefreshOutcome>(REFRESH_OUTCOMES[0]).unwrap(),
        RefreshOutcome::Accepted { .. }
    ));
    assert!(matches!(
        serde_json::from_str::<RefreshOutcome>(REFRESH_OUTCOMES[1]).unwrap(),
        RefreshOutcome::AlreadyRefreshing { .. }
    ));
    assert!(matches!(
        serde_json::from_str::<RefreshOutcome>(REFRESH_OUTCOMES[2]).unwrap(),
        RefreshOutcome::NotNeeded { .. }
    ));
    assert!(matches!(
        serde_json::from_str::<RefreshOutcome>(REFRESH_OUTCOMES[3]).unwrap(),
        RefreshOutcome::VerificationRequired { .. }
    ));
    assert!(matches!(
        serde_json::from_str::<RefreshOutcome>(REFRESH_OUTCOMES[4]).unwrap(),
        RefreshOutcome::RateLimited { .. }
    ));
    assert!(matches!(
        serde_json::from_str::<RefreshOutcome>(REFRESH_OUTCOMES[5]).unwrap(),
        RefreshOutcome::TemporarilyUnavailable { .. }
    ));
}

#[tokio::test]
async fn generated_client_sends_the_required_internal_secret() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
    let address = listener.local_addr().expect("read test server address");
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept generated client request");
        let mut request = [0_u8; 4096];
        let length = stream
            .read(&mut request)
            .expect("read generated client request");
        let request = String::from_utf8_lossy(&request[..length]).to_ascii_lowercase();
        assert!(request.starts_with("get /internal/contracts/proof "));
        assert!(request.contains("x-internal-secret: contract-proof-secret"));

        let body = VALID_NULL.as_bytes();
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            body.len()
        )
        .expect("write test response headers");
        stream.write_all(body).expect("write test response body");
    });

    let secret =
        GetContractProofXInternalSecret::try_from("contract-proof-secret").expect("valid secret");
    let response = Client::new(&format!("http://{address}"))
        .get_contract_proof(&secret)
        .await
        .expect("generated client request succeeds")
        .into_inner();
    assert_eq!(response.required_nullable, None);
    server.join().expect("test server completes");
}
