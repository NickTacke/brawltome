use std::collections::HashMap;
use std::num::NonZeroU64;
use std::time::Duration;

use brawltome_contracts::generated::types::{
    DesktopRankedLookup, PlayerRankedProfileInnerFreshness, RefreshOutcome,
};
use brawltome_contracts::generated::Client;
use serde::Serialize;

const DEFAULT_API_BASE: &str = "https://api.brawltome.app";

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OpponentFreshness {
    Fresh,
    Stale,
    Unavailable,
    Missing,
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RefreshState {
    Idle,
    Refreshing,
    VerificationRequired,
    RateLimited,
    TemporarilyUnavailable,
    ApiFailure,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpponentData {
    pub brawlhalla_id: u32,
    pub name: Option<String>,
    pub rating: Option<i32>,
    pub peak_rating: Option<i32>,
    pub tier: Option<String>,
    pub region: Option<String>,
    pub legend_key: Option<String>,
    pub win_rate: Option<f64>,
    pub freshness: OpponentFreshness,
    pub refresh_state: RefreshState,
    pub retry_after_seconds: Option<u32>,
}

impl OpponentData {
    pub fn api_failure(brawlhalla_id: u32) -> Self {
        Self {
            brawlhalla_id,
            name: None,
            rating: None,
            peak_rating: None,
            tier: None,
            region: None,
            legend_key: None,
            win_rate: None,
            freshness: OpponentFreshness::Missing,
            refresh_state: RefreshState::ApiFailure,
            retry_after_seconds: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OpponentLookup {
    pub opponent: OpponentData,
    pub poll_after: Option<Duration>,
}

pub fn finish_poll_deadline<T>(
    opponents: &mut HashMap<u32, OpponentData>,
    pending: &HashMap<u32, T>,
) -> bool {
    for brawlhalla_id in pending.keys() {
        if let Some(opponent) = opponents.get_mut(brawlhalla_id) {
            opponent.refresh_state = RefreshState::Idle;
        }
    }
    !pending.is_empty()
}

pub struct ApiClient {
    client: Client,
}

impl ApiClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into();
        let base_url = if base_url.is_empty() {
            DEFAULT_API_BASE
        } else {
            base_url.trim_end_matches('/')
        };
        Self {
            client: Client::new(base_url),
        }
    }

    pub async fn fetch_opponent(&self, bhid: u32) -> Result<OpponentLookup, String> {
        if bhid > i32::MAX as u32 {
            return Err("Brawlhalla ID exceeds the canonical maximum".to_string());
        }
        let brawlhalla_id = NonZeroU64::new(u64::from(bhid))
            .ok_or_else(|| "Brawlhalla ID must be positive".to_string())?;
        let response = self
            .client
            .get_desktop_ranked_lookup(brawlhalla_id)
            .await
            .map_err(|_| "desktop ranked lookup failed".to_string())?
            .into_inner();
        map_lookup(bhid, &response)
    }
}

fn map_lookup(expected_bhid: u32, lookup: &DesktopRankedLookup) -> Result<OpponentLookup, String> {
    if lookup
        .player
        .as_ref()
        .is_some_and(|player| player.brawlhalla_id.get() != u64::from(expected_bhid))
    {
        return Err("desktop lookup returned a mismatched player ID".to_string());
    }
    let profile = lookup.ranked.0.as_ref();
    if profile.is_some_and(|ranked| ranked.brawlhalla_id.get() != u64::from(expected_bhid)) {
        return Err("desktop lookup returned a mismatched ranked player ID".to_string());
    }

    let snapshot = profile.and_then(|ranked| ranked.snapshot.0.as_ref());
    let freshness = match profile.map(|ranked| ranked.freshness) {
        Some(PlayerRankedProfileInnerFreshness::Fresh) => OpponentFreshness::Fresh,
        Some(PlayerRankedProfileInnerFreshness::Stale) => OpponentFreshness::Stale,
        Some(PlayerRankedProfileInnerFreshness::Unavailable) => OpponentFreshness::Unavailable,
        None if lookup.player.is_some() => OpponentFreshness::Unavailable,
        None => OpponentFreshness::Missing,
    };
    let (rating, peak_rating, tier, region, legend_key, win_rate) = match snapshot {
        Some(snapshot) => {
            let one_vs_one = &snapshot.one_vs_one;
            let win_rate = (one_vs_one.games > 0).then(|| {
                ((f64::from(one_vs_one.wins) / f64::from(one_vs_one.games)) * 1_000.0).round()
                    / 10.0
            });
            (
                Some(one_vs_one.rating),
                Some(one_vs_one.peak_rating),
                Some(one_vs_one.tier.to_string()),
                one_vs_one.region.as_ref().map(|region| region.to_string()),
                snapshot
                    .main_legend
                    .as_ref()
                    .map(|legend| legend.legend_name_key.to_string()),
                win_rate,
            )
        }
        None => (None, None, None, None, None, None),
    };

    let (refresh_state, poll_after, retry_after_seconds) = match &lookup.refresh {
        RefreshOutcome::Accepted { retry, .. }
        | RefreshOutcome::AlreadyRefreshing { retry, .. } => (
            RefreshState::Refreshing,
            Some(Duration::from_secs(u64::from(retry.after_seconds.get()))),
            None,
        ),
        RefreshOutcome::NotNeeded { .. } => (RefreshState::Idle, None, None),
        RefreshOutcome::VerificationRequired { .. } => {
            (RefreshState::VerificationRequired, None, None)
        }
        RefreshOutcome::RateLimited { retry } => (
            RefreshState::RateLimited,
            None,
            Some(retry.after_seconds.get()),
        ),
        RefreshOutcome::TemporarilyUnavailable { retry } => (
            RefreshState::TemporarilyUnavailable,
            None,
            Some(retry.after_seconds.get()),
        ),
    };

    Ok(OpponentLookup {
        opponent: OpponentData {
            brawlhalla_id: expected_bhid,
            name: lookup.player.as_ref().map(|player| player.name.clone()),
            rating,
            peak_rating,
            tier,
            region,
            legend_key,
            win_rate,
            freshness,
            refresh_state,
            retry_after_seconds,
        },
        poll_after,
    })
}
