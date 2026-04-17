import type { PlayerLinkRepo } from '../playerLink.repo'

export interface ResolveSteamLinkDeps {
  playerLinkRepo: PlayerLinkRepo
  bhapi: {
    searchBySteamId(
      steamId: string,
      opts?: { caller?: string },
    ): Promise<{ brawlhalla_id: number; name: string } | null>
  }
}

export async function resolveSteamLink(
  deps: ResolveSteamLinkDeps,
  params: { userId: string; steamId: string },
): Promise<void> {
  const link = await deps.playerLinkRepo.findByUserId(params.userId)
  if (!link || link.status !== 'pending') return

  const result = await deps.bhapi.searchBySteamId(params.steamId, { caller: 'background' })

  if (!result) {
    await deps.playerLinkRepo.setStatus(params.userId, 'failed')
    return
  }

  const existingClaim = await deps.playerLinkRepo.findByBrawlhallaId(result.brawlhalla_id)
  if (existingClaim && existingClaim.userId !== params.userId) {
    await deps.playerLinkRepo.setStatus(params.userId, 'conflict')
    return
  }

  try {
    await deps.playerLinkRepo.resolve(params.userId, result.brawlhalla_id)
  } catch (err) {
    // Unique constraint violation on brawlhallaId = concurrent claim race
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('uq_player_link_brawlhalla') || msg.includes('unique') || msg.includes('duplicate')) {
      await deps.playerLinkRepo.setStatus(params.userId, 'conflict')
      return
    }
    throw err
  }
}
