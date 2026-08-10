const RANKED_FRESHNESS_MS = 3_600_000
const CAREER_FRESHNESS_MS = 43_200_000

export interface PlayerRefreshTimestamps {
  currentSeason?: { lastSuccessAt?: Date | string | null } | null
  career?: { lastSuccessAt?: Date | string | null } | null
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
  const careerUpdatedAt = timestamp(player.career?.lastSuccessAt)

  return {
    ranked: rankedUpdatedAt === 0 || now - rankedUpdatedAt > RANKED_FRESHNESS_MS,
    stats: careerUpdatedAt === 0 || now - careerUpdatedAt > CAREER_FRESHNESS_MS,
  }
}

export function hasCompletedPlayerRefresh(
  initial: PlayerRefreshTimestamps | null,
  next: PlayerRefreshTimestamps | null,
  pending: PendingPlayerSections,
): boolean {
  if (!next) return false

  const rankedAdvanced = timestamp(next.currentSeason?.lastSuccessAt) > timestamp(initial?.currentSeason?.lastSuccessAt)
  const careerAdvanced = timestamp(next.career?.lastSuccessAt) > timestamp(initial?.career?.lastSuccessAt)

  return (!pending.ranked || rankedAdvanced) && (!pending.stats || careerAdvanced)
}
