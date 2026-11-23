import type { Database } from '@brawltome/foundation'
import { sql } from 'drizzle-orm'
import { players } from './tables'

/**
 * Counts a failed refresh and moves checked_at, so the back-off starts from now. The stored results stay as they
 * were. A player never stored gets a row with link 'none' and one failure.
 */
export async function recordFailure(database: Database, brawlhallaId: number, checkedAt: Date): Promise<void> {
  // a row with failure_count > 0 makes the read back off for a day, even before a first fetch ever worked
  await database.db
    .insert(players)
    .values({ brawlhallaId, link: 'none', eventLegends: [], checkedAt, failureCount: 1 })
    .onConflictDoUpdate({
      target: players.brawlhallaId,
      set: { failureCount: sql`${players.failureCount} + 1`, checkedAt },
    })
}
