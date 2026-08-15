type PlayerReference = {
  brawlhallaId: number
  name: string
  aliases: string[]
  bestLegendNameKey?: string | null
  legacyRating?: number | null
}

type ClanMembership = { clanId: number; clanName: string } | null

type PlayerReferenceClient<TRanked, TCareer> = {
  player: {
    referenceById: { query(input: { id: number }): Promise<PlayerReference | null> }
    rankedById: { query(input: { id: number }): Promise<TRanked> }
    careerById: { query(input: { id: number }): Promise<TCareer> }
  }
  clan: {
    membershipByPlayerId: { query(input: { id: number }): Promise<ClanMembership> }
  }
}

export async function loadPlayerWithReference<TRanked, TCareer>(
  client: PlayerReferenceClient<TRanked, TCareer>,
  id: number,
) {
  const [reference, ranked, career, clan] = await Promise.all([
    client.player.referenceById.query({ id }),
    client.player.rankedById.query({ id }),
    client.player.careerById.query({ id }),
    client.clan.membershipByPlayerId.query({ id }),
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
    },
  }
}
