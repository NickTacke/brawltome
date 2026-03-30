export { CLAN_TTL_MS, TIERED_TTL } from '@brawltome/shared'

// Token thresholds
export const DISCOVERY_MIN_TOKENS = 50
export const JANITOR_MIN_TOKENS = 100

// Queue limits
export const QUEUE_HARD_CAP = 200
export const QUEUE_DISCOVERY_CAP = 100
export const DEDUP_TTL_RANKED_SEC = 3600
export const DEDUP_TTL_STATS_SEC = 43200
export const DEDUP_TTL_CLAN_SEC = 3600

// Rate limits
export const RATE_LIMITS = {
  discovery: { max: 20, windowSec: 15 * 60 },
  refresh: { max: 20, windowSec: 15 * 60 },
  'discovery:global': { max: 30, windowSec: 15 * 60 },
} as const

export type RateLimitAction = keyof typeof RATE_LIMITS

// Weapon name normalization
export const WEAPON_NAME_MAP: Record<string, string> = {
  Fists: 'Gauntlets',
  Pistol: 'Blasters',
  Katar: 'Katars',
  RocketLance: 'Lance',
  Chakram: 'Chakrams',
}
