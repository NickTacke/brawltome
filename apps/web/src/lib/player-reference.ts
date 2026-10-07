type PlayerReference = {
  brawlhallaId: number
  name: string
  aliases: string[]
  bestLegendNameKey?: string | null
  legacyRating?: number | null
}

type ClanMembership = { clanId: number; clanName: string } | null

export type LeaderboardStanding = {
  region: string
  rating: number
  peakRating: number
  tier: string | null
  wins: number
  games: number
  observedAt: string
}

type PlayerReferenceClient<TRanked, TCareer> = {
  player: {
    referenceById: { query(input: { id: number }): Promise<PlayerReference | null> }
    rankedById: { query(input: { id: number }): Promise<TRanked> }
    careerById: { query(input: { id: number }): Promise<TCareer> }
    leaderboardStandingById: { query(input: { id: number }): Promise<LeaderboardStanding | null> }
  }
  clan: {
    membershipByPlayerId: { query(input: { id: number }): Promise<ClanMembership> }
  }
}

export async function loadPlayerWithReference<TRanked, TCareer>(
  client: PlayerReferenceClient<TRanked, TCareer>,
  id: number,
) {
  // undefined means the lookup failed (unknown); null means the player has no observed standing.
  const [reference, ranked, career, clan, leaderboardStanding] = await Promise.all([
    client.player.referenceById.query({ id }),
    client.player.rankedById.query({ id }),
    client.player.careerById.query({ id }),
    client.clan.membershipByPlayerId.query({ id }),
    // Best effort: the profile renders without it.
    client.player.leaderboardStandingById
      .query({ id })
      .catch(() => undefined),
  ])

  if (!reference) return { reference: null, player: null }

  return {
    reference,
    player: {
      brawlhallaId: reference.brawlhallaId,
      name: reference.name,
      aliases: reference.aliases,
      clan,
      bestLegendNameKey: reference.bestLegendNameKey ?? null,
      ...(reference.legacyRating !== undefined ? { legacyRating: reference.legacyRating } : {}),
      currentSeason: ranked,
      career,
      ...(leaderboardStanding !== undefined ? { leaderboardStanding } : {}),
    },
  }
}

/** A failed standing lookup (absent field) keeps the last standing read successfully; a successful read replaces it. */
export function keepLastStanding<T extends { leaderboardStanding?: LeaderboardStanding | null }>(
  previous: LeaderboardStanding | null | undefined,
  next: T | null,
): T | null {
  if (!next || next.leaderboardStanding !== undefined || previous === undefined) return next
  return { ...next, leaderboardStanding: previous }
}
