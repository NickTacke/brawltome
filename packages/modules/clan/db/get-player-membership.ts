import type { Database } from '@brawltome/foundation'
import { eq } from 'drizzle-orm'
import type { PlayerClanMembership } from '../domain/clan-profile'
import { members, profiles } from './tables'

/** The clan a player belongs to, with their own xp in it, or null when they are in no stored clan. */
export async function getPlayerMembership(
  database: Database,
  brawlhallaId: number,
): Promise<PlayerClanMembership | null> {
  const [membership] = await database.db
    .select({
      clanId: members.clanId,
      clanName: profiles.clanName,
      clanXp: profiles.clanXp,
      clanLifetimeXp: profiles.clanLifetimeXp,
      personalXp: members.xp,
    })
    .from(members)
    .innerJoin(profiles, eq(profiles.clanId, members.clanId))
    .where(eq(members.brawlhallaId, brawlhallaId))

  return membership ?? null
}
