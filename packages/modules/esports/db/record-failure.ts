import type { Database } from '@brawltome/foundation'
import { eq, sql } from 'drizzle-orm'
import { players } from './tables'

/**
 * Counts a failed refresh and moves checked_at, so the back-off starts from now. The stored results stay as they
 * were. A player that was never stored has no row to count on, so nothing changes for them.
 */
export async function recordFailure(database: Database, brawlhallaId: number, checkedAt: Date): Promise<void> {
  await database.db
    .update(players)
    .set({ failureCount: sql`${players.failureCount} + 1`, checkedAt })
    .where(eq(players.brawlhallaId, brawlhallaId))
}
