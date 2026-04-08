import type { PlayerLinkRepo } from '../playerLink.repo'

export interface UnlinkPlayerDeps {
  playerLinkRepo: PlayerLinkRepo
}

export async function unlinkPlayer(deps: UnlinkPlayerDeps, userId: string): Promise<void> {
  await deps.playerLinkRepo.deleteByUserId(userId)
}
