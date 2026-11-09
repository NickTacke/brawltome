import type { Database } from '@brawltome/foundation'
import { asc, gt } from 'drizzle-orm'
import { profiles } from './tables'

/** The next stored clans by id, the same clans the ranked list and the standing cover. */
export async function listClansAfter(database: Database, lastClanId: number, limit: number): Promise<number[]> {
  const rows = await database.db
    .select({ clanId: profiles.clanId })
    .from(profiles)
    .where(gt(profiles.clanId, lastClanId))
    .orderBy(asc(profiles.clanId))
    .limit(limit)

  return rows.map(({ clanId }) => clanId)
}
