import type { PlayerLink, PlayerLinkRepo } from '../playerLink.repo'

export interface LinkPlayerDeps {
  playerLinkRepo: PlayerLinkRepo
}

export async function linkPlayer(
  deps: LinkPlayerDeps,
  params: { userId: string; steamId: string },
): Promise<PlayerLink> {
  const existing = await deps.playerLinkRepo.findByUserId(params.userId)
  if (existing) {
    if (existing.status === 'linked' || existing.status === 'pending') {
      throw new Error('User already has a linked player. Unlink first.')
    }
    // Clear stale failed/conflict link so user can retry
    await deps.playerLinkRepo.deleteByUserId(params.userId)
  }
  return deps.playerLinkRepo.createPending(params)
}
