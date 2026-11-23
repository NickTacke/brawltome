import type { Database } from '@brawltome/foundation'
import type { RawMatch } from '../source/raw-types'
import { eventSets } from './tables'

/** Stores the raw sets of one event the player was in, replacing what an earlier fetch stored. */
export async function saveEventSets(
  database: Database,
  brawlhallaId: number,
  tournamentId: string,
  sets: RawMatch[],
  fetchedAt: Date,
): Promise<void> {
  await database.db
    .insert(eventSets)
    .values({ brawlhallaId, tournamentId, sets, fetchedAt })
    .onConflictDoUpdate({ target: [eventSets.brawlhallaId, eventSets.tournamentId], set: { sets, fetchedAt } })
}
