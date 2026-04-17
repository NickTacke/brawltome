import type { PlayerLink, PlayerLinkRepo } from '../playerLink.repo'

export class PlayerAlreadyLinkedError extends Error {
  constructor() {
    super('User already has a linked player. Unlink first.')
    this.name = 'PlayerAlreadyLinkedError'
  }
}

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
      throw new PlayerAlreadyLinkedError()
    }
    // Clear stale failed/conflict link so user can retry
    await deps.playerLinkRepo.deleteByUserId(params.userId)
  }
  try {
    return await deps.playerLinkRepo.createPending(params)
  } catch (err) {
    // Unique constraint race: another request created a link concurrently
    const latest = await deps.playerLinkRepo.findByUserId(params.userId)
    if (latest?.status === 'linked' || latest?.status === 'pending') {
      throw new PlayerAlreadyLinkedError()
    }
    throw err
  }
}
