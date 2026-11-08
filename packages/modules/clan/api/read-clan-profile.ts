import type { ClanProfileContract } from '@brawltome/contracts'
import type { Database } from '@brawltome/foundation'
import { getClanProfile } from '../db/get-clan-profile'
import { toClanProfileContract } from './clan-profile-contract'

/** A stored clan in its public shape, or null when its profile was never fetched. tRPC and oRPC both serve this. */
export async function readClanProfile(database: Database, clanId: number): Promise<ClanProfileContract | null> {
  const clan = await getClanProfile(database, clanId)

  if (!clan) return null

  return toClanProfileContract(clan)
}
