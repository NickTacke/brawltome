type PlayerReference = {
  brawlhallaId: number
  name: string
}

type PlayerReferenceClient<TPlayer extends { name: string } | null, TRanked> = {
  player: {
    referenceById: { query(input: { id: number }): Promise<PlayerReference | null> }
    rankedById: { query(input: { id: number }): Promise<TRanked> }
    byId: { query(input: { id: number }): Promise<TPlayer> }
  }
}

export async function loadPlayerWithReference<TPlayer extends { name: string } | null, TRanked>(
  client: PlayerReferenceClient<TPlayer, TRanked>,
  id: number,
) {
  const [reference, ranked, player] = await Promise.all([
    client.player.referenceById.query({ id }),
    client.player.rankedById.query({ id }),
    client.player.byId.query({ id }),
  ])

  return {
    reference,
    player: reference && player ? { ...player, name: reference.name, currentSeason: ranked } : null,
  }
}
