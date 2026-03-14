// Tiered TTLs (milliseconds)
export const TIERED_TTL = {
  hot: { ranked: 1 * 60 * 60 * 1000, stats: 6 * 60 * 60 * 1000 },
  warm: { ranked: 6 * 60 * 60 * 1000, stats: 24 * 60 * 60 * 1000 },
  cold: { ranked: Number.POSITIVE_INFINITY, stats: Number.POSITIVE_INFINITY },
} as const

// Token thresholds
export const DISCOVERY_MIN_TOKENS = 50
export const JANITOR_MIN_TOKENS = 100

// Queue limits
export const QUEUE_HARD_CAP = 200
export const QUEUE_DISCOVERY_CAP = 100
export const DEDUP_TTL_RANKED_SEC = 3600
export const DEDUP_TTL_STATS_SEC = 43200
export const DEDUP_TTL_CLAN_SEC = 3600

// Weapon name normalization
export const WEAPON_NAME_MAP: Record<string, string> = {
  Fists: 'Gauntlets',
  Pistol: 'Blasters',
  Katar: 'Katars',
  RocketLance: 'Lance',
  Chakram: 'Chakrams',
}
