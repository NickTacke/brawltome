// Minimum tokens required to attempt discovery (fetching a new player not in DB)
export const DISCOVERY_MIN_TOKENS = 50;

// Search service token threshold when deciding whether to hit the external API
export const SEARCH_API_MIN_TOKENS = 50;

// Worker refresh thresholds (ranked is prioritized over stats)
export const REFRESH_STATS_MIN_TOKENS = 40;
export const REFRESH_RANKED_MIN_TOKENS = 20;

// Janitor should only run during “idle” periods
export const JANITOR_IDLE_MIN_TOKENS = 100;
