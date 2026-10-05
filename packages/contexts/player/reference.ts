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

export type CanonicalPlayerNameEvidence = { name: string; observedAt?: Date | null }

export function isUsablePlayerName(name: string, brawlhallaId: number): boolean {
  return name !== `Player ${brawlhallaId}` && [...name].length <= 256 && /[^\p{Separator}\p{Format}]/u.test(name)
}

// Canonical name = the usable name observed most recently. Evidence without an observation time (legacy
// references) only wins when nothing timestamped is usable; ties keep the historical career > ranked order.
export function selectCanonicalPlayerName<T extends CanonicalPlayerNameEvidence>(input: {
  brawlhallaId: number
  ranked: T | null
  career: T | null
  leaderboard?: T | null
}): T | null {
  let selected: T | null = null
  let selectedAt = Number.NEGATIVE_INFINITY
  for (const candidate of [input.career, input.ranked, input.leaderboard ?? null]) {
    if (!candidate || !isUsablePlayerName(candidate.name, input.brawlhallaId)) continue
    const observedAt = candidate.observedAt ? candidate.observedAt.getTime() : Number.NEGATIVE_INFINITY
    if (!selected || observedAt > selectedAt) {
      selected = candidate
      selectedAt = observedAt
    }
  }
  return selected
}
