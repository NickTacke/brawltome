use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use brawltome_desktop::app_status::GameStatus;
use brawltome_desktop::lobby_client::{
    LobbyAnswer, LobbyLookup, LobbyRequest, LookupFailure, PlayerAnswer, Standing, TeamAnswer,
};
use brawltome_desktop::overlay_view::{Card, CardData, OverlayView};
use brawltome_desktop::session::Input;
use brawltome_desktop::session_runner::{self, LinkOpener, OverlaySurface, SessionHandle};
use brawltome_detection::{Event, MatchSnapshot, MatchType, Player};
use tokio::sync::mpsc;
use tokio::time::Instant;

const SHINIGAMI: u32 = 91_913_839;
const TIDECALLER: u32 = 50_427_113;

fn player(brawlhalla_id: u32, name: &str, team: u32, is_local: bool) -> Player {
    Player {
        brawlhalla_id,
        name: name.to_string(),
        team,
        legend: Some("Hattori".to_string()),
        is_local,
        personal_rating_2v2: None,
    }
}

fn ranked_1v1_against(brawlhalla_id: u32) -> Event {
    Event::MatchStarted(MatchSnapshot {
        match_type: MatchType::Ranked1v1,
        players: vec![
            player(1, "me", 1, true),
            player(brawlhalla_id, "opponent", 2, false),
        ],
    })
}

fn answer_for(brawlhalla_id: u32, is_refreshing: bool) -> LobbyAnswer {
    let standing = Standing {
        rating: 2130,
        peak_rating: 2204,
        tier: Some("Diamond".to_string()),
        wins: 734,
        games: 1204,
    };
    let player = PlayerAnswer {
        brawlhalla_id,
        one_vs_one: Some(standing),
        region_rank: Some(48),
        is_refreshing,
    };

    LobbyAnswer {
        teams: vec![TeamAnswer {
            team: 2,
            team_standing: None,
            players: vec![player],
        }],
    }
}

fn unavailable() -> Result<LobbyAnswer, LookupFailure> {
    Err(LookupFailure::Unavailable {
        retry_after_seconds: None,
    })
}

/// milliseconds since the test started, on tokio's paused clock
#[derive(Clone)]
struct TestClock(Instant);

impl TestClock {
    fn start() -> Self {
        Self(Instant::now())
    }

    fn now_ms(&self) -> u64 {
        self.0.elapsed().as_millis() as u64
    }
}

/// a scripted answer: how long the lookup takes, then what it gives
struct Scripted {
    delay_ms: u64,
    result: Result<LobbyAnswer, LookupFailure>,
}

/// pops one scripted answer per call; records when each call started and finished
struct FakeLookup {
    clock: TestClock,
    answers: Mutex<VecDeque<Scripted>>,
    started_at_ms: Mutex<Vec<u64>>,
    finished_count: Mutex<usize>,
}

impl FakeLookup {
    fn new(clock: &TestClock, answers: Vec<Scripted>) -> Arc<Self> {
        Arc::new(Self {
            clock: clock.clone(),
            answers: Mutex::new(answers.into()),
            started_at_ms: Mutex::new(Vec::new()),
            finished_count: Mutex::new(0),
        })
    }

    fn calls_at_ms(&self) -> Vec<u64> {
        self.started_at_ms.lock().unwrap().clone()
    }

    fn finished_count(&self) -> usize {
        *self.finished_count.lock().unwrap()
    }
}

impl LobbyLookup for FakeLookup {
    async fn look_up(&self, _request: LobbyRequest) -> Result<LobbyAnswer, LookupFailure> {
        self.started_at_ms.lock().unwrap().push(self.clock.now_ms());
        let scripted = self.answers.lock().unwrap().pop_front();
        let Some(scripted) = scripted else {
            panic!("the lookup was asked more often than the test scripted");
        };

        tokio::time::sleep(Duration::from_millis(scripted.delay_ms)).await;
        *self.finished_count.lock().unwrap() += 1;

        scripted.result
    }
}

#[derive(Debug, Clone, PartialEq)]
enum SurfaceCall {
    Show(OverlayView),
    Hide,
}

/// remembers every show and hide, and when it happened
struct RecordingSurface {
    clock: TestClock,
    calls: Mutex<Vec<(u64, SurfaceCall)>>,
}

impl RecordingSurface {
    fn new(clock: &TestClock) -> Arc<Self> {
        Arc::new(Self {
            clock: clock.clone(),
            calls: Mutex::new(Vec::new()),
        })
    }

    fn calls(&self) -> Vec<(u64, SurfaceCall)> {
        self.calls.lock().unwrap().clone()
    }

    fn record(&self, call: SurfaceCall) {
        let now_ms = self.clock.now_ms();
        self.calls.lock().unwrap().push((now_ms, call));
    }
}

impl OverlaySurface for RecordingSurface {
    fn show(&self, view: &OverlayView) {
        self.record(SurfaceCall::Show(view.clone()));
    }

    fn hide(&self) {
        self.record(SurfaceCall::Hide);
    }
}

#[derive(Default)]
struct RecordingOpener {
    urls: Mutex<Vec<String>>,
}

impl RecordingOpener {
    fn urls(&self) -> Vec<String> {
        self.urls.lock().unwrap().clone()
    }
}

impl LinkOpener for RecordingOpener {
    fn open(&self, url: &str) {
        self.urls.lock().unwrap().push(url.to_string());
    }
}

/// the runner and everything it was handed, as the tests drive and read it
struct Harness {
    clock: TestClock,
    events: mpsc::Sender<Event>,
    lookup: Arc<FakeLookup>,
    surface: Arc<RecordingSurface>,
    opener: Arc<RecordingOpener>,
    handle: SessionHandle,
}

impl Harness {
    fn start(answers: Vec<Scripted>) -> Self {
        let clock = TestClock::start();
        let (events, receiver) = mpsc::channel(16);
        let lookup = FakeLookup::new(&clock, answers);
        let surface = RecordingSurface::new(&clock);
        let opener = Arc::new(RecordingOpener::default());

        let handle = session_runner::spawn(
            receiver,
            Arc::clone(&lookup),
            Arc::clone(&surface) as Arc<dyn OverlaySurface>,
            Arc::clone(&opener) as Arc<dyn LinkOpener>,
        );

        Self {
            clock,
            events,
            lookup,
            surface,
            opener,
            handle,
        }
    }

    async fn detect(&self, event: Event) {
        self.events.send(event).await.expect("the runner listens");
        settle().await;
    }

    fn shown_views(&self) -> Vec<OverlayView> {
        self.surface
            .calls()
            .into_iter()
            .filter_map(|(_, call)| match call {
                SurfaceCall::Show(view) => Some(view),
                SurfaceCall::Hide => None,
            })
            .collect()
    }
}

/// lets the runner handle everything that is ready, without moving the clock
async fn settle() {
    for _ in 0..10 {
        tokio::task::yield_now().await;
    }
}

async fn wait_ms(duration_ms: u64) {
    tokio::time::sleep(Duration::from_millis(duration_ms)).await;
    settle().await;
}

fn solo_data(view: &OverlayView) -> &CardData {
    match view.cards.as_slice() {
        [Card::Solo { data, .. }] => data,
        cards => panic!("expected one solo card, got {cards:?}"),
    }
}

fn is_ranked_card_of(view: &OverlayView, brawlhalla_id: u32) -> bool {
    view.cards.iter().any(|card| match card {
        Card::Solo { player, data } => {
            player.brawlhalla_id == brawlhalla_id && matches!(data, CardData::Ranked { .. })
        }
        Card::Team { .. } => false,
    })
}

#[tokio::test(start_paused = true)]
async fn a_ranked_lobby_shows_loading_then_the_answer_then_hides_after_twelve_seconds() {
    let harness = Harness::start(vec![Scripted {
        delay_ms: 300,
        result: Ok(answer_for(SHINIGAMI, false)),
    }]);

    harness.detect(ranked_1v1_against(SHINIGAMI)).await;
    wait_ms(1_000).await;
    let view_while_up = harness.handle.overlay_view();
    wait_ms(20_000).await;

    let calls = harness.surface.calls();
    assert_eq!(calls.len(), 3, "{calls:?}");
    let (_, SurfaceCall::Show(loading)) = &calls[0] else {
        panic!("first call shows the cards: {calls:?}");
    };
    let (_, SurfaceCall::Show(ranked)) = &calls[1] else {
        panic!("second call shows the answer: {calls:?}");
    };
    assert_eq!(solo_data(loading), &CardData::Loading);
    assert!(is_ranked_card_of(ranked, SHINIGAMI), "{ranked:?}");
    assert_eq!(calls[2], (12_000, SurfaceCall::Hide));
    assert_eq!(view_while_up.as_ref(), Some(ranked));
    assert_eq!(harness.handle.overlay_view(), None);
    assert_eq!(harness.lookup.calls_at_ms(), vec![0]);
}

#[tokio::test(start_paused = true)]
async fn a_refreshing_answer_is_asked_for_again_three_seconds_later() {
    let harness = Harness::start(vec![
        Scripted {
            delay_ms: 0,
            result: Ok(answer_for(SHINIGAMI, true)),
        },
        Scripted {
            delay_ms: 0,
            result: Ok(answer_for(SHINIGAMI, false)),
        },
    ]);

    harness.detect(ranked_1v1_against(SHINIGAMI)).await;
    wait_ms(20_000).await;

    assert_eq!(harness.lookup.calls_at_ms(), vec![0, 3_000]);
}

#[tokio::test(start_paused = true)]
async fn a_failing_server_is_retried_at_one_two_and_four_seconds_and_no_more() {
    let failures = (0..4)
        .map(|_| Scripted {
            delay_ms: 0,
            result: unavailable(),
        })
        .collect();
    let harness = Harness::start(failures);

    harness.detect(ranked_1v1_against(SHINIGAMI)).await;
    wait_ms(60_000).await;

    assert_eq!(harness.lookup.calls_at_ms(), vec![0, 1_000, 3_000, 7_000]);
}

#[tokio::test(start_paused = true)]
async fn no_lookup_starts_after_the_cards_hide() {
    let harness = Harness::start(vec![Scripted {
        delay_ms: 11_500,
        result: unavailable(),
    }]);

    harness.detect(ranked_1v1_against(SHINIGAMI)).await;
    wait_ms(60_000).await;

    assert_eq!(harness.lookup.calls_at_ms(), vec![0]);
    let last_call = harness.surface.calls().pop();
    assert_eq!(last_call, Some((12_000, SurfaceCall::Hide)));
}

#[tokio::test(start_paused = true)]
async fn a_new_preview_drops_the_slow_lookup_of_the_old_one() {
    let harness = Harness::start(vec![
        Scripted {
            delay_ms: 5_000,
            result: Ok(answer_for(SHINIGAMI, false)),
        },
        Scripted {
            delay_ms: 0,
            result: Ok(answer_for(TIDECALLER, false)),
        },
    ]);

    harness.detect(ranked_1v1_against(SHINIGAMI)).await;
    wait_ms(1_000).await;
    harness.detect(ranked_1v1_against(TIDECALLER)).await;
    wait_ms(20_000).await;

    let views = harness.shown_views();
    assert!(
        !views.iter().any(|view| is_ranked_card_of(view, SHINIGAMI)),
        "{views:?}"
    );
    assert!(views.iter().any(|view| is_ranked_card_of(view, TIDECALLER)));
    assert_eq!(harness.lookup.calls_at_ms(), vec![0, 1_000]);
    assert_eq!(harness.lookup.finished_count(), 1, "the slow lookup ran on");
}

#[tokio::test(start_paused = true)]
async fn a_profile_clicked_during_loading_opens_at_once() {
    let harness = Harness::start(vec![Scripted {
        delay_ms: 0,
        result: Ok(answer_for(SHINIGAMI, false)),
    }]);

    harness.detect(ranked_1v1_against(SHINIGAMI)).await;
    harness.handle.send(Input::ProfileClicked {
        brawlhalla_id: SHINIGAMI,
    });
    wait_ms(10).await;
    let urls_while_loading = harness.opener.urls();
    harness.detect(Event::MatchEnded).await;

    assert_eq!(
        urls_while_loading,
        vec![format!("https://brawltome.app/player/{SHINIGAMI}")]
    );
    assert_eq!(harness.opener.urls(), urls_while_loading);
}

#[tokio::test(start_paused = true)]
async fn the_status_follows_the_game() {
    let harness = Harness::start(Vec::new());
    let status = harness.handle.status();

    harness.detect(Event::GameFound { process_id: 42 }).await;
    let game_while_running = status.borrow().game.clone();
    harness.detect(Event::GameClosed).await;

    assert_eq!(
        game_while_running,
        GameStatus::Running { game_version: None }
    );
    assert_eq!(status.borrow().game, GameStatus::NotRunning);
}

fn epoch_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[tokio::test(start_paused = true)]
async fn recent_matches_are_dated_by_how_long_ago_they_started() {
    let harness = Harness::start(vec![Scripted {
        delay_ms: 0,
        result: Ok(answer_for(SHINIGAMI, false)),
    }]);

    wait_ms(5_000).await;
    harness.detect(ranked_1v1_against(SHINIGAMI)).await;
    let first_age_ms = epoch_now_ms()
        .saturating_sub(harness.handle.status().borrow().recent_matches[0].started_at_ms);
    wait_ms(15_000).await;
    harness.detect(Event::MatchEnded).await;
    let later_age_ms = epoch_now_ms()
        .saturating_sub(harness.handle.status().borrow().recent_matches[0].started_at_ms);

    // the wall clock barely moves while tokio's is paused, so the age is the session's 15 s
    assert!(
        first_age_ms < 1_000,
        "started {first_age_ms} ms ago at first"
    );
    assert!(
        (15_000..16_000).contains(&later_age_ms),
        "started {later_age_ms} ms ago after the match"
    );
}

#[tokio::test(start_paused = true)]
async fn the_runner_ends_when_detection_stops() {
    let harness = Harness::start(Vec::new());
    let mut status = harness.handle.status();
    let clock = harness.clock.clone();

    drop(harness.events);
    let has_ended = tokio::time::timeout(Duration::from_secs(1), status.changed()).await;

    assert!(
        matches!(has_ended, Ok(Err(_))),
        "the runner still runs at {} ms",
        clock.now_ms()
    );
}
