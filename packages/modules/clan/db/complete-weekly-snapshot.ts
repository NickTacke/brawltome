import type { Database } from '@brawltome/foundation'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { weeklySnapshotRuns } from './tables'

/** Marks the week finished; the Last week figure only ever reads finished weeks. */
export async function completeWeeklySnapshot(database: Database, weekStarting: string): Promise<void> {
  await database.db
    .update(weeklySnapshotRuns)
    .set({ completedAt: sql`clock_timestamp()` })
    .where(and(eq(weeklySnapshotRuns.weekStarting, weekStarting), isNull(weeklySnapshotRuns.completedAt)))
}
