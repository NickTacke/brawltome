type PlayerReference = {
  brawlhallaId: number
  name: string
  bestLegendNameKey?: string | null
  legacyRating?: number | null
}

type PlayerReferenceClient<
  TPlayer extends { name: string; bestLegendNameKey?: string | null } | null,
  TRanked,
  TCareer extends { snapshot?: unknown } | null,
> = {
  player: {
    referenceById: { query(input: { id: number }): Promise<PlayerReference | null> }
    rankedById: { query(input: { id: number }): Promise<TRanked> }
    careerById: { query(input: { id: number }): Promise<TCareer> }
    byId: { query(input: { id: number }): Promise<TPlayer> }
  }
}

export async function loadPlayerWithReference<
  TPlayer extends { name: string; bestLegendNameKey?: string | null } | null,
  TRanked,
  TCareer extends { snapshot?: unknown } | null,
>(client: PlayerReferenceClient<TPlayer, TRanked, TCareer>, id: number) {
  const [reference, ranked, career, player] = await Promise.all([
    client.player.referenceById.query({ id }),
    client.player.rankedById.query({ id }),
    client.player.careerById.query({ id }),
    client.player.byId.query({ id }),
  ])

  if (!reference) return { reference: null, player: null }

  const legacyBestLegend = player?.bestLegendNameKey
  const profile = player ?? {
    brawlhallaId: reference.brawlhallaId,
    name: reference.name,
    aliases: [],
    clan: null,
  }
  return {
    reference,
    player: {
      ...profile,
      name: reference.name,
      bestLegendNameKey:
        reference.bestLegendNameKey ?? (career?.snapshot === null || career === null ? legacyBestLegend : null) ?? null,
      ...(reference.legacyRating !== undefined ? { legacyRating: reference.legacyRating } : {}),
      currentSeason: ranked,
      career,
    },
  }
}
