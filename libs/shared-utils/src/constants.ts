// Time periods

// Grace period for preserving Valhallan tier after janitor confirmation
// Players who were confirmed as Valhallan by the janitor within this window
// will maintain their Valhallan tier even if the API returns a lower tier
export const VALHALLAN_GRACE_PERIOD = 2 * 60 * 60 * 1000; // 2 hours in ms
