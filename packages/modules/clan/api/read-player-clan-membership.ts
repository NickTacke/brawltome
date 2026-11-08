import type { ClanQueries } from '../db/postgres-clans'
import type { PlayerClanMembership } from '../domain/clan-profile'

export type PublicClanMembership = Pick<PlayerClanMembership, 'clanId' | 'clanName'>

/** The clan a player belongs to, without the xp figures, or null when they are in no stored clan. */
export async function readPlayerClanMembership(
  clans: Pick<ClanQueries, 'getPlayerMembership'>,
  brawlhallaId: number,
): Promise<PublicClanMembership | null> {
  const membership = await clans.getPlayerMembership(brawlhallaId)

  if (!membership) return null

  return { clanId: membership.clanId, clanName: membership.clanName }
}
