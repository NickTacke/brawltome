import type { Database } from '@brawltome/foundation'
import type { HeldLease } from '@brawltome/queue'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { weeklySnapshotRuns } from './tables'
import { type WeeklySnapshotWriteResult, writeUnderLease } from './weekly-snapshot-lease'

/** Marks the week finished; the Last week figure only ever reads finished weeks. */
export async function completeWeeklySnapshot(
  database: Database,
  lease: HeldLease,
  weekStarting: string,
): Promise<WeeklySnapshotWriteResult<'completed'>> {
  return writeUnderLease(database, lease, async (transaction) => {
    await transaction
      .update(weeklySnapshotRuns)
      .set({ completedAt: sql`clock_timestamp()` })
      .where(and(eq(weeklySnapshotRuns.weekStarting, weekStarting), isNull(weeklySnapshotRuns.completedAt)))

    return 'completed' as const
  })
}
