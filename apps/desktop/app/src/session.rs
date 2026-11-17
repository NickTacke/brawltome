//! decides what the overlay shows for each event, answer and timer; it runs nothing itself

use brawltome_detection::{Event, MatchSnapshot};

use crate::app_status::{
    unsupported_message, AppStatus, DetectionStatus, GameStatus, RecentMatch, ServiceStatus,
    UpdateStatus,
};
use crate::lobby_client::{LobbyAnswer, LobbyPlayer, LobbyRequest, LookupFailure};
use crate::overlay_view::{
    answered_view, failed_view, failure_reason, loading_view, Card, CardData, Failure,
    FailureReason, LobbyOpponents, OverlayView, TeamData,
};

pub const CARDS_VISIBLE_MS: u64 = 12_000;
pub const REFRESH_REASK_DELAY_MS: u64 = 3_000;
pub const RETRY_DELAYS_MS: [u64; 3] = [1_000, 2_000, 4_000];
pub const MAX_RECENT_MATCHES: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Timer {
    HideCards,
    LookUp,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Input {
    Detection(Event),
    LookupFinished {
        lobby_id: u64,
        result: Result<LobbyAnswer, LookupFailure>,
    },
    TimerFired {
        lobby_id: u64,
        timer: Timer,
    },
    RetryClicked,
    ProfileClicked {
        brawlhalla_id: u32,
    },
    OverlayPaused(bool),
    UpdateStatusChanged(UpdateStatus),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    /// abort every lookup and timer started for an earlier lobby
    DropLobbyWork,
    LookUp {
        lobby_id: u64,
        request: LobbyRequest,
    },
    StartTimer {
        lobby_id: u64,
        timer: Timer,
        after_ms: u64,
    },
    ShowCards(OverlayView),
    HideCards,
    OpenLinks(Vec<String>),
    StatusChanged(AppStatus),
}

#[derive(Debug, Default)]
pub struct Session {
    status: AppStatus,
    phase: Phase,
    last_lobby_id: u64,
}

#[derive(Debug, Default)]
enum Phase {
    #[default]
    Menus,
    /// from the preview until the cards hide
    Loading(Lobby),
    InMatch,
}

/// a lobby whose cards are up, and where its lookup stands
#[derive(Debug)]
struct Lobby {
    lobby_id: u64,
    opponents: LobbyOpponents,
    hides_at_ms: u64,
    lookup: LookupState,
    retry_count: usize,
    has_reasked_for_refresh: bool,
    answer: Option<LobbyAnswer>,
    view: OverlayView,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LookupState {
    Idle,
    Asking,
    WaitingUntil { due_at_ms: u64 },
}

impl Session {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn handle(&mut self, input: Input, now_ms: u64) -> Vec<Effect> {
        let status_before = self.status.clone();

        let mut effects = match input {
            Input::Detection(event) => self.on_detection(event, now_ms),
            Input::LookupFinished { lobby_id, result } => {
                self.on_lookup_finished(lobby_id, result, now_ms)
            }
            Input::TimerFired { lobby_id, timer } => self.on_timer_fired(lobby_id, timer, now_ms),
            Input::RetryClicked => self.on_retry_clicked(),
            Input::ProfileClicked { brawlhalla_id } => self.on_profile_clicked(brawlhalla_id),
            Input::OverlayPaused(is_paused) => self.on_overlay_paused(is_paused),
            Input::UpdateStatusChanged(update) => {
                self.status.update = update;
                Vec::new()
            }
        };

        self.status.is_match_running = matches!(self.phase, Phase::InMatch);
        if self.status != status_before {
            effects.push(Effect::StatusChanged(self.status.clone()));
        }

        effects
    }

    pub fn status(&self) -> &AppStatus {
        &self.status
    }

    pub fn overlay_view(&self) -> Option<&OverlayView> {
        match &self.phase {
            Phase::Loading(lobby) => Some(&lobby.view),
            _ => None,
        }
    }

    fn on_detection(&mut self, event: Event, now_ms: u64) -> Vec<Effect> {
        match event {
            Event::GameFound { .. } => self.report_game(None, DetectionStatus::Starting),
            Event::Ready { game_version, .. } => {
                self.report_game(Some(game_version), DetectionStatus::Ready)
            }
            Event::Unsupported { game_version, .. } => {
                let message = unsupported_message(game_version.as_deref());
                self.report_game(game_version, DetectionStatus::Unsupported { message })
            }
            Event::MatchStarted(snapshot) => self.on_match_started(&snapshot, now_ms),
            Event::Queueing => self.change_phase(Phase::Menus),
            Event::MatchEnded | Event::MatchSkipped { .. } => self.leave_match(),
            Event::GameClosed => {
                self.status.game = GameStatus::NotRunning;
                self.status.detection = DetectionStatus::Waiting;
                self.leave_match()
            }
        }
    }

    fn report_game(
        &mut self,
        game_version: Option<String>,
        detection: DetectionStatus,
    ) -> Vec<Effect> {
        self.status.game = GameStatus::Running { game_version };
        self.status.detection = detection;

        Vec::new()
    }

    fn on_match_started(&mut self, snapshot: &MatchSnapshot, now_ms: u64) -> Vec<Effect> {
        let was_loading = matches!(self.phase, Phase::Loading(_));
        let opponents = LobbyOpponents::read(snapshot).filter(|_| !self.status.is_overlay_paused);

        let Some(opponents) = opponents else {
            // the earlier preview never became a match, and this one isn't shown
            if was_loading {
                self.forget_newest_match();
            }
            // nothing to show, but the game is in a match from here on
            return self.change_phase(Phase::InMatch);
        };

        self.remember_match(&opponents, was_loading, now_ms);
        self.show_lobby(opponents, now_ms)
    }

    fn show_lobby(&mut self, opponents: LobbyOpponents, now_ms: u64) -> Vec<Effect> {
        self.last_lobby_id += 1;
        let lobby_id = self.last_lobby_id;
        let is_update_required =
            matches!(self.status.service, ServiceStatus::UpdateRequired { .. });

        let view = if is_update_required {
            failed_view(
                lobby_id,
                CARDS_VISIBLE_MS,
                &opponents,
                update_required_failure(),
            )
        } else {
            loading_view(lobby_id, CARDS_VISIBLE_MS, &opponents)
        };
        let mut lobby = Lobby {
            lobby_id,
            opponents,
            hides_at_ms: now_ms + CARDS_VISIBLE_MS,
            lookup: LookupState::Idle,
            retry_count: 0,
            has_reasked_for_refresh: false,
            answer: None,
            view,
        };
        let lookup = (!is_update_required).then(|| lobby.ask());
        // the previous lobby's work is dropped below, so it can be replaced here
        self.phase = Phase::Loading(lobby);

        let mut effects = vec![Effect::DropLobbyWork];
        effects.extend(self.show_lobby_view());
        effects.extend(lookup);
        effects.push(Effect::StartTimer {
            lobby_id,
            timer: Timer::HideCards,
            after_ms: CARDS_VISIBLE_MS,
        });

        effects
    }

    fn on_lookup_finished(
        &mut self,
        lobby_id: u64,
        result: Result<LobbyAnswer, LookupFailure>,
        now_ms: u64,
    ) -> Vec<Effect> {
        let Some(lobby) = self.loading_lobby(lobby_id) else {
            return Vec::new();
        };
        if lobby.lookup != LookupState::Asking {
            return Vec::new();
        }

        lobby.lookup = LookupState::Idle;
        self.note_service(&result);

        match result {
            Ok(answer) => self.on_answer(answer, now_ms),
            Err(failure) => self.on_failure(&failure, now_ms),
        }
    }

    fn on_answer(&mut self, answer: LobbyAnswer, now_ms: u64) -> Vec<Effect> {
        let Phase::Loading(lobby) = &mut self.phase else {
            return Vec::new();
        };

        let is_refresh_pending = answer.is_any_player_refreshing()
            && !lobby.has_reasked_for_refresh
            && lobby.fires_before_hide(now_ms, REFRESH_REASK_DELAY_MS);
        let Some(view) = answered_view(
            lobby.lobby_id,
            CARDS_VISIBLE_MS,
            &lobby.opponents,
            &answer,
            is_refresh_pending,
        ) else {
            return self.on_failure(&LookupFailure::InvalidAnswer, now_ms);
        };

        lobby.view = view;
        lobby.answer = Some(answer);
        lobby.has_reasked_for_refresh |= is_refresh_pending;
        let reask = is_refresh_pending.then(|| lobby.wait_then_ask(now_ms, REFRESH_REASK_DELAY_MS));

        let mut effects = self.show_lobby_view();
        effects.extend(reask);

        effects
    }

    fn on_failure(&mut self, failure: &LookupFailure, now_ms: u64) -> Vec<Effect> {
        let Phase::Loading(lobby) = &mut self.phase else {
            return Vec::new();
        };

        if let Some(answer) = &lobby.answer {
            // only the refresh failed: the first answer is still worth showing
            if let Some(view) = answered_view(
                lobby.lobby_id,
                CARDS_VISIBLE_MS,
                &lobby.opponents,
                answer,
                false,
            ) {
                lobby.view = view;
            }
            return self.show_lobby_view();
        }

        let retry_after_ms = retry_delay_ms(failure, lobby.retry_count)
            .filter(|after_ms| lobby.fires_before_hide(now_ms, *after_ms));
        let card_failure = Failure {
            reason: failure_reason(failure),
            retry_in_seconds: retry_after_ms.map(whole_seconds_rounded_up),
            can_retry: can_pass(failure),
        };
        lobby.view = failed_view(
            lobby.lobby_id,
            CARDS_VISIBLE_MS,
            &lobby.opponents,
            card_failure,
        );
        lobby.retry_count += 1;
        let retry = retry_after_ms.map(|after_ms| lobby.wait_then_ask(now_ms, after_ms));

        let mut effects = self.show_lobby_view();
        effects.extend(retry);

        effects
    }

    fn on_timer_fired(&mut self, lobby_id: u64, timer: Timer, now_ms: u64) -> Vec<Effect> {
        let Some(lobby) = self.loading_lobby(lobby_id) else {
            return Vec::new();
        };

        match timer {
            Timer::HideCards => self.change_phase(Phase::InMatch),
            Timer::LookUp => lobby.ask_when_due(now_ms).into_iter().collect(),
        }
    }

    fn on_retry_clicked(&mut self) -> Vec<Effect> {
        let Phase::Loading(lobby) = &mut self.phase else {
            return Vec::new();
        };

        let is_retry_offered = lobby.view.cards.iter().any(offers_retry);
        if !is_retry_offered || lobby.lookup == LookupState::Asking {
            return Vec::new();
        }

        vec![lobby.ask()]
    }

    fn on_profile_clicked(&mut self, brawlhalla_id: u32) -> Vec<Effect> {
        if !self.is_shown_player(brawlhalla_id) {
            return Vec::new();
        }

        // the cards are already down, so this click raced the hide; a browser now would cost the player the match
        if matches!(self.phase, Phase::InMatch) {
            return Vec::new();
        }

        // players want the profile during the loading screen, even though the browser takes focus from the game
        vec![Effect::OpenLinks(vec![profile_url(brawlhalla_id)])]
    }

    fn on_overlay_paused(&mut self, is_paused: bool) -> Vec<Effect> {
        self.status.is_overlay_paused = is_paused;

        let is_loading = matches!(self.phase, Phase::Loading(_));
        if !is_paused || !is_loading {
            return Vec::new();
        }

        self.change_phase(Phase::InMatch)
    }

    /// moving on from a lobby takes its cards down and drops its work
    fn change_phase(&mut self, next_phase: Phase) -> Vec<Effect> {
        let previous_phase = std::mem::replace(&mut self.phase, next_phase);

        match previous_phase {
            Phase::Loading(_) => vec![Effect::HideCards, Effect::DropLobbyWork],
            _ => Vec::new(),
        }
    }

    fn leave_match(&mut self) -> Vec<Effect> {
        self.change_phase(Phase::Menus)
    }

    fn loading_lobby(&mut self, lobby_id: u64) -> Option<&mut Lobby> {
        match &mut self.phase {
            Phase::Loading(lobby) if lobby.lobby_id == lobby_id => Some(lobby),
            _ => None,
        }
    }

    /// shows the loading lobby's view
    fn show_lobby_view(&self) -> Vec<Effect> {
        let Phase::Loading(lobby) = &self.phase else {
            return Vec::new();
        };

        vec![Effect::ShowCards(lobby.view.clone())]
    }

    fn is_shown_player(&self, brawlhalla_id: u32) -> bool {
        let is_on_the_cards = match &self.phase {
            Phase::Loading(lobby) => lobby
                .opponents
                .players()
                .iter()
                .any(|player| player.brawlhalla_id == brawlhalla_id),
            _ => false,
        };
        let is_in_recent_matches = self
            .status
            .recent_matches
            .iter()
            .flat_map(|recent_match| &recent_match.opponents)
            .any(|opponent| opponent.brawlhalla_id == brawlhalla_id);

        is_on_the_cards || is_in_recent_matches
    }

    fn remember_match(&mut self, opponents: &LobbyOpponents, was_loading: bool, now_ms: u64) {
        // a preview that changed while its cards were up is still the same match
        if was_loading {
            self.forget_newest_match();
        }

        let recent_match = RecentMatch {
            started_at_ms: now_ms,
            opponents: opponents.heads(),
            is_win: None,
            rating_change: None,
        };
        let recent_matches = &mut self.status.recent_matches;
        recent_matches.insert(0, recent_match);
        recent_matches.truncate(MAX_RECENT_MATCHES);
    }

    fn forget_newest_match(&mut self) {
        if !self.status.recent_matches.is_empty() {
            self.status.recent_matches.remove(0);
        }
    }

    fn note_service(&mut self, result: &Result<LobbyAnswer, LookupFailure>) {
        self.status.service = match result {
            Ok(_) => ServiceStatus::Ok,
            Err(LookupFailure::Offline) => ServiceStatus::Offline,
            Err(LookupFailure::Unavailable { .. }) => ServiceStatus::Unavailable,
            Err(LookupFailure::UpdateRequired { minimum_version }) => {
                ServiceStatus::UpdateRequired {
                    minimum_version: minimum_version.clone(),
                }
            }
            // a limited or refused lookup says nothing new about the service
            Err(_) => return,
        };
    }
}

impl Lobby {
    fn ask(&mut self) -> Effect {
        self.lookup = LookupState::Asking;

        Effect::LookUp {
            lobby_id: self.lobby_id,
            request: request_for(&self.opponents),
        }
    }

    fn wait_then_ask(&mut self, now_ms: u64, after_ms: u64) -> Effect {
        self.lookup = LookupState::WaitingUntil {
            due_at_ms: now_ms + after_ms,
        };

        Effect::StartTimer {
            lobby_id: self.lobby_id,
            timer: Timer::LookUp,
            after_ms,
        }
    }

    /// a retry clicked meanwhile has asked already, so its timer must not ask again early
    fn ask_when_due(&mut self, now_ms: u64) -> Option<Effect> {
        let LookupState::WaitingUntil { due_at_ms } = self.lookup else {
            return None;
        };
        if now_ms < due_at_ms {
            return None;
        }

        Some(self.ask())
    }

    /// nothing is asked once the cards are down and the match runs
    fn fires_before_hide(&self, now_ms: u64, after_ms: u64) -> bool {
        now_ms + after_ms < self.hides_at_ms
    }
}

pub fn profile_url(brawlhalla_id: u32) -> String {
    format!("https://brawltome.app/player/{brawlhalla_id}")
}

fn request_for(opponents: &LobbyOpponents) -> LobbyRequest {
    let players = opponents
        .players()
        .iter()
        .map(|player| LobbyPlayer {
            brawlhalla_id: player.brawlhalla_id,
            team: player.team,
        })
        .collect();

    LobbyRequest {
        kind: opponents.kind(),
        players,
    }
}

/// failures that can pass on their own are worth asking again for
fn can_pass(failure: &LookupFailure) -> bool {
    !matches!(
        failure,
        LookupFailure::Rejected | LookupFailure::UpdateRequired { .. }
    )
}

fn retry_delay_ms(failure: &LookupFailure, retry_count: usize) -> Option<u64> {
    if !can_pass(failure) {
        return None;
    }

    let backoff_ms = RETRY_DELAYS_MS.get(retry_count).copied()?;
    let server_wait_seconds = match failure {
        LookupFailure::RateLimited {
            retry_after_seconds,
        }
        | LookupFailure::Unavailable {
            retry_after_seconds,
        } => *retry_after_seconds,
        _ => None,
    };

    Some(server_wait_seconds.map_or(backoff_ms, |seconds| u64::from(seconds) * 1_000))
}

fn whole_seconds_rounded_up(duration_ms: u64) -> u32 {
    u32::try_from(duration_ms.div_ceil(1_000)).unwrap_or(u32::MAX)
}

fn update_required_failure() -> Failure {
    Failure {
        reason: FailureReason::UpdateRequired,
        retry_in_seconds: None,
        can_retry: false,
    }
}

fn offers_retry(card: &Card) -> bool {
    let failure = match card {
        Card::Solo {
            data: CardData::Failed(failure),
            ..
        } => failure,
        Card::Team {
            data: TeamData::Failed(failure),
            ..
        } => failure,
        _ => return false,
    };

    failure.can_retry
}

#[cfg(test)]
mod tests {
    use brawltome_detection::{MatchSnapshot, MatchType, Player, SkipReason, UnsupportedReason};
    use serde_json::Value;

    use super::*;
    use crate::app_status::{DetectionStatus, GameStatus, ServiceStatus};
    use crate::lobby_client::{LobbyKind, LobbyPlayer, PlayerAnswer, Standing, TeamAnswer};
    use crate::overlay_view::{Card, CardData, Failure, FailureReason, PlayerHead, TeamData};

    const SHINIGAMI: u32 = 91_913_839;
    const TIDECALLER: u32 = 50_427_113;
    const KOA: u32 = 91_913_850;
    const RIMELIGHT: u32 = 91_913_851;

    fn player(brawlhalla_id: u32, name: &str, team: u32, legend: &str) -> Player {
        Player {
            brawlhalla_id,
            name: name.to_string(),
            team,
            legend: Some(legend.to_string()),
            is_local: false,
            personal_rating_2v2: None,
        }
    }

    fn local_player() -> Player {
        Player {
            is_local: true,
            ..player(1, "me", 1, "Bodvar")
        }
    }

    fn with_personal_rating(player: Player, rating: u32) -> Player {
        Player {
            personal_rating_2v2: Some(rating),
            ..player
        }
    }

    fn snapshot(match_type: MatchType, players: Vec<Player>) -> MatchSnapshot {
        MatchSnapshot {
            match_type,
            players,
        }
    }

    fn ranked_1v1() -> MatchSnapshot {
        snapshot(
            MatchType::Ranked1v1,
            vec![local_player(), player(SHINIGAMI, "Shinigami", 2, "Hattori")],
        )
    }

    fn ranked_1v1_against(brawlhalla_id: u32, name: &str) -> MatchSnapshot {
        snapshot(
            MatchType::Ranked1v1,
            vec![local_player(), player(brawlhalla_id, name, 2, "Ada")],
        )
    }

    fn ranked_2v2() -> MatchSnapshot {
        let shinigami = player(SHINIGAMI, "Shinigami", 2, "Hattori");
        let tidecaller = player(TIDECALLER, "tidecaller", 2, "Petra");

        snapshot(
            MatchType::Ranked2v2,
            vec![
                local_player(),
                player(2, "mate", 1, "Ember"),
                with_personal_rating(shinigami, 2190),
                with_personal_rating(tidecaller, 2075),
            ],
        )
    }

    fn standing(rating: u32, peak_rating: u32, tier: &str, wins: u32, games: u32) -> Standing {
        Standing {
            rating,
            peak_rating,
            tier: Some(tier.to_string()),
            wins,
            games,
        }
    }

    fn player_answer(brawlhalla_id: u32) -> PlayerAnswer {
        let (one_vs_one, region_rank) = match brawlhalla_id {
            SHINIGAMI => (Some(standing(2130, 2204, "Diamond", 734, 1204)), Some(48)),
            _ => (None, None),
        };

        PlayerAnswer {
            brawlhalla_id,
            one_vs_one,
            region_rank,
            is_refreshing: false,
        }
    }

    /// what the server would answer for the snapshot's opponents
    fn answer_for(snapshot: &MatchSnapshot) -> LobbyAnswer {
        let opponents: Vec<&Player> = snapshot
            .players
            .iter()
            .filter(|player| player.team != 1)
            .collect();
        let team_standing = match snapshot.match_type {
            MatchType::Ranked2v2 => Some(standing(2284, 2301, "Diamond", 51, 90)),
            _ => None,
        };
        let team = TeamAnswer {
            team: opponents[0].team,
            team_standing,
            players: opponents
                .iter()
                .map(|opponent| player_answer(opponent.brawlhalla_id))
                .collect(),
        };

        LobbyAnswer { teams: vec![team] }
    }

    fn refreshing(mut answer: LobbyAnswer) -> LobbyAnswer {
        for player in answer
            .teams
            .iter_mut()
            .flat_map(|team| team.players.iter_mut())
        {
            player.is_refreshing = true;
        }

        answer
    }

    fn with_one_vs_one(mut answer: LobbyAnswer, one_vs_one: Option<Standing>) -> LobbyAnswer {
        answer.teams[0].players[0].one_vs_one = one_vs_one;
        answer.teams[0].players[0].region_rank = None;

        answer
    }

    fn detection(event: Event) -> Input {
        Input::Detection(event)
    }

    fn started(snapshot: MatchSnapshot) -> Input {
        detection(Event::MatchStarted(snapshot))
    }

    fn answered(lobby_id: u64, answer: LobbyAnswer) -> Input {
        Input::LookupFinished {
            lobby_id,
            result: Ok(answer),
        }
    }

    fn failed(lobby_id: u64, failure: LookupFailure) -> Input {
        Input::LookupFinished {
            lobby_id,
            result: Err(failure),
        }
    }

    fn fired(lobby_id: u64, timer: Timer) -> Input {
        Input::TimerFired { lobby_id, timer }
    }

    fn clicked(brawlhalla_id: u32) -> Input {
        Input::ProfileClicked { brawlhalla_id }
    }

    fn shown(effects: &[Effect]) -> Vec<&OverlayView> {
        effects
            .iter()
            .filter_map(|effect| match effect {
                Effect::ShowCards(view) => Some(view),
                _ => None,
            })
            .collect()
    }

    fn lookups(effects: &[Effect]) -> Vec<&LobbyRequest> {
        effects
            .iter()
            .filter_map(|effect| match effect {
                Effect::LookUp { request, .. } => Some(request),
                _ => None,
            })
            .collect()
    }

    fn timers(effects: &[Effect]) -> Vec<(Timer, u64)> {
        effects
            .iter()
            .filter_map(|effect| match effect {
                Effect::StartTimer {
                    timer, after_ms, ..
                } => Some((*timer, *after_ms)),
                _ => None,
            })
            .collect()
    }

    fn opened(effects: &[Effect]) -> Vec<String> {
        effects
            .iter()
            .filter_map(|effect| match effect {
                Effect::OpenLinks(links) => Some(links.clone()),
                _ => None,
            })
            .flatten()
            .collect()
    }

    /// starts a lobby that is shown and returns its id
    fn start(session: &mut Session, snapshot: MatchSnapshot, now_ms: u64) -> u64 {
        let effects = session.handle(started(snapshot), now_ms);
        let views = shown(&effects);

        assert_eq!(views.len(), 1, "the lobby is shown: {effects:?}");
        views[0].lobby_id
    }

    fn solo_data(view: &OverlayView) -> &CardData {
        match &view.cards[..] {
            [Card::Solo { data, .. }] => data,
            cards => panic!("expected one solo card, got {cards:?}"),
        }
    }

    fn solo_failure(view: &OverlayView) -> &Failure {
        match solo_data(view) {
            CardData::Failed(failure) => failure,
            data => panic!("expected a failed card, got {data:?}"),
        }
    }

    fn only_shown(effects: &[Effect]) -> &OverlayView {
        let views = shown(effects);

        assert_eq!(views.len(), 1, "one view is shown: {effects:?}");
        views[0]
    }

    fn fixture(json: &str) -> Value {
        serde_json::from_str(json).expect("fixture is json")
    }

    fn view_fixture(json: &str, lobby_id: u64) -> Value {
        let mut expected = fixture(json);

        // the page fixtures pick a lobby id, the session numbers its own
        expected["lobbyId"] = lobby_id.into();
        expected
    }

    fn as_json<T: serde::Serialize>(value: &T) -> Value {
        serde_json::to_value(value).expect("serializes")
    }

    #[test]
    fn game_found_then_ready_then_closed_is_reported() {
        let mut session = Session::new();

        let effects = session.handle(detection(Event::GameFound { process_id: 4242 }), 0);
        assert_eq!(
            session.status().game,
            GameStatus::Running { game_version: None }
        );
        assert_eq!(session.status().detection, DetectionStatus::Starting);
        assert_eq!(
            effects,
            vec![Effect::StatusChanged(session.status().clone())]
        );

        let ready = Event::Ready {
            local_brawlhalla_id: 1,
            game_version: "11.00.36258".to_string(),
        };
        session.handle(detection(ready), 100);
        let running = GameStatus::Running {
            game_version: Some("11.00.36258".to_string()),
        };
        assert_eq!(session.status().game, running);
        assert_eq!(session.status().detection, DetectionStatus::Ready);

        session.handle(detection(Event::GameClosed), 200);
        assert_eq!(*session.status(), AppStatus::default());
    }

    #[test]
    fn an_unsupported_patch_names_the_patch() {
        let cases = [
            (Some("11.01.36258"), "Patch 11.01 isn't supported yet"),
            (None, "This game version isn't supported yet"),
        ];

        for (game_version, message) in cases {
            let mut session = Session::new();
            let unsupported = Event::Unsupported {
                game_version: game_version.map(str::to_string),
                reason: UnsupportedReason::MissingRole("lobby".to_string()),
            };

            session.handle(detection(Event::GameFound { process_id: 4242 }), 0);
            session.handle(detection(unsupported), 100);

            let expected = DetectionStatus::Unsupported {
                message: message.to_string(),
            };
            assert_eq!(session.status().detection, expected, "{game_version:?}");
        }
    }

    #[test]
    fn a_ranked_1v1_preview_shows_the_opponent_at_once_and_asks_once() {
        let mut session = Session::new();

        let effects = session.handle(started(ranked_1v1()), 1_000);

        let lobby_id = only_shown(&effects).lobby_id;
        let loading = OverlayView {
            lobby_id,
            cards: vec![Card::Solo {
                player: PlayerHead {
                    brawlhalla_id: SHINIGAMI,
                    name: "Shinigami".to_string(),
                    legend: Some("Hattori".to_string()),
                },
                data: CardData::Loading,
            }],
            visible_ms: 12_000,
        };
        let request = LobbyRequest {
            kind: LobbyKind::OneVsOne,
            players: vec![LobbyPlayer {
                brawlhalla_id: SHINIGAMI,
                team: 2,
            }],
        };
        let expected = vec![
            Effect::DropLobbyWork,
            Effect::ShowCards(loading),
            Effect::LookUp { lobby_id, request },
            Effect::StartTimer {
                lobby_id,
                timer: Timer::HideCards,
                after_ms: 12_000,
            },
            Effect::StatusChanged(session.status().clone()),
        ];
        assert_eq!(effects, expected);
        let page_fixture = view_fixture(
            include_str!("../../tests/fixtures/overlay-view-solo-loading.json"),
            lobby_id,
        );
        assert_eq!(as_json(only_shown(&effects)), page_fixture);
    }

    #[test]
    fn the_answer_fills_the_card() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);

        let effects = session.handle(answered(lobby_id, answer_for(&ranked_1v1())), 800);

        assert_eq!(effects.len(), 1, "{effects:?}");
        let expected = view_fixture(
            include_str!("../../tests/fixtures/overlay-view-solo-ranked.json"),
            lobby_id,
        );
        assert_eq!(as_json(only_shown(&effects)), expected);
        assert_eq!(session.overlay_view(), Some(only_shown(&effects)));
    }

    #[test]
    fn a_refreshing_player_is_asked_for_once_more_and_only_once() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        let refreshing_answer = refreshing(answer_for(&ranked_1v1()));

        let first = session.handle(answered(lobby_id, refreshing_answer.clone()), 500);
        assert_eq!(timers(&first), vec![(Timer::LookUp, 3_000)]);
        let page_fixture = view_fixture(
            include_str!("../../tests/fixtures/overlay-view-solo-refreshing.json"),
            lobby_id,
        );
        assert_eq!(as_json(only_shown(&first)), page_fixture);

        let reask = session.handle(fired(lobby_id, Timer::LookUp), 3_500);
        assert_eq!(lookups(&reask).len(), 1);

        let second = session.handle(answered(lobby_id, refreshing_answer), 4_000);
        assert_eq!(timers(&second), vec![]);
        assert!(matches!(
            solo_data(only_shown(&second)),
            CardData::Ranked {
                is_refreshing: false,
                ..
            }
        ));
    }

    #[test]
    fn a_failed_lookup_retries_with_backoff_then_stops() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        let cases = [
            (Some(1_000), Some(1)),
            (Some(2_000), Some(2)),
            (Some(4_000), Some(4)),
            (None, None),
        ];
        let mut now_ms = 0;

        for (retry_after_ms, retry_in_seconds) in cases {
            let unavailable = LookupFailure::Unavailable {
                retry_after_seconds: None,
            };
            let effects = session.handle(failed(lobby_id, unavailable), now_ms);

            let expected_timers: Vec<_> = retry_after_ms
                .map(|after_ms| (Timer::LookUp, after_ms))
                .into_iter()
                .collect();
            assert_eq!(timers(&effects), expected_timers, "at {now_ms} ms");
            assert_eq!(
                solo_failure(only_shown(&effects)).retry_in_seconds,
                retry_in_seconds
            );

            let Some(after_ms) = retry_after_ms else {
                break;
            };
            now_ms += after_ms;
            let retry = session.handle(fired(lobby_id, Timer::LookUp), now_ms);
            assert_eq!(lookups(&retry).len(), 1, "retry at {now_ms} ms");
        }
    }

    #[test]
    fn a_retry_waits_as_long_as_the_server_asks() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        let unavailable = LookupFailure::Unavailable {
            retry_after_seconds: Some(5),
        };

        let effects = session.handle(failed(lobby_id, unavailable), 0);

        assert_eq!(timers(&effects), vec![(Timer::LookUp, 5_000)]);
        assert_eq!(solo_failure(only_shown(&effects)).retry_in_seconds, Some(5));
    }

    #[test]
    fn a_retry_that_would_land_in_the_match_is_not_started() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        let rate_limited = LookupFailure::RateLimited {
            retry_after_seconds: Some(60),
        };

        let effects = session.handle(failed(lobby_id, rate_limited), 0);

        assert_eq!(timers(&effects), vec![]);
        assert_eq!(solo_failure(only_shown(&effects)).retry_in_seconds, None);
    }

    #[test]
    fn an_update_requirement_is_shown_and_remembered() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        let update_required = LookupFailure::UpdateRequired {
            minimum_version: "0.2.0".to_string(),
        };
        let update_card = CardData::Failed(Failure {
            reason: FailureReason::UpdateRequired,
            retry_in_seconds: None,
            can_retry: false,
        });

        let effects = session.handle(failed(lobby_id, update_required), 300);
        assert_eq!(*solo_data(only_shown(&effects)), update_card);
        assert_eq!(timers(&effects), vec![]);
        let service = ServiceStatus::UpdateRequired {
            minimum_version: "0.2.0".to_string(),
        };
        assert_eq!(session.status().service, service);

        session.handle(detection(Event::MatchEnded), 60_000);
        let next = session.handle(started(ranked_1v1()), 90_000);
        assert_eq!(*solo_data(only_shown(&next)), update_card);
        assert_eq!(lookups(&next).len(), 0);
        assert_eq!(timers(&next), vec![(Timer::HideCards, 12_000)]);
    }

    #[test]
    fn an_answer_for_an_earlier_lobby_is_dropped() {
        let mut session = Session::new();
        let first_lobby_id = start(&mut session, ranked_1v1(), 0);
        let second_lobby_id = start(&mut session, ranked_1v1_against(KOA, "Koa"), 400);
        assert_ne!(first_lobby_id, second_lobby_id);

        let late_inputs = [
            answered(first_lobby_id, answer_for(&ranked_1v1())),
            failed(first_lobby_id, LookupFailure::Offline),
            fired(first_lobby_id, Timer::LookUp),
            fired(first_lobby_id, Timer::HideCards),
        ];

        for input in late_inputs {
            let description = format!("{input:?}");
            assert_eq!(session.handle(input, 900), vec![], "{description}");
        }
        assert_eq!(
            session.overlay_view().map(|view| view.lobby_id),
            Some(second_lobby_id)
        );
    }

    #[test]
    fn a_changed_preview_starts_over() {
        let mut session = Session::new();
        let first_lobby_id = start(&mut session, ranked_1v1(), 0);

        let effects = session.handle(started(ranked_1v1_against(KOA, "Koa")), 400);

        assert_eq!(effects[0], Effect::DropLobbyWork);
        let second_lobby_id = only_shown(&effects).lobby_id;
        assert_ne!(second_lobby_id, first_lobby_id);
        let request = LobbyRequest {
            kind: LobbyKind::OneVsOne,
            players: vec![LobbyPlayer {
                brawlhalla_id: KOA,
                team: 2,
            }],
        };
        let expected = Effect::LookUp {
            lobby_id: second_lobby_id,
            request,
        };
        assert!(effects.contains(&expected), "{effects:?}");
    }

    #[test]
    fn cards_hide_when_their_time_is_up() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);

        let effects = session.handle(fired(lobby_id, Timer::HideCards), 12_000);

        assert!(session.status().is_match_running);
        let expected = vec![
            Effect::HideCards,
            Effect::DropLobbyWork,
            Effect::StatusChanged(session.status().clone()),
        ];
        assert_eq!(effects, expected);
        assert_eq!(session.overlay_view(), None);
    }

    #[test]
    fn leaving_the_match_hides_the_cards() {
        let leaving_events = [
            Event::MatchEnded,
            Event::Queueing,
            Event::MatchSkipped {
                reason: SkipReason::Spectating,
            },
            Event::GameClosed,
        ];

        for event in leaving_events {
            let mut session = Session::new();
            start(&mut session, ranked_1v1(), 0);
            let description = format!("{event:?}");

            let effects = session.handle(detection(event), 2_000);

            assert_eq!(
                effects[..2],
                [Effect::HideCards, Effect::DropLobbyWork],
                "{description}"
            );
            assert_eq!(session.overlay_view(), None, "{description}");
        }
    }

    #[test]
    fn a_custom_room_and_other_queues_show_nothing() {
        let match_types = [MatchType::Custom, MatchType::Other("FFA".to_string())];

        for match_type in match_types {
            let mut session = Session::new();
            let description = format!("{match_type:?}");
            let lobby = snapshot(match_type, ranked_1v1().players);

            let effects = session.handle(started(lobby), 0);

            assert_eq!(shown(&effects).len(), 0, "{description}");
            assert_eq!(lookups(&effects).len(), 0, "{description}");
            assert_eq!(session.overlay_view(), None, "{description}");
        }
    }

    #[test]
    fn a_lobby_that_does_not_add_up_shows_nothing() {
        let no_local_player = vec![
            Player {
                is_local: false,
                ..local_player()
            },
            player(SHINIGAMI, "Shinigami", 2, "Hattori"),
        ];
        let two_opponents = vec![
            local_player(),
            player(SHINIGAMI, "Shinigami", 2, "Hattori"),
            player(TIDECALLER, "tidecaller", 2, "Petra"),
        ];
        let one_opponent = vec![
            local_player(),
            player(2, "mate", 1, "Ember"),
            player(SHINIGAMI, "Shinigami", 2, "Hattori"),
        ];
        let opponents_on_two_teams = vec![
            local_player(),
            player(2, "mate", 1, "Ember"),
            player(SHINIGAMI, "Shinigami", 2, "Hattori"),
            player(TIDECALLER, "tidecaller", 3, "Petra"),
        ];
        let cases = [
            (
                "no local player",
                snapshot(MatchType::Ranked1v1, no_local_player),
            ),
            (
                "1v1 with two opponents",
                snapshot(MatchType::Ranked1v1, two_opponents),
            ),
            (
                "2v2 with one opponent",
                snapshot(MatchType::Ranked2v2, one_opponent),
            ),
            (
                "2v2 with opponents on two teams",
                snapshot(MatchType::Ranked2v2, opponents_on_two_teams),
            ),
        ];

        for (description, lobby) in cases {
            let mut session = Session::new();

            let effects = session.handle(started(lobby), 0);

            assert_eq!(shown(&effects).len(), 0, "{description}");
            assert_eq!(lookups(&effects).len(), 0, "{description}");
        }
    }

    #[test]
    fn nothing_is_asked_during_a_match() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        session.handle(failed(lobby_id, LookupFailure::Offline), 500);
        session.handle(fired(lobby_id, Timer::HideCards), 12_000);

        let inputs = [
            Input::RetryClicked,
            fired(lobby_id, Timer::LookUp),
            failed(lobby_id, LookupFailure::Offline),
            answered(lobby_id, answer_for(&ranked_1v1())),
        ];

        for input in inputs {
            let description = format!("{input:?}");
            let effects = session.handle(input, 12_500);

            assert_eq!(lookups(&effects).len(), 0, "{description}");
            assert_eq!(timers(&effects), vec![], "{description}");
            assert_eq!(shown(&effects).len(), 0, "{description}");
        }
    }

    #[test]
    fn a_2v2_lobby_becomes_one_team_card() {
        let mut session = Session::new();

        let effects = session.handle(started(ranked_2v2()), 0);

        let lobby_id = only_shown(&effects).lobby_id;
        let request = LobbyRequest {
            kind: LobbyKind::TwoVsTwo,
            players: vec![
                LobbyPlayer {
                    brawlhalla_id: SHINIGAMI,
                    team: 2,
                },
                LobbyPlayer {
                    brawlhalla_id: TIDECALLER,
                    team: 2,
                },
            ],
        };
        assert_eq!(lookups(&effects), vec![&request]);

        let answer = session.handle(answered(lobby_id, answer_for(&ranked_2v2())), 700);
        let expected = view_fixture(
            include_str!("../../tests/fixtures/overlay-view-team.json"),
            lobby_id,
        );
        assert_eq!(as_json(only_shown(&answer)), expected);
    }

    #[test]
    fn a_2v2_card_without_memory_ratings_carries_the_1v1_elo() {
        let mut session = Session::new();
        let mut lobby = ranked_2v2();
        for player in &mut lobby.players {
            player.personal_rating_2v2 = None;
        }
        let lobby_id = start(&mut session, lobby.clone(), 0);
        let mut answer = answer_for(&lobby);
        answer.teams[0].team_standing = None;

        let effects = session.handle(answered(lobby_id, answer), 700);

        let expected = view_fixture(
            include_str!("../../tests/fixtures/overlay-view-team-bare.json"),
            lobby_id,
        );
        assert_eq!(as_json(only_shown(&effects)), expected);
    }

    #[test]
    fn a_known_player_with_no_games_is_ranked_with_zeros() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        let no_games = with_one_vs_one(
            answer_for(&ranked_1v1()),
            Some(standing(0, 782, "Tin 0", 0, 0)),
        );

        let effects = session.handle(answered(lobby_id, no_games), 700);

        let expected = CardData::Ranked {
            tier: Some("Tin 0".to_string()),
            rating: 0,
            peak_rating: 782,
            region_rank: None,
            wins: 0,
            games: 0,
            is_refreshing: false,
        };
        assert_eq!(*solo_data(only_shown(&effects)), expected);
    }

    #[test]
    fn an_unknown_player_has_no_ranked_data() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        let unknown = with_one_vs_one(answer_for(&ranked_1v1()), None);

        let effects = session.handle(answered(lobby_id, unknown), 700);

        assert_eq!(*solo_data(only_shown(&effects)), CardData::NoRankedData);
        let expected = view_fixture(
            include_str!("../../tests/fixtures/overlay-view-solo-no-data.json"),
            lobby_id,
        );
        assert_eq!(as_json(only_shown(&effects)), expected);
    }

    #[test]
    fn a_click_while_loading_opens_the_profile_at_once() {
        let mut session = Session::new();
        start(&mut session, ranked_1v1(), 0);

        let effects = session.handle(clicked(SHINIGAMI), 1_000);

        assert_eq!(
            effects,
            vec![Effect::OpenLinks(vec![
                "https://brawltome.app/player/91913839".to_string()
            ])]
        );
        assert!(session.overlay_view().is_some());
    }

    #[test]
    fn the_end_of_a_match_opens_nothing() {
        let mut session = Session::new();
        start(&mut session, ranked_1v1(), 0);
        session.handle(clicked(SHINIGAMI), 1_000);

        let ended = session.handle(detection(Event::MatchEnded), 200_000);

        assert_eq!(opened(&ended), Vec::<String>::new());
    }

    #[test]
    fn a_click_outside_a_match_opens_at_once() {
        let mut session = Session::new();
        start(&mut session, ranked_1v1(), 0);
        session.handle(detection(Event::MatchEnded), 200_000);

        let effects = session.handle(clicked(SHINIGAMI), 300_000);

        assert_eq!(
            effects,
            vec![Effect::OpenLinks(vec![profile_url(SHINIGAMI)])]
        );
    }

    #[test]
    fn a_click_on_a_player_we_never_showed_does_nothing() {
        let mut idle_session = Session::new();
        assert_eq!(idle_session.handle(clicked(SHINIGAMI), 0), vec![]);

        let mut loading_session = Session::new();
        start(&mut loading_session, ranked_1v1(), 0);
        assert_eq!(loading_session.handle(clicked(KOA), 500), vec![]);
        loading_session.handle(detection(Event::MatchEnded), 200_000);
        assert_eq!(
            opened(&loading_session.handle(clicked(KOA), 300_000)),
            Vec::<String>::new()
        );
    }

    #[test]
    fn a_paused_overlay_shows_and_asks_nothing() {
        let mut paused_session = Session::new();
        paused_session.handle(Input::OverlayPaused(true), 0);

        let effects = paused_session.handle(started(ranked_1v1()), 1_000);
        assert_eq!(shown(&effects).len(), 0);
        assert_eq!(lookups(&effects).len(), 0);

        let mut loading_session = Session::new();
        start(&mut loading_session, ranked_1v1(), 0);
        let paused = loading_session.handle(Input::OverlayPaused(true), 1_000);
        let expected = vec![
            Effect::HideCards,
            Effect::DropLobbyWork,
            Effect::StatusChanged(loading_session.status().clone()),
        ];
        assert_eq!(paused, expected);
        assert!(loading_session.status().is_overlay_paused);
    }

    #[test]
    fn retry_asks_again_now() {
        let cases = [
            (LookupFailure::Offline, FailureReason::Offline, true),
            (
                LookupFailure::RateLimited {
                    retry_after_seconds: None,
                },
                FailureReason::RateLimited,
                true,
            ),
            (
                LookupFailure::Unavailable {
                    retry_after_seconds: None,
                },
                FailureReason::Unavailable,
                true,
            ),
            (LookupFailure::InvalidAnswer, FailureReason::Rejected, true),
            (LookupFailure::Rejected, FailureReason::Rejected, false),
            (
                LookupFailure::UpdateRequired {
                    minimum_version: "0.2.0".to_string(),
                },
                FailureReason::UpdateRequired,
                false,
            ),
        ];

        for (failure, reason, can_retry) in cases {
            let mut session = Session::new();
            let lobby_id = start(&mut session, ranked_1v1(), 0);
            let description = format!("{failure:?}");

            let failed_effects = session.handle(failed(lobby_id, failure), 500);
            let card_failure = solo_failure(only_shown(&failed_effects));
            assert_eq!(card_failure.reason, reason, "{description}");
            assert_eq!(card_failure.can_retry, can_retry, "{description}");

            let retry = session.handle(Input::RetryClicked, 600);
            let expected_lookups = usize::from(can_retry);
            assert_eq!(lookups(&retry).len(), expected_lookups, "{description}");
        }
    }

    #[test]
    fn offline_is_reported_until_a_lookup_works() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);

        let offline = session.handle(failed(lobby_id, LookupFailure::Offline), 500);
        assert_eq!(session.status().service, ServiceStatus::Offline);
        assert!(offline.contains(&Effect::StatusChanged(session.status().clone())));

        session.handle(fired(lobby_id, Timer::LookUp), 1_500);
        let working = session.handle(answered(lobby_id, answer_for(&ranked_1v1())), 1_800);
        assert_eq!(session.status().service, ServiceStatus::Ok);
        assert!(working.contains(&Effect::StatusChanged(session.status().clone())));
    }

    #[test]
    fn shown_lobbies_are_remembered_newest_first_up_to_five() {
        let mut session = Session::new();

        for index in 0..6 {
            let brawlhalla_id = 100 + index;
            let now_ms = u64::from(index) * 60_000;
            start(
                &mut session,
                ranked_1v1_against(brawlhalla_id, "someone"),
                now_ms,
            );
            session.handle(detection(Event::MatchEnded), now_ms + 30_000);
        }

        let remembered: Vec<_> = session
            .status()
            .recent_matches
            .iter()
            .map(|recent| (recent.started_at_ms, recent.opponents[0].brawlhalla_id))
            .collect();
        let expected = vec![
            (300_000, 105),
            (240_000, 104),
            (180_000, 103),
            (120_000, 102),
            (60_000, 101),
        ];
        assert_eq!(remembered, expected);
        assert_eq!(MAX_RECENT_MATCHES, 5);
    }

    #[test]
    fn a_changed_preview_is_remembered_once() {
        let mut session = Session::new();
        start(&mut session, ranked_1v1(), 0);

        start(&mut session, ranked_1v1_against(KOA, "Koa"), 400);

        let remembered: Vec<_> = session
            .status()
            .recent_matches
            .iter()
            .map(|recent| recent.opponents[0].brawlhalla_id)
            .collect();
        assert_eq!(remembered, vec![KOA]);
    }

    #[test]
    fn an_answer_that_misses_an_opponent_shows_the_error_state() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_2v2(), 0);
        let mut answer = answer_for(&ranked_2v2());
        answer.teams[0].players.pop();

        let effects = session.handle(answered(lobby_id, answer), 700);

        let Card::Team { data, .. } = &only_shown(&effects).cards[0] else {
            panic!("expected a team card")
        };
        assert!(matches!(data, TeamData::Failed(_)), "{data:?}");
    }

    #[test]
    fn a_failed_refresh_keeps_the_first_answer() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        session.handle(
            answered(lobby_id, refreshing(answer_for(&ranked_1v1()))),
            500,
        );
        session.handle(fired(lobby_id, Timer::LookUp), 3_500);

        let effects = session.handle(failed(lobby_id, LookupFailure::Offline), 4_000);

        assert_eq!(timers(&effects), vec![]);
        assert!(matches!(
            solo_data(only_shown(&effects)),
            CardData::Ranked {
                is_refreshing: false,
                ..
            }
        ));
    }

    #[test]
    fn a_failed_card_is_drawn_the_way_the_page_expects() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        let unavailable = LookupFailure::Unavailable {
            retry_after_seconds: Some(4),
        };

        let effects = session.handle(failed(lobby_id, unavailable), 0);

        let expected = view_fixture(
            include_str!("../../tests/fixtures/overlay-view-solo-failed.json"),
            lobby_id,
        );
        assert_eq!(as_json(only_shown(&effects)), expected);
    }

    #[test]
    fn a_retry_click_while_a_retry_waits_asks_only_once() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        let unavailable = LookupFailure::Unavailable {
            retry_after_seconds: None,
        };
        let first_failure = session.handle(failed(lobby_id, unavailable.clone()), 0);
        assert_eq!(timers(&first_failure), vec![(Timer::LookUp, 1_000)]);

        let click = session.handle(Input::RetryClicked, 200);
        assert_eq!(lookups(&click).len(), 1);
        assert_eq!(
            session.handle(Input::RetryClicked, 250),
            vec![],
            "already asking"
        );

        let second_failure = session.handle(failed(lobby_id, unavailable), 300);
        assert_eq!(timers(&second_failure), vec![(Timer::LookUp, 2_000)]);

        let early_timer = session.handle(fired(lobby_id, Timer::LookUp), 1_000);
        assert_eq!(early_timer, vec![], "the first timer is not due anymore");
        let unasked_answer = session.handle(answered(lobby_id, answer_for(&ranked_1v1())), 1_100);
        assert_eq!(unasked_answer, vec![], "nothing was asked");

        let due_timer = session.handle(fired(lobby_id, Timer::LookUp), 2_300);
        assert_eq!(lookups(&due_timer).len(), 1);
    }

    #[test]
    fn a_click_that_lands_after_the_cards_hid_does_nothing() {
        let mut session = Session::new();
        let lobby_id = start(&mut session, ranked_1v1(), 0);
        session.handle(fired(lobby_id, Timer::HideCards), 12_000);

        let click = session.handle(clicked(SHINIGAMI), 13_000);
        assert_eq!(click, vec![]);
        assert_eq!(session.overlay_view(), None);

        let ended = session.handle(detection(Event::MatchEnded), 200_000);
        assert_eq!(opened(&ended), Vec::<String>::new());
    }

    #[test]
    fn a_changed_preview_that_is_not_shown_is_forgotten() {
        let mut session = Session::new();
        start(&mut session, ranked_1v1(), 0);
        let no_local_player = vec![
            player(KOA, "Koa", 1, "Ada"),
            player(SHINIGAMI, "Shinigami", 2, "Hattori"),
        ];

        let effects = session.handle(
            started(snapshot(MatchType::Ranked1v1, no_local_player)),
            400,
        );

        assert_eq!(effects[..2], [Effect::HideCards, Effect::DropLobbyWork]);
        assert_eq!(session.status().recent_matches, vec![]);
    }

    #[test]
    fn the_status_serializes_as_the_ui_reads_it() {
        let idle = Session::new();
        assert_eq!(
            as_json(idle.status()),
            fixture(include_str!("../../tests/fixtures/app-status-idle.json"))
        );

        let mut ready = Session::new();
        let ready_event = Event::Ready {
            local_brawlhalla_id: 1,
            game_version: "11.00.36258".to_string(),
        };
        let two_vs_two = snapshot(
            MatchType::Ranked2v2,
            vec![
                local_player(),
                player(2, "mate", 1, "Ember"),
                player(KOA, "Koa", 2, "Ada"),
                player(RIMELIGHT, "rimelight", 2, "Lucien"),
            ],
        );
        ready.handle(detection(Event::GameFound { process_id: 4242 }), 0);
        ready.handle(detection(ready_event), 1_000);
        start(&mut ready, two_vs_two, 600_000);
        ready.handle(detection(Event::MatchEnded), 900_000);
        start(&mut ready, ranked_1v1(), 1_800_000);
        ready.handle(detection(Event::MatchEnded), 2_000_000);
        assert_eq!(
            as_json(ready.status()),
            fixture(include_str!("../../tests/fixtures/app-status-ready.json"))
        );

        let mut unsupported = Session::new();
        let unsupported_event = Event::Unsupported {
            game_version: Some("11.01.36258".to_string()),
            reason: UnsupportedReason::MissingRole("lobby".to_string()),
        };
        unsupported.handle(detection(Event::GameFound { process_id: 4242 }), 0);
        unsupported.handle(detection(unsupported_event), 1_000);
        let expected = fixture(include_str!(
            "../../tests/fixtures/app-status-unsupported.json"
        ));
        assert_eq!(as_json(unsupported.status()), expected);
    }
}
