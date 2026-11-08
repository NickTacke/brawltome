import type { Database } from '@brawltome/foundation'
import { getPlayerMembership } from '../db/get-player-membership'
import type { PlayerClanMembership } from '../domain/clan-profile'

export type PublicClanMembership = Pick<PlayerClanMembership, 'clanId' | 'clanName'>

// the xp figures stay internal
function toPublicClanMembership(membership: PlayerClanMembership): PublicClanMembership {
  return { clanId: membership.clanId, clanName: membership.clanName }
}

/** The clan a player belongs to, or null when they are in no stored clan. tRPC and oRPC both serve this. */
export async function readPlayerClanMembership(
  database: Database,
  brawlhallaId: number,
): Promise<PublicClanMembership | null> {
  const membership = await getPlayerMembership(database, brawlhallaId)

  if (!membership) return null

  return toPublicClanMembership(membership)
}
