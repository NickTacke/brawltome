use serde::{Deserialize, Serialize};
use std::time::Duration;

const DEFAULT_API_BASE: &str = "https://brawltome.app";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OpponentData {
    #[serde(rename = "brawlhallaId")]
    pub brawlhalla_id: u32,
    pub name: String,
    pub rating: u32,
    #[serde(rename = "peakRating")]
    pub peak_rating: u32,
    pub playtime: f64,
    pub tier: String,
    pub region: String,
    #[serde(rename = "legendKey")]
    pub legend_key: String,
    #[serde(rename = "winRate")]
    pub win_rate: f64,
}

pub struct ApiClient {
    client: reqwest::Client,
    base_url: String,
}

impl ApiClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into();
        let base_url = if base_url.is_empty() {
            DEFAULT_API_BASE.to_string()
        } else {
            base_url
        };
        Self {
            client: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("Failed to build HTTP client"),
            base_url,
        }
    }

    pub async fn fetch_opponent(&self, bhid: u32) -> Result<OpponentData, String> {
        let url = format!("{}/api/overlay/opponent/{}", self.base_url, bhid);
        self.client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("request failed: {e}"))?
            .json::<OpponentData>()
            .await
            .map_err(|e| format!("parse failed: {e}"))
    }
}
