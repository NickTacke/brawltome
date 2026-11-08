import { count, eq, inArray } from 'drizzle-orm'
import type { ClanDiscoveryFact } from '../domain/discovery-facts'
import { discoveryState, members, profiles } from './tables'
import type { Transaction } from './transaction'

/** The facts discovery indexes for each stored clan, or for the given clans only, ordered by clan id. */
export async function readDiscoveryFacts(transaction: Transaction, clanIds?: number[]): Promise<ClanDiscoveryFact[]> {
  if (clanIds && clanIds.length === 0) return []

  const isRequested = clanIds ? inArray(profiles.clanId, clanIds) : undefined

  return transaction
    .select({
      clanId: profiles.clanId,
      clanName: profiles.clanName,
      clanXp: profiles.clanXp,
      memberCount: count(members.brawlhallaId),
    })
    .from(profiles)
    .leftJoin(members, eq(members.clanId, profiles.clanId))
    .where(isRequested)
    .groupBy(profiles.clanId, profiles.clanName, profiles.clanXp)
    .orderBy(profiles.clanId)
}

/** The version the discovery triggers bump with every change to the facts. */
export async function readDiscoverySourceVersion(transaction: Transaction): Promise<number> {
  const [state] = await transaction
    .select({ sourceVersion: discoveryState.sourceVersion })
    .from(discoveryState)
    .where(eq(discoveryState.singleton, true))

  if (!state) throw new Error('read clan discovery source version: clans.discovery_state has no row')

  return state.sourceVersion
}
