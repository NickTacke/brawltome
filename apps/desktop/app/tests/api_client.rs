use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

use brawltome_desktop::api_client::{
    finish_poll_deadline, ApiClient, OpponentData, OpponentFreshness, RefreshState,
};

const MEASURED_ZERO: &str =
    include_str!("../../../../packages/contracts/tests/fixtures/desktop-ranked-measured-zero.json");
const MISSING_ACCEPTED: &str = include_str!(
    "../../../../packages/contracts/tests/fixtures/desktop-ranked-missing-accepted.json"
);
const UNAVAILABLE_VERIFICATION: &str = include_str!(
    "../../../../packages/contracts/tests/fixtures/desktop-ranked-unavailable-verification-required.json"
);
const STALE_REFRESHING: &str = include_str!(
    "../../../../packages/contracts/tests/fixtures/desktop-ranked-stale-already-refreshing.json"
);
const STALE_RATE_LIMITED: &str = include_str!(
    "../../../../packages/contracts/tests/fixtures/desktop-ranked-stale-rate-limited.json"
);
const STALE_TEMPORARILY_UNAVAILABLE: &str = include_str!(
    "../../../../packages/contracts/tests/fixtures/desktop-ranked-stale-temporarily-unavailable.json"
);

fn serve_once(
    brawlhalla_id: u32,
    status: &str,
    body: String,
) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind desktop client fixture server");
    let address = listener.local_addr().expect("fixture server address");
    let status = status.to_string();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept desktop lookup request");
        let mut request = [0_u8; 4096];
        let length = stream
            .read(&mut request)
            .expect("read desktop lookup request");
        let request = String::from_utf8_lossy(&request[..length]);
        assert!(request.starts_with(&format!("GET /api/overlay/opponent/{brawlhalla_id} ")));

        write!(
            stream,
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            body.len()
        )
        .expect("write fixture response headers");
        stream
            .write_all(body.as_bytes())
            .expect("write fixture response body");
    });
    (format!("http://{address}"), server)
}

fn serve_oversized_headers_once(brawlhalla_id: u32) -> (String, std::thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind oversized fixture server");
    let address = listener.local_addr().expect("oversized fixture address");
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept oversized lookup request");
        let mut request = [0_u8; 4096];
        let length = stream
            .read(&mut request)
            .expect("read oversized lookup request");
        let request = String::from_utf8_lossy(&request[..length]);
        assert!(request.starts_with(&format!("GET /api/overlay/opponent/{brawlhalla_id} ")));
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
            256 * 1024 + 1
        )
        .expect("write oversized fixture headers");
    });
    (format!("http://{address}"), server)
}

async fn lookup_fixture(
    brawlhalla_id: u32,
    fixture: &str,
) -> brawltome_desktop::api_client::OpponentLookup {
    let (base_url, server) = serve_once(brawlhalla_id, "200 OK", fixture.to_string());
    let lookup = ApiClient::new(base_url)
        .fetch_opponent(brawlhalla_id)
        .await
        .expect("generated desktop lookup succeeds");
    server.join().expect("fixture server completes");
    lookup
}

#[tokio::test]
async fn generated_lookup_preserves_measured_zero_and_nullable_values() {
    let lookup = lookup_fixture(91_913_839, MEASURED_ZERO).await;

    assert_eq!(lookup.opponent.brawlhalla_id, 91_913_839);
    assert_eq!(lookup.opponent.name.as_deref(), Some("Measured Zero"));
    assert_eq!(lookup.opponent.rating, Some(0));
    assert_eq!(lookup.opponent.peak_rating, Some(782));
    assert_eq!(lookup.opponent.win_rate, None);
    assert_eq!(lookup.opponent.legend_key, None);
    assert_eq!(lookup.opponent.freshness, OpponentFreshness::Fresh);
    assert_eq!(lookup.opponent.refresh_state, RefreshState::Idle);
    assert_eq!(lookup.poll_after, None);
}

#[tokio::test]
async fn generated_lookup_maps_canonical_missing_unavailable_stale_and_retry_states() {
    let missing = lookup_fixture(42, MISSING_ACCEPTED).await;
    assert_eq!(missing.opponent.freshness, OpponentFreshness::Missing);
    assert_eq!(missing.opponent.refresh_state, RefreshState::Refreshing);
    assert_eq!(missing.opponent.rating, None);
    assert_eq!(missing.poll_after, Some(Duration::from_secs(2)));

    let unavailable = lookup_fixture(42, UNAVAILABLE_VERIFICATION).await;
    assert_eq!(
        unavailable.opponent.freshness,
        OpponentFreshness::Unavailable
    );
    assert_eq!(
        unavailable.opponent.refresh_state,
        RefreshState::VerificationRequired
    );
    assert_eq!(unavailable.opponent.rating, None);
    assert_eq!(unavailable.poll_after, None);

    let stale = lookup_fixture(42, STALE_REFRESHING).await;
    assert_eq!(stale.opponent.freshness, OpponentFreshness::Stale);
    assert_eq!(stale.opponent.refresh_state, RefreshState::Refreshing);
    assert_eq!(stale.opponent.rating, Some(1900));
    assert_eq!(stale.opponent.win_rate, Some(45.0));
    assert_eq!(stale.poll_after, Some(Duration::from_secs(2)));

    let limited = lookup_fixture(42, STALE_RATE_LIMITED).await;
    assert_eq!(limited.opponent.freshness, OpponentFreshness::Stale);
    assert_eq!(limited.opponent.refresh_state, RefreshState::RateLimited);
    assert_eq!(limited.opponent.rating, Some(1900));
    assert_eq!(limited.opponent.retry_after_seconds, Some(900));
    assert_eq!(limited.poll_after, None);

    let temporary = lookup_fixture(42, STALE_TEMPORARILY_UNAVAILABLE).await;
    assert_eq!(temporary.opponent.freshness, OpponentFreshness::Stale);
    assert_eq!(
        temporary.opponent.refresh_state,
        RefreshState::TemporarilyUnavailable
    );
    assert_eq!(temporary.opponent.rating, Some(1900));
    assert_eq!(temporary.opponent.retry_after_seconds, Some(30));
    assert_eq!(temporary.poll_after, None);
}

#[test]
fn poll_deadline_stops_refreshing_without_discarding_stale_data() {
    let mut opponent = OpponentData::api_failure(42);
    opponent.freshness = OpponentFreshness::Stale;
    opponent.refresh_state = RefreshState::Refreshing;
    opponent.rating = Some(1900);
    let mut opponents = HashMap::from([(42, opponent)]);
    let pending = HashMap::from([(42, Duration::from_secs(2))]);

    assert!(finish_poll_deadline(&mut opponents, &pending));
    let preserved = opponents.get(&42).expect("stale opponent remains cached");
    assert_eq!(preserved.refresh_state, RefreshState::Idle);
    assert_eq!(preserved.freshness, OpponentFreshness::Stale);
    assert_eq!(preserved.rating, Some(1900));
}

#[tokio::test]
async fn generated_lookup_rejects_malformed_non_utc_and_api_failure_responses() {
    for body in [
        "{ not json".to_string(),
        MEASURED_ZERO.replace("2026-08-09T22:00:00Z", "2026-08-09T22:00:00+00:00"),
    ] {
        let (base_url, server) = serve_once(91_913_839, "200 OK", body);
        assert!(ApiClient::new(base_url)
            .fetch_opponent(91_913_839)
            .await
            .is_err());
        server.join().expect("fixture server completes");
    }

    let (base_url, server) = serve_once(42, "503 Service Unavailable", "{}".to_string());
    assert!(ApiClient::new(base_url).fetch_opponent(42).await.is_err());
    server.join().expect("fixture server completes");

    let (base_url, server) = serve_oversized_headers_once(42);
    let error = ApiClient::new(base_url)
        .fetch_opponent(42)
        .await
        .expect_err("oversized generated response is rejected before reading its body");
    assert_eq!(error, "desktop ranked lookup failed");
    server.join().expect("oversized fixture server completes");
}
