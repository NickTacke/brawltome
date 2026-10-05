export type PlayerReference = {
  brawlhallaId: number
  name: string
  aliases: string[]
  bestLegendNameKey?: string | null
  legacyRating?: number | null
}

export interface PlayerReferenceQueries {
  byId(brawlhallaId: number): Promise<PlayerReference | null>
}

export type CanonicalPlayerNameEvidence = { name: string; observedAt?: Date | null; legacy?: boolean }

export function isUsablePlayerName(name: string, brawlhallaId: number): boolean {
  return name !== `Player ${brawlhallaId}` && [...name].length <= 256 && /[^\p{Separator}\p{Format}]/u.test(name)
}

function newestUsable<T extends CanonicalPlayerNameEvidence>(brawlhallaId: number, candidates: (T | null)[]): T | null {
  let selected: T | null = null
  let selectedAt = Number.NEGATIVE_INFINITY
  for (const candidate of candidates) {
    if (!candidate || !isUsablePlayerName(candidate.name, brawlhallaId)) continue
    const observedAt = candidate.observedAt ? candidate.observedAt.getTime() : Number.NEGATIVE_INFINITY
    if (!selected || observedAt > selectedAt) {
      selected = candidate
      selectedAt = observedAt
    }
  }
  return selected
}

// Live V0 profile names are authoritative: the newest one wins, ties keep career > ranked. V1 leaderboard names
// are heavily cached upstream, so they only name players without a live V0 observation (they stay searchable as
// aliases otherwise). Legacy imports and untimestamped references come last.
export function selectCanonicalPlayerName<T extends CanonicalPlayerNameEvidence>(input: {
  brawlhallaId: number
  ranked: T | null
  career: T | null
  leaderboard?: T | null
}): T | null {
  const profiles = [input.career, input.ranked]
  const live = (candidate: T | null) => (candidate?.observedAt && !candidate.legacy ? candidate : null)
  return (
    newestUsable(input.brawlhallaId, profiles.map(live)) ??
    newestUsable(input.brawlhallaId, [input.leaderboard ?? null]) ??
    newestUsable(input.brawlhallaId, profiles)
  )
}
