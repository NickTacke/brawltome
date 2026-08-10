import { TIERED_TTL } from '@brawltome/shared/constants'

export interface PlayerRefreshTimestamps {
  currentSeason?: { lastSuccessAt?: Date | string | null } | null
  statsLastUpdated?: Date | string | null
}

export interface PendingPlayerSections {
  ranked: boolean
  stats: boolean
}

function timestamp(value: Date | string | null | undefined): number {
  if (!value) return 0
  const milliseconds = new Date(value).getTime()
  return Number.isFinite(milliseconds) ? milliseconds : 0
}

export function getPendingPlayerSections(
  player: PlayerRefreshTimestamps | null,
  now = Date.now(),
): PendingPlayerSections {
  if (!player) return { ranked: true, stats: true }

  const rankedUpdatedAt = timestamp(player.currentSeason?.lastSuccessAt)
  const statsUpdatedAt = timestamp(player.statsLastUpdated)

  return {
    ranked: rankedUpdatedAt === 0 || now - rankedUpdatedAt > TIERED_TTL.hot.ranked,
    stats: statsUpdatedAt === 0 || now - statsUpdatedAt > TIERED_TTL.hot.stats,
  }
}

export function hasCompletedPlayerRefresh(
  initial: PlayerRefreshTimestamps | null,
  next: PlayerRefreshTimestamps | null,
  pending: PendingPlayerSections,
): boolean {
  if (!next) return false

  const rankedAdvanced = timestamp(next.currentSeason?.lastSuccessAt) > timestamp(initial?.currentSeason?.lastSuccessAt)
  const statsAdvanced = timestamp(next.statsLastUpdated) > timestamp(initial?.statsLastUpdated)

  return (!pending.ranked || rankedAdvanced) && (!pending.stats || statsAdvanced)
}
