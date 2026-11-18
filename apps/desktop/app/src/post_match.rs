//! the post-match card: what the results screen said about the match just played

use brawltome_detection::{Change, MatchResult};
use serde::Serialize;

use crate::overlay_view::PlayerHead;

/// the shape of the overlay page's `PostMatchView`
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PostMatchCard {
    pub is_win: bool,
    pub opponents: Vec<PlayerHead>,
    /// the tier after the match, the 1v1 one or the team's
    pub tier: Option<String>,
    pub tier_change: Option<TierChange>,
    /// the 1v1 elo, or the team's elo in a 2v2
    pub rating: u32,
    pub rating_change: i32,
    pub personal_2v2: Option<PersonalRating>,
    /// none until the app uploads replays
    pub match_page: Option<MatchPageState>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TierChange {
    Up,
    Down,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PersonalRating {
    pub rating: u32,
    pub change: i32,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MatchPageState {
    Uploading,
    Building,
    Ready,
}

/// the game's tier index counts six a rank from Tin 0 at 1, with Diamond, which has no subdivisions, at 31
const TIERS_PER_RANK: u32 = 6;
const RANKS_WITH_SUBDIVISIONS: [&str; 5] = ["Tin", "Bronze", "Silver", "Gold", "Platinum"];
const DIAMOND_TIER_INDEX: u32 = 31;

pub fn post_match_card(opponents: Vec<PlayerHead>, result: &MatchResult) -> PostMatchCard {
    let (rating, tier) = match &result.team {
        Some(team) => (team.rating, team.tier),
        None => (result.rating, result.tier),
    };
    let personal_2v2 = result.team.map(|_| PersonalRating {
        rating: result.rating.after,
        change: signed_change(result.rating),
    });

    PostMatchCard {
        is_win: is_win(result),
        opponents,
        tier: tier_name(tier.after),
        tier_change: tier_change(tier),
        rating: rating.after,
        rating_change: signed_change(rating),
        personal_2v2,
        match_page: None,
    }
}

/// a win always raises the player's own elo; a loss at the floor leaves it where it was
pub fn is_win(result: &MatchResult) -> bool {
    result.rating.after > result.rating.before
}

pub fn signed_change(change: Change) -> i32 {
    let after = i64::from(change.after);
    let before = i64::from(change.before);

    i32::try_from(after - before).unwrap_or(0)
}

/// "Gold 3" for index 22; none for an index outside the ranked tiers
pub fn tier_name(index: u32) -> Option<String> {
    if index == DIAMOND_TIER_INDEX {
        return Some("Diamond".to_string());
    }

    let position = index.checked_sub(1)?;
    let rank = RANKS_WITH_SUBDIVISIONS.get((position / TIERS_PER_RANK) as usize)?;
    let subdivision = position % TIERS_PER_RANK;

    Some(format!("{rank} {subdivision}"))
}

fn tier_change(tier: Change) -> Option<TierChange> {
    match tier.after.cmp(&tier.before) {
        std::cmp::Ordering::Greater => Some(TierChange::Up),
        std::cmp::Ordering::Less => Some(TierChange::Down),
        std::cmp::Ordering::Equal => None,
    }
}

#[cfg(test)]
mod tests {
    use brawltome_detection::TeamResult;

    use super::*;

    fn change(before: u32, after: u32) -> Change {
        Change { before, after }
    }

    fn shinigami() -> PlayerHead {
        PlayerHead {
            brawlhalla_id: 91_913_839,
            name: "Shinigami".to_string(),
            legend: Some("Hattori".to_string()),
        }
    }

    #[test]
    fn names_tiers_the_way_the_game_does() {
        // seen live: team elo 882 was Tin 5, 1003 Bronze 3, 1v1 1652 Gold 5
        assert_eq!(tier_name(6).as_deref(), Some("Tin 5"));
        assert_eq!(tier_name(10).as_deref(), Some("Bronze 3"));
        assert_eq!(tier_name(24).as_deref(), Some("Gold 5"));
        assert_eq!(tier_name(1).as_deref(), Some("Tin 0"));
        assert_eq!(tier_name(25).as_deref(), Some("Platinum 0"));
        assert_eq!(tier_name(30).as_deref(), Some("Platinum 5"));
        assert_eq!(tier_name(31).as_deref(), Some("Diamond"));
        assert_eq!(tier_name(0), None);
        assert_eq!(tier_name(32), None);
    }

    #[test]
    fn a_1v1_win_shows_the_new_elo_and_its_gain() {
        let result = MatchResult {
            rating: change(1652, 1667),
            tier: change(24, 24),
            team: None,
        };

        let card = post_match_card(vec![shinigami()], &result);

        assert_eq!(
            card,
            PostMatchCard {
                is_win: true,
                opponents: vec![shinigami()],
                tier: Some("Gold 5".to_string()),
                tier_change: None,
                rating: 1667,
                rating_change: 15,
                personal_2v2: None,
                match_page: None,
            }
        );
    }

    #[test]
    fn a_loss_that_drops_a_tier_says_so() {
        let result = MatchResult {
            rating: change(1636, 1620),
            tier: change(25, 24),
            team: None,
        };

        let card = post_match_card(vec![shinigami()], &result);

        assert!(!card.is_win);
        assert_eq!(card.rating_change, -16);
        assert_eq!(card.tier_change, Some(TierChange::Down));
    }

    #[test]
    fn a_2v2_shows_the_team_elo_and_tier_with_the_personal_elo_beside() {
        let result = MatchResult {
            rating: change(1903, 1927),
            tier: change(31, 31),
            team: Some(TeamResult {
                rating: change(882, 1003),
                tier: change(6, 10),
            }),
        };

        let card = post_match_card(vec![shinigami(), shinigami()], &result);

        assert!(card.is_win);
        assert_eq!(card.rating, 1003);
        assert_eq!(card.rating_change, 121);
        assert_eq!(card.tier.as_deref(), Some("Bronze 3"));
        assert_eq!(card.tier_change, Some(TierChange::Up));
        assert_eq!(
            card.personal_2v2,
            Some(PersonalRating {
                rating: 1927,
                change: 24
            })
        );
    }

    #[test]
    fn serializes_to_the_page_shape() {
        let result = MatchResult {
            rating: change(1652, 1667),
            tier: change(24, 25),
            team: None,
        };

        let value = serde_json::to_value(post_match_card(vec![shinigami()], &result)).unwrap();

        assert_eq!(value["isWin"], true);
        assert_eq!(value["tierChange"], "up");
        assert_eq!(value["ratingChange"], 15);
        assert_eq!(value["personal2v2"], serde_json::Value::Null);
        assert_eq!(value["matchPage"], serde_json::Value::Null);
        assert_eq!(value["opponents"][0]["brawlhallaId"], 91_913_839);
    }
}
