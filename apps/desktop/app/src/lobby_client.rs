//! One lobby request to `POST /desktop/v1/lobby`: a `LobbyAnswer` or a `LookupFailure`.

use std::future::Future;
use std::num::NonZeroU64;
use std::time::Duration;

use brawltome_contracts::generated::types::{
    DesktopLobby, DesktopLobbyCard, DesktopLobbyCardTeamStanding, DesktopLobbyInput,
    DesktopLobbyInputMatchType, DesktopLobbyInputPlayersItem, DesktopLobbyPlayer,
    DesktopLobbyPlayerOneVsOne, DesktopUpdateRequired, PostDesktopLobbyXDesktopVersion,
};
use brawltome_contracts::generated::{Client, Error};

pub const REQUEST_TIMEOUT_MS: u64 = 4_000;

const MAX_PLAYERS_PER_LOBBY: usize = 4;
const MAX_CONTRACT_NUMBER: u32 = i32::MAX as u32;

// callers wait this long at least and at most, so an odd header can't hot-loop or stall them
const MIN_RETRY_AFTER_SECONDS: u64 = 1;
const MAX_RETRY_AFTER_SECONDS: u64 = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LobbyKind {
    OneVsOne,
    TwoVsTwo,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LobbyPlayer {
    pub brawlhalla_id: u32,
    pub team: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LobbyRequest {
    pub kind: LobbyKind,
    pub players: Vec<LobbyPlayer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Standing {
    pub rating: u32,
    pub peak_rating: u32,
    pub tier: Option<String>,
    pub wins: u32,
    pub games: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerAnswer {
    pub brawlhalla_id: u32,
    pub one_vs_one: Option<Standing>,
    pub region_rank: Option<u32>,
    pub is_refreshing: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TeamAnswer {
    pub team: u32,
    pub team_standing: Option<Standing>,
    pub players: Vec<PlayerAnswer>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LobbyAnswer {
    pub teams: Vec<TeamAnswer>,
}

impl LobbyAnswer {
    pub fn player(&self, brawlhalla_id: u32) -> Option<&PlayerAnswer> {
        self.teams
            .iter()
            .flat_map(|team| team.players.iter())
            .find(|player| player.brawlhalla_id == brawlhalla_id)
    }

    pub fn is_any_player_refreshing(&self) -> bool {
        self.teams
            .iter()
            .flat_map(|team| team.players.iter())
            .any(|player| player.is_refreshing)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LookupFailure {
    /// 426
    UpdateRequired { minimum_version: String },
    /// 429
    RateLimited { retry_after_seconds: Option<u32> },
    /// any 5xx
    Unavailable { retry_after_seconds: Option<u32> },
    /// no connection, or no answer in time
    Offline,
    /// 400, any other 4xx, or an id the contract refuses
    Rejected,
    /// not the contract, or a requested player is missing
    InvalidAnswer,
}

pub trait LobbyLookup: Send + Sync + 'static {
    fn look_up(
        &self,
        request: LobbyRequest,
    ) -> impl Future<Output = Result<LobbyAnswer, LookupFailure>> + Send;
}

/// a failure plus the http status it came with, for the log line only
struct LookupError {
    failure: LookupFailure,
    status: Option<u16>,
}

impl From<LookupFailure> for LookupError {
    fn from(failure: LookupFailure) -> Self {
        Self {
            failure,
            status: None,
        }
    }
}

pub struct LobbyClient {
    client: Client,
    version_header: PostDesktopLobbyXDesktopVersion,
}

impl LobbyClient {
    pub fn new(base_url: &str, app_version: &str) -> Result<Self, String> {
        let version_header: PostDesktopLobbyXDesktopVersion = app_version
            .parse()
            .map_err(|_| format!("desktop version {app_version}: not a version the api accepts"))?;

        let timeout = Duration::from_millis(REQUEST_TIMEOUT_MS);
        let http_client = reqwest::Client::builder()
            .timeout(timeout)
            .connect_timeout(timeout)
            .build()
            .map_err(|error| format!("build the lobby http client: {error}"))?;

        Ok(Self {
            client: Client::new_with_client(base_url, http_client),
            version_header,
        })
    }

    async fn post_lobby(&self, request: &LobbyRequest) -> Result<LobbyAnswer, LookupError> {
        let body = build_input(request)?;

        let response = self
            .client
            .post_desktop_lobby(&self.version_header, &body)
            .await
            .map_err(failure_from_error)?;

        Ok(read_answer(request, response.into_inner())?)
    }
}

impl LobbyLookup for LobbyClient {
    async fn look_up(&self, request: LobbyRequest) -> Result<LobbyAnswer, LookupFailure> {
        let error = match self.post_lobby(&request).await {
            Ok(answer) => return Ok(answer),
            Err(error) => error,
        };

        log::warn!("lobby lookup failed: {}", describe(&error));

        Err(error.failure)
    }
}

fn build_input(request: &LobbyRequest) -> Result<DesktopLobbyInput, LookupFailure> {
    let is_player_count_valid = (1..=MAX_PLAYERS_PER_LOBBY).contains(&request.players.len());
    if !is_player_count_valid {
        return Err(LookupFailure::Rejected);
    }

    let players = request
        .players
        .iter()
        .map(build_input_player)
        .collect::<Result<Vec<_>, _>>()?;

    let match_type = match request.kind {
        LobbyKind::OneVsOne => DesktopLobbyInputMatchType::X1v1,
        LobbyKind::TwoVsTwo => DesktopLobbyInputMatchType::X2v2,
    };

    Ok(DesktopLobbyInput {
        match_type,
        players,
    })
}

fn build_input_player(player: &LobbyPlayer) -> Result<DesktopLobbyInputPlayersItem, LookupFailure> {
    let is_id_valid = (1..=MAX_CONTRACT_NUMBER).contains(&player.brawlhalla_id);
    if !is_id_valid {
        return Err(LookupFailure::Rejected);
    }

    let brawlhalla_id =
        NonZeroU64::new(u64::from(player.brawlhalla_id)).ok_or(LookupFailure::Rejected)?;
    let team = i32::try_from(player.team).map_err(|_| LookupFailure::Rejected)?;

    Ok(DesktopLobbyInputPlayersItem {
        brawlhalla_id,
        team,
    })
}

fn failure_from_error(error: Error<DesktopUpdateRequired>) -> LookupError {
    let status = error.status().map(|status| status.as_u16());

    LookupError {
        failure: failure_from_kind(error),
        status,
    }
}

fn failure_from_kind(error: Error<DesktopUpdateRequired>) -> LookupFailure {
    match error {
        Error::ErrorResponse(update_required) => LookupFailure::UpdateRequired {
            minimum_version: update_required.into_inner().minimum_version.to_string(),
        },
        Error::UnexpectedResponse(response) => failure_from_status(&response),
        Error::CommunicationError(_) => LookupFailure::Offline,
        Error::ResponseBodyError(error) if error.is_timeout() => LookupFailure::Offline,
        _ => LookupFailure::InvalidAnswer,
    }
}

fn failure_from_status(response: &reqwest::Response) -> LookupFailure {
    let status = response.status();
    let retry_after_seconds = read_retry_after_seconds(response);

    if status.as_u16() == 429 {
        return LookupFailure::RateLimited {
            retry_after_seconds,
        };
    }
    if status.is_server_error() {
        return LookupFailure::Unavailable {
            retry_after_seconds,
        };
    }
    if status.is_client_error() {
        return LookupFailure::Rejected;
    }

    LookupFailure::InvalidAnswer
}

/// plain digits only (no sign, no http date), kept between the min and max wait
fn read_retry_after_seconds(response: &reqwest::Response) -> Option<u32> {
    let value = response.headers().get(reqwest::header::RETRY_AFTER)?;
    let text = value.to_str().ok()?.trim();

    let is_plain_digits = !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit());
    if !is_plain_digits {
        return None;
    }

    // digits too long for a u64 are far above the cap
    let seconds = text.parse::<u64>().unwrap_or(u64::MAX);
    let clamped = seconds.clamp(MIN_RETRY_AFTER_SECONDS, MAX_RETRY_AFTER_SECONDS);

    u32::try_from(clamped).ok()
}

fn read_answer(request: &LobbyRequest, lobby: DesktopLobby) -> Result<LobbyAnswer, LookupFailure> {
    let teams = lobby
        .cards
        .into_iter()
        .map(read_team)
        .collect::<Result<Vec<_>, _>>()?;
    let answer = LobbyAnswer { teams };

    let has_every_player = request
        .players
        .iter()
        .all(|player| answer.player(player.brawlhalla_id).is_some());
    if !has_every_player {
        return Err(LookupFailure::InvalidAnswer);
    }

    Ok(answer)
}

fn read_team(card: DesktopLobbyCard) -> Result<TeamAnswer, LookupFailure> {
    let team_standing = card.team_standing.map(read_team_standing).transpose()?;
    let players = card
        .players
        .into_iter()
        .map(read_player)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(TeamAnswer {
        team: read_count(card.team)?,
        team_standing,
        players,
    })
}

fn read_player(player: DesktopLobbyPlayer) -> Result<PlayerAnswer, LookupFailure> {
    let brawlhalla_id =
        u32::try_from(player.brawlhalla_id.get()).map_err(|_| LookupFailure::InvalidAnswer)?;
    let one_vs_one = player.one_vs_one.map(read_one_vs_one).transpose()?;

    Ok(PlayerAnswer {
        brawlhalla_id,
        one_vs_one,
        region_rank: player.region_rank.map(|rank| rank.get()),
        is_refreshing: player.is_refreshing,
    })
}

fn read_one_vs_one(standing: DesktopLobbyPlayerOneVsOne) -> Result<Standing, LookupFailure> {
    Ok(Standing {
        rating: read_count(standing.rating)?,
        peak_rating: read_count(standing.peak_rating)?,
        tier: standing.tier.map(|tier| tier.to_string()),
        wins: read_count(standing.wins)?,
        games: read_count(standing.games)?,
    })
}

fn read_team_standing(standing: DesktopLobbyCardTeamStanding) -> Result<Standing, LookupFailure> {
    Ok(Standing {
        rating: read_count(standing.rating)?,
        peak_rating: read_count(standing.peak_rating)?,
        tier: standing.tier.map(|tier| tier.to_string()),
        wins: read_count(standing.wins)?,
        games: read_count(standing.games)?,
    })
}

/// the contract says zero or more; the type does not stop a negative number
fn read_count(value: i32) -> Result<u32, LookupFailure> {
    u32::try_from(value).map_err(|_| LookupFailure::InvalidAnswer)
}

/// the failure kind and the http status when there is one, never a body
fn describe(error: &LookupError) -> String {
    let kind = match error.failure {
        LookupFailure::UpdateRequired { .. } => "update required",
        LookupFailure::RateLimited { .. } => "rate limited",
        LookupFailure::Unavailable { .. } => "unavailable",
        LookupFailure::Offline => "no answer from the api",
        LookupFailure::Rejected => "request rejected",
        LookupFailure::InvalidAnswer => "answer is not the contract",
    };

    match error.status {
        Some(status) => format!("{kind} (status {status})"),
        None => format!("{kind} (no status)"),
    }
}
