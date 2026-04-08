import type { PlayerLinkRepo } from '../playerLink.repo'

export interface ResolveSteamLinkDeps {
  playerLinkRepo: PlayerLinkRepo
  bhapi: { searchBySteamId(steamId: string): Promise<{ brawlhalla_id: number; name: string } | null> }
}

export async function resolveSteamLink(
  deps: ResolveSteamLinkDeps,
  params: { userId: string; steamId: string },
): Promise<void> {
  const link = await deps.playerLinkRepo.findByUserId(params.userId)
  if (!link || link.status !== 'pending') return

  const result = await deps.bhapi.searchBySteamId(params.steamId)

  if (!result) {
    await deps.playerLinkRepo.setStatus(params.userId, 'failed')
    return
  }

  const existingClaim = await deps.playerLinkRepo.findByBrawlhallaId(result.brawlhalla_id)
  if (existingClaim && existingClaim.userId !== params.userId) {
    await deps.playerLinkRepo.setStatus(params.userId, 'conflict')
    return
  }

  await deps.playerLinkRepo.resolve(params.userId, result.brawlhalla_id)
}
