type PlayerReference = {
  brawlhallaId: number
  name: string
}

type PlayerReferenceClient<TPlayer extends { name: string } | null> = {
  player: {
    referenceById: { query(input: { id: number }): Promise<PlayerReference | null> }
    byId: { query(input: { id: number }): Promise<TPlayer> }
  }
}

export async function loadPlayerWithReference<TPlayer extends { name: string } | null>(
  client: PlayerReferenceClient<TPlayer>,
  id: number,
) {
  const [reference, player] = await Promise.all([
    client.player.referenceById.query({ id }),
    client.player.byId.query({ id }),
  ])

  return {
    reference,
    player: reference && player ? { ...player, name: reference.name } : null,
  }
}
