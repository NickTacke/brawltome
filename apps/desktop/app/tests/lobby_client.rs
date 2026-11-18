use std::io::{ErrorKind, Read, Write};
use std::net::TcpListener;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use brawltome_desktop::lobby_client::{
    LobbyAnswer, LobbyClient, LobbyKind, LobbyLookup, LobbyPlayer, LobbyRequest, LookupFailure,
    Standing,
};

const ONE_VS_ONE: &str =
    include_str!("../../../../packages/contracts/tests/fixtures/desktop-v1-lobby-1v1.json");
const TWO_VS_TWO: &str =
    include_str!("../../../../packages/contracts/tests/fixtures/desktop-v1-lobby-2v2.json");
const NO_DATA: &str =
    include_str!("../../../../packages/contracts/tests/fixtures/desktop-v1-lobby-no-data.json");

const APP_VERSION: &str = "0.2.0-beta.1";

/// answers one request and hands back the request text it received
struct Server {
    base_url: String,
    handle: JoinHandle<String>,
}

impl Server {
    fn request_text(self) -> String {
        self.handle.join().expect("fixture server thread")
    }
}

fn read_request(stream: &mut std::net::TcpStream) -> String {
    let mut received = Vec::new();
    let mut chunk = [0_u8; 4096];

    loop {
        let length = stream.read(&mut chunk).expect("read lobby request");
        assert_ne!(length, 0, "client closed before sending a whole request");
        received.extend_from_slice(&chunk[..length]);

        let text = String::from_utf8_lossy(&received).to_string();
        let Some((head, body)) = text.split_once("\r\n\r\n") else {
            continue;
        };
        let expected_length = head
            .lines()
            .find_map(|line| {
                line.to_ascii_lowercase()
                    .strip_prefix("content-length:")
                    .map(str::to_owned)
            })
            .map(|value| value.trim().parse::<usize>().expect("content-length"))
            .unwrap_or(0);
        if body.len() >= expected_length {
            return text;
        }
    }
}

fn serve_once(status_line: &str, extra_headers: &str, body: &str) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind lobby fixture server");
    let base_url = format!("http://{}", listener.local_addr().expect("server address"));
    let response = format!(
        "HTTP/1.1 {status_line}\r\ncontent-type: application/json\r\n{extra_headers}content-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );

    let handle = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept lobby request");
        let request = read_request(&mut stream);
        stream
            .write_all(response.as_bytes())
            .expect("write lobby response");
        request
    });

    Server { base_url, handle }
}

fn client(server: &Server) -> LobbyClient {
    LobbyClient::new(&server.base_url, APP_VERSION).expect("client for a valid version")
}

fn player(brawlhalla_id: u32) -> LobbyPlayer {
    LobbyPlayer {
        brawlhalla_id,
        team: 2,
    }
}

fn one_vs_one_request() -> LobbyRequest {
    LobbyRequest {
        kind: LobbyKind::OneVsOne,
        players: vec![player(91913839)],
    }
}

fn two_vs_two_request() -> LobbyRequest {
    LobbyRequest {
        kind: LobbyKind::TwoVsTwo,
        players: vec![player(91913839), player(40218877)],
    }
}

async fn look_up_with(
    status_line: &str,
    extra_headers: &str,
    body: &str,
    request: LobbyRequest,
) -> Result<LobbyAnswer, LookupFailure> {
    let server = serve_once(status_line, extra_headers, body);
    let result = client(&server).look_up(request).await;
    server.request_text();
    result
}

async fn failure_for(status_line: &str, extra_headers: &str, body: &str) -> LookupFailure {
    look_up_with(status_line, extra_headers, body, one_vs_one_request())
        .await
        .expect_err("a failure status")
}

fn diamond() -> Standing {
    Standing {
        rating: 2112,
        peak_rating: 2240,
        tier: Some("Diamond".to_string()),
        wins: 734,
        games: 1204,
    }
}

#[tokio::test]
async fn posts_the_lobby_with_the_app_version() {
    let server = serve_once("200 OK", "", ONE_VS_ONE);

    client(&server)
        .look_up(one_vs_one_request())
        .await
        .expect("a 1v1 card");

    let request = server.request_text();
    let (head, body) = request.split_once("\r\n\r\n").expect("head and body");
    assert!(head.starts_with("POST /desktop/v1/lobby "));
    assert!(head
        .to_ascii_lowercase()
        .contains("x-desktop-version: 0.2.0-beta.1"));
    assert_eq!(
        body,
        r#"{"matchType":"1v1","players":[{"brawlhallaId":91913839,"team":2}]}"#
    );
}

#[tokio::test]
async fn reads_a_1v1_card() {
    let answer = look_up_with("200 OK", "", ONE_VS_ONE, one_vs_one_request())
        .await
        .expect("a 1v1 card");

    let player = answer.player(91913839).expect("the requested player");
    assert_eq!(player.one_vs_one, Some(diamond()));
    assert_eq!(player.region_rank, Some(48));
    assert!(!player.is_refreshing);
    assert_eq!(answer.teams.len(), 1);
    assert_eq!(answer.teams[0].team, 2);
    assert_eq!(answer.teams[0].team_standing, None);
    assert!(!answer.is_any_player_refreshing());
}

#[tokio::test]
async fn reads_a_2v2_team_card() {
    let answer = look_up_with("200 OK", "", TWO_VS_TWO, two_vs_two_request())
        .await
        .expect("a 2v2 card");

    let team = &answer.teams[0];
    let standing = team.team_standing.as_ref().expect("a team standing");
    assert_eq!(standing.rating, 1975);
    assert_eq!(standing.peak_rating, 2010);
    assert_eq!(standing.tier.as_deref(), Some("Platinum 5"));
    assert_eq!(standing.wins, 88);
    assert_eq!(standing.games, 150);
    assert_eq!(team.players.len(), 2);
    assert_eq!(team.players[1].brawlhalla_id, 40218877);
    assert_eq!(team.players[1].region_rank, None);
}

#[tokio::test]
async fn reads_a_player_we_hold_nothing_on() {
    let request = LobbyRequest {
        kind: LobbyKind::OneVsOne,
        players: vec![player(60417325)],
    };

    let answer = look_up_with("200 OK", "", NO_DATA, request)
        .await
        .expect("a card without data");

    let player = answer.player(60417325).expect("the requested player");
    assert_eq!(player.one_vs_one, None);
    assert!(player.is_refreshing);
    assert!(answer.is_any_player_refreshing());
}

#[tokio::test]
async fn ignores_fields_added_later() {
    let body = ONE_VS_ONE
        .replacen('{', r#"{"addedLater": true,"#, 1)
        .replace(r#""team": 2,"#, r#""team": 2, "addedLater": true,"#)
        .replace(r#""known": true,"#, r#""known": true, "addedLater": true,"#)
        .replace(r#""wins": 734,"#, r#""wins": 734, "addedLater": true,"#);
    assert_eq!(body.matches("addedLater").count(), 4);

    let answer = look_up_with("200 OK", "", &body, one_vs_one_request()).await;

    assert!(answer.is_ok());
}

#[tokio::test]
async fn an_old_app_is_told_the_minimum_version() {
    let failure = failure_for("426 Upgrade Required", "", r#"{"minimumVersion":"0.2.0"}"#).await;

    assert_eq!(
        failure,
        LookupFailure::UpdateRequired {
            minimum_version: "0.2.0".to_string()
        }
    );
}

#[tokio::test]
async fn a_limit_carries_its_wait() {
    let failure = failure_for("429 Too Many Requests", "retry-after: 60\r\n", "{}").await;

    assert_eq!(
        failure,
        LookupFailure::RateLimited {
            retry_after_seconds: Some(60)
        }
    );
}

#[tokio::test]
async fn a_wait_that_is_not_whole_seconds_is_left_out() {
    let failure = failure_for(
        "429 Too Many Requests",
        "retry-after: Wed, 21 Oct 2026 07:28:00 GMT\r\n",
        "{}",
    )
    .await;

    assert_eq!(
        failure,
        LookupFailure::RateLimited {
            retry_after_seconds: None
        }
    );
}

#[tokio::test]
async fn a_wait_of_zero_is_one_second() {
    let failure = failure_for("429 Too Many Requests", "retry-after: 0\r\n", "{}").await;

    assert_eq!(
        failure,
        LookupFailure::RateLimited {
            retry_after_seconds: Some(1)
        }
    );
}

#[tokio::test]
async fn a_signed_wait_is_left_out() {
    let failure = failure_for("429 Too Many Requests", "retry-after: +60\r\n", "{}").await;

    assert_eq!(
        failure,
        LookupFailure::RateLimited {
            retry_after_seconds: None
        }
    );
}

#[tokio::test]
async fn a_huge_wait_is_capped_at_five_minutes() {
    let big = failure_for("503 Service Unavailable", "retry-after: 86400\r\n", "{}").await;
    let beyond_u64 = failure_for(
        "429 Too Many Requests",
        "retry-after: 99999999999999999999999999\r\n",
        "{}",
    )
    .await;

    assert_eq!(
        big,
        LookupFailure::Unavailable {
            retry_after_seconds: Some(300)
        }
    );
    assert_eq!(
        beyond_u64,
        LookupFailure::RateLimited {
            retry_after_seconds: Some(300)
        }
    );
}

#[tokio::test]
async fn a_busy_server_carries_its_wait() {
    let busy = failure_for(
        "503 Service Unavailable",
        "retry-after: 5\r\n",
        r#"{"error":"temporarily_unavailable"}"#,
    )
    .await;
    let broken = failure_for("500 Internal Server Error", "", "{}").await;

    assert_eq!(
        busy,
        LookupFailure::Unavailable {
            retry_after_seconds: Some(5)
        }
    );
    assert_eq!(
        broken,
        LookupFailure::Unavailable {
            retry_after_seconds: None
        }
    );
}

#[tokio::test]
async fn a_refused_request_is_not_retried_as_a_server_fault() {
    let invalid_request =
        failure_for("400 Bad Request", "", r#"{"error":"invalid_request"}"#).await;
    let other_client_error = failure_for("404 Not Found", "", "{}").await;

    assert_eq!(invalid_request, LookupFailure::Rejected);
    assert_eq!(other_client_error, LookupFailure::Rejected);
}

#[tokio::test]
async fn no_server_is_offline() {
    let closed_port_url = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        format!("http://{}", listener.local_addr().expect("address"))
    };
    let client = LobbyClient::new(&closed_port_url, APP_VERSION).expect("client");

    let failure = client.look_up(one_vs_one_request()).await;

    assert_eq!(failure, Err(LookupFailure::Offline));
}

#[tokio::test]
async fn a_server_that_never_answers_is_offline_within_five_seconds() {
    // the connection is accepted by the kernel, but nothing ever replies
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let base_url = format!("http://{}", listener.local_addr().expect("address"));
    let client = LobbyClient::new(&base_url, APP_VERSION).expect("client");
    let started = Instant::now();

    let failure = client.look_up(one_vs_one_request()).await;

    assert_eq!(failure, Err(LookupFailure::Offline));
    assert!(started.elapsed() < Duration::from_secs(5));
    drop(listener);
}

#[tokio::test]
async fn an_answer_that_is_not_a_lobby_is_invalid() {
    let failure = look_up_with("200 OK", "", "<html>", one_vs_one_request()).await;

    assert_eq!(failure, Err(LookupFailure::InvalidAnswer));
}

#[tokio::test]
async fn an_answer_missing_a_requested_player_is_invalid() {
    let request = LobbyRequest {
        kind: LobbyKind::TwoVsTwo,
        players: vec![player(91913839), player(91913840)],
    };

    let failure = look_up_with("200 OK", "", ONE_VS_ONE, request).await;

    assert_eq!(failure, Err(LookupFailure::InvalidAnswer));
}

#[tokio::test]
async fn an_id_the_contract_refuses_sends_nothing() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    listener.set_nonblocking(true).expect("nonblocking");
    let base_url = format!("http://{}", listener.local_addr().expect("address"));
    let client = LobbyClient::new(&base_url, APP_VERSION).expect("client");

    for refused_id in [0, 3_000_000_000] {
        let request = LobbyRequest {
            kind: LobbyKind::OneVsOne,
            players: vec![player(refused_id)],
        };

        let failure = client.look_up(request).await;

        assert_eq!(failure, Err(LookupFailure::Rejected));
    }

    let connection = listener.accept();
    assert!(matches!(connection, Err(error) if error.kind() == ErrorKind::WouldBlock));
}

#[test]
fn refuses_to_start_on_a_version_the_api_would_refuse() {
    let result = LobbyClient::new("http://127.0.0.1:1", "0.2");

    assert_eq!(
        result.err().as_deref(),
        Some("desktop version 0.2: not a version the api accepts")
    );
}
