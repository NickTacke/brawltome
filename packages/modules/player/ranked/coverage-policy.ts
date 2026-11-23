const dayMs = 24 * 60 * 60 * 1000

export type RankedCoverageBand = '2200+' | '2000-2199' | '1800-1999'

export type RankedCoverageBandPolicy = {
  band: RankedCoverageBand
  minimumRating: number
  refreshIntervalMs: number
}

// who ranked coverage keeps fresh and how often, highest band first: a player belongs to the first band they reach
export const rankedCoveragePolicy = {
  bands: [
    { band: '2200+', minimumRating: 2200, refreshIntervalMs: dayMs },
    { band: '2000-2199', minimumRating: 2000, refreshIntervalMs: 2 * dayMs },
    { band: '1800-1999', minimumRating: 1800, refreshIntervalMs: 7 * dayMs },
  ],
  // a board observation only moves when the player's standing changes, so this means 1v1 ranked played within the
  // window; a player who stopped playing has a profile that stops moving
  playedRankedWithinMs: 7 * dayMs,
  // a dead-lettered refresh rests this long, so a profile that keeps failing neither spends the budget nor pages
  failedBackoffMs: 7 * dayMs,
} as const satisfies {
  bands: readonly RankedCoverageBandPolicy[]
  playedRankedWithinMs: number
  failedBackoffMs: number
}

export const rankedCoverageBands: readonly RankedCoverageBand[] = rankedCoveragePolicy.bands.map(({ band }) => band)

// the lowest band's line: players below it are not covered
export const rankedCoverageMinimumRating = Math.min(
  ...rankedCoveragePolicy.bands.map(({ minimumRating }) => minimumRating),
)

// the player's 1v1 rating on the boards and when their V0 ranked profile last refreshed, null when it never did
export type RankedCoverageCandidate = { brawlhallaId: number; rating: number; lastSuccessAt: Date | null }

export type RankedCoverageAttempt = { lastPlannedAt: Date | null; lastFailedAt: Date | null }

// dueAt is when the profile fell outside its band's interval, null when it never refreshed
export type DueCoverageRefresh = {
  brawlhallaId: number
  band: RankedCoverageBand
  lastSuccessAt: Date | null
  dueAt: Date | null
}

export function coverageBandOf(rating: number): RankedCoverageBandPolicy | null {
  return rankedCoveragePolicy.bands.find(({ minimumRating }) => rating >= minimumRating) ?? null
}

function isWithin(at: Date | null, windowMs: number, now: number): boolean {
  return at !== null && now - at.getTime() < windowMs
}

/** Whether the player's ranked profile is newer than their band's refresh interval. */
export function isCoverageFresh(candidate: RankedCoverageCandidate, now: number): boolean {
  const band = coverageBandOf(candidate.rating)

  if (!band) return false

  return isWithin(candidate.lastSuccessAt, band.refreshIntervalMs, now)
}

function isDue(
  candidate: RankedCoverageCandidate,
  band: RankedCoverageBandPolicy,
  attempt: RankedCoverageAttempt | undefined,
  now: number,
): boolean {
  if (isWithin(candidate.lastSuccessAt, band.refreshIntervalMs, now)) return false

  // one planned refresh per interval, even when it settled without moving the profile
  if (attempt && isWithin(attempt.lastPlannedAt, band.refreshIntervalMs, now)) return false

  if (attempt && isWithin(attempt.lastFailedAt, rankedCoveragePolicy.failedBackoffMs, now)) return false

  return true
}

// by how long each has been due, not by age: a weekly player a day overdue waits behind a daily one two days overdue
function compareMostOverdueFirst(left: DueCoverageRefresh, right: DueCoverageRefresh): number {
  const leftDueAt = left.dueAt?.getTime() ?? Number.NEGATIVE_INFINITY
  const rightDueAt = right.dueAt?.getTime() ?? Number.NEGATIVE_INFINITY

  if (leftDueAt !== rightDueAt) return leftDueAt < rightDueAt ? -1 : 1

  return left.brawlhallaId - right.brawlhallaId
}

function dueAtOf(lastSuccessAt: Date | null, band: RankedCoverageBandPolicy): Date | null {
  if (lastSuccessAt === null) return null

  return new Date(lastSuccessAt.getTime() + band.refreshIntervalMs)
}

/** Players whose ranked profile is older than their band's interval, never-refreshed first, then the most overdue. */
export function dueCoverageRefreshes(input: {
  candidates: readonly RankedCoverageCandidate[]
  attempts: ReadonlyMap<number, RankedCoverageAttempt>
  now: number
}): DueCoverageRefresh[] {
  const due: DueCoverageRefresh[] = []

  for (const candidate of input.candidates) {
    const band = coverageBandOf(candidate.rating)

    if (!band || !isDue(candidate, band, input.attempts.get(candidate.brawlhallaId), input.now)) continue

    due.push({
      brawlhallaId: candidate.brawlhallaId,
      band: band.band,
      lastSuccessAt: candidate.lastSuccessAt,
      dueAt: dueAtOf(candidate.lastSuccessAt, band),
    })
  }

  return due.sort(compareMostOverdueFirst)
}

export type RankedCoverageAge = 'under_1_day' | '1_to_2_days' | '2_to_7_days' | 'over_7_days' | 'missing'

export const rankedCoverageAges: readonly RankedCoverageAge[] = [
  'under_1_day',
  '1_to_2_days',
  '2_to_7_days',
  'over_7_days',
  'missing',
]

function ageOf(lastSuccessAt: Date | null, now: number): RankedCoverageAge {
  if (lastSuccessAt === null) return 'missing'

  const ageMs = now - lastSuccessAt.getTime()

  if (ageMs < dayMs) return 'under_1_day'

  if (ageMs < 2 * dayMs) return '1_to_2_days'

  if (ageMs < 7 * dayMs) return '2_to_7_days'

  return 'over_7_days'
}

export type RankedCoverageSummary = { band: RankedCoverageBand; age: RankedCoverageAge; players: number }

/** How many players of each band have a ranked profile of each age, every combination included. */
export function summarizeCoverage(
  candidates: readonly RankedCoverageCandidate[],
  now: number,
): RankedCoverageSummary[] {
  const counts = new Map<string, number>()

  for (const candidate of candidates) {
    const band = coverageBandOf(candidate.rating)

    if (!band) continue

    const key = `${band.band}|${ageOf(candidate.lastSuccessAt, now)}`

    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return rankedCoverageBands.flatMap((band) =>
    rankedCoverageAges.map((age) => ({ band, age, players: counts.get(`${band}|${age}`) ?? 0 })),
  )
}
