// Tiered TTLs (milliseconds)
export const TIERED_TTL = {
  hot: { ranked: 1 * 60 * 60 * 1000, stats: 6 * 60 * 60 * 1000 },
  warm: { ranked: 6 * 60 * 60 * 1000, stats: 24 * 60 * 60 * 1000 },
  cold: { ranked: Number.POSITIVE_INFINITY, stats: Number.POSITIVE_INFINITY },
} as const

export const CLAN_TTL_MS = 60 * 60 * 1000
