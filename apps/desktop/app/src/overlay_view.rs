//! what the overlay page draws, built from a lobby's opponents and the answer about them

use brawltome_detection::{MatchSnapshot, MatchType, Player};
use serde::Serialize;

use crate::lobby_client::{LobbyAnswer, LobbyKind, LookupFailure};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverlayView {
    pub lobby_id: u64,
    pub cards: Vec<Card>,
    pub visible_ms: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Card {
    Solo {
        player: PlayerHead,
        data: CardData,
    },
    Team {
        team: u32,
        data: TeamData,
        players: Vec<TeamPlayer>,
    },
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlayerHead {
    pub brawlhalla_id: u32,
    pub name: String,
    pub legend: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CardData {
    Loading,
    Ranked {
        tier: Option<String>,
        rating: u32,
        peak_rating: u32,
        region_rank: Option<u32>,
        wins: u32,
        games: u32,
        is_refreshing: bool,
    },
    NoRankedData,
    Failed(Failure),
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(
    tag = "state",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TeamData {
    Loading,
    Ready {
        standing: Option<TeamStanding>,
        is_refreshing: bool,
    },
    Failed(Failure),
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamStanding {
    pub tier: Option<String>,
    pub rating: u32,
    pub wins: u32,
    pub games: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamPlayer {
    pub brawlhalla_id: u32,
    pub name: String,
    pub legend: Option<String>,
    pub personal_rating_2v2: Option<u32>,
    pub one_vs_one_rating: Option<u32>,
}

/// why a card has no data, and whether it will or can ask again
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub reason: FailureReason,
    pub retry_in_seconds: Option<u32>,
    pub can_retry: bool,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FailureReason {
    Offline,
    RateLimited,
    Unavailable,
    UpdateRequired,
    Rejected,
}

/// the opponents a lobby's cards are about, as detection read them: one for a ranked 1v1, two of
/// one team for a ranked 2v2
#[derive(Clone, Debug, PartialEq)]
pub struct LobbyOpponents {
    kind: LobbyKind,
    players: Vec<Player>,
}

impl LobbyOpponents {
    /// none when the lobby isn't a ranked one we can read cleanly
    pub fn read(snapshot: &MatchSnapshot) -> Option<Self> {
        let mut local_players = snapshot.players.iter().filter(|player| player.is_local);
        let local_player = local_players.next()?;
        if local_players.next().is_some() {
            return None;
        }

        let players: Vec<Player> = snapshot
            .players
            .iter()
            .filter(|player| player.team != local_player.team)
            .cloned()
            .collect();
        let kind = match snapshot.match_type {
            MatchType::Ranked1v1 if players.len() == 1 => LobbyKind::OneVsOne,
            MatchType::Ranked2v2 if players.len() == 2 && players[0].team == players[1].team => {
                LobbyKind::TwoVsTwo
            }
            _ => return None,
        };

        Some(Self { kind, players })
    }

    pub fn kind(&self) -> LobbyKind {
        self.kind
    }

    pub fn players(&self) -> &[Player] {
        &self.players
    }

    pub fn heads(&self) -> Vec<PlayerHead> {
        self.players.iter().map(player_head).collect()
    }
}

pub fn failure_reason(failure: &LookupFailure) -> FailureReason {
    match failure {
        LookupFailure::UpdateRequired { .. } => FailureReason::UpdateRequired,
        LookupFailure::RateLimited { .. } => FailureReason::RateLimited,
        LookupFailure::Unavailable { .. } => FailureReason::Unavailable,
        LookupFailure::Offline => FailureReason::Offline,
        // an answer we can't read is shown like a refused one: "Couldn't load"
        LookupFailure::Rejected | LookupFailure::InvalidAnswer => FailureReason::Rejected,
    }
}

/// the cards before the answer: names and legends from memory
pub fn loading_view(lobby_id: u64, visible_ms: u64, opponents: &LobbyOpponents) -> OverlayView {
    let card = match opponents.kind {
        LobbyKind::OneVsOne => solo_card(&opponents.players[0], CardData::Loading),
        LobbyKind::TwoVsTwo => team_card(&opponents.players, TeamData::Loading, None),
    };

    view(lobby_id, visible_ms, card)
}

/// none when the answer misses one of the opponents
pub fn answered_view(
    lobby_id: u64,
    visible_ms: u64,
    opponents: &LobbyOpponents,
    answer: &LobbyAnswer,
    is_refresh_pending: bool,
) -> Option<OverlayView> {
    let card = match opponents.kind {
        LobbyKind::OneVsOne => {
            answered_solo_card(&opponents.players[0], answer, is_refresh_pending)?
        }
        LobbyKind::TwoVsTwo => answered_team_card(&opponents.players, answer, is_refresh_pending)?,
    };

    Some(view(lobby_id, visible_ms, card))
}

pub fn failed_view(
    lobby_id: u64,
    visible_ms: u64,
    opponents: &LobbyOpponents,
    failure: Failure,
) -> OverlayView {
    let card = match opponents.kind {
        LobbyKind::OneVsOne => solo_card(&opponents.players[0], CardData::Failed(failure)),
        LobbyKind::TwoVsTwo => team_card(&opponents.players, TeamData::Failed(failure), None),
    };

    view(lobby_id, visible_ms, card)
}

fn view(lobby_id: u64, visible_ms: u64, card: Card) -> OverlayView {
    OverlayView {
        lobby_id,
        cards: vec![card],
        visible_ms,
    }
}

fn answered_solo_card(
    opponent: &Player,
    answer: &LobbyAnswer,
    is_refresh_pending: bool,
) -> Option<Card> {
    let player_answer = answer.player(opponent.brawlhalla_id)?;

    let data = match &player_answer.one_vs_one {
        Some(standing) => CardData::Ranked {
            tier: standing.tier.clone(),
            rating: standing.rating,
            peak_rating: standing.peak_rating,
            region_rank: player_answer.region_rank,
            wins: standing.wins,
            games: standing.games,
            is_refreshing: is_refresh_pending && player_answer.is_refreshing,
        },
        None => CardData::NoRankedData,
    };

    Some(solo_card(opponent, data))
}

fn answered_team_card(
    opponents: &[Player],
    answer: &LobbyAnswer,
    is_refresh_pending: bool,
) -> Option<Card> {
    let team_answer = answer
        .teams
        .iter()
        .find(|team| team.team == opponents[0].team)?;
    let is_every_opponent_answered = opponents
        .iter()
        .all(|opponent| answer.player(opponent.brawlhalla_id).is_some());
    if !is_every_opponent_answered {
        return None;
    }

    let is_any_refreshing = team_answer
        .players
        .iter()
        .any(|player| player.is_refreshing);
    let standing = team_answer
        .team_standing
        .as_ref()
        .map(|standing| TeamStanding {
            tier: standing.tier.clone(),
            rating: standing.rating,
            wins: standing.wins,
            games: standing.games,
        });
    let data = TeamData::Ready {
        standing,
        is_refreshing: is_refresh_pending && is_any_refreshing,
    };

    Some(team_card(opponents, data, Some(answer)))
}

fn solo_card(opponent: &Player, data: CardData) -> Card {
    Card::Solo {
        player: player_head(opponent),
        data,
    }
}

fn team_card(opponents: &[Player], data: TeamData, answer: Option<&LobbyAnswer>) -> Card {
    let players = opponents
        .iter()
        .map(|opponent| team_player(opponent, answer))
        .collect();

    Card::Team {
        team: opponents[0].team,
        data,
        players,
    }
}

/// the 1v1 Elo stands in only for a player whose personal 2v2 Elo memory doesn't hold
fn team_player(opponent: &Player, answer: Option<&LobbyAnswer>) -> TeamPlayer {
    let fallback_answer = answer.filter(|_| opponent.personal_rating_2v2.is_none());
    let one_vs_one_rating = fallback_answer
        .and_then(|answer| answer.player(opponent.brawlhalla_id))
        .and_then(|player_answer| player_answer.one_vs_one.as_ref())
        .map(|standing| standing.rating);

    TeamPlayer {
        brawlhalla_id: opponent.brawlhalla_id,
        name: opponent.name.clone(),
        legend: opponent.legend.clone(),
        personal_rating_2v2: opponent.personal_rating_2v2,
        one_vs_one_rating,
    }
}

fn player_head(player: &Player) -> PlayerHead {
    PlayerHead {
        brawlhalla_id: player.brawlhalla_id,
        name: player.name.clone(),
        legend: player.legend.clone(),
    }
}
