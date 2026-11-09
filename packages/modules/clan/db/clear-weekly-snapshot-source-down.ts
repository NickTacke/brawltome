import type { Database } from '@brawltome/foundation'
import type { HeldLease } from '@brawltome/queue'
import { eq } from 'drizzle-orm'
import { weeklySnapshotRuns } from './tables'
import { type WeeklySnapshotWriteResult, writeUnderLease } from './weekly-snapshot-lease'

/** Forgets the failing guilds once one answers, so the next run of failures starts its own clock. */
export async function clearWeeklySnapshotSourceDown(
  database: Database,
  lease: HeldLease,
  weekStarting: string,
): Promise<WeeklySnapshotWriteResult<'cleared'>> {
  return writeUnderLease(database, lease, async (transaction) => {
    await transaction
      .update(weeklySnapshotRuns)
      .set({ sourceDownSince: null })
      .where(eq(weeklySnapshotRuns.weekStarting, weekStarting))

    return 'cleared' as const
  })
}
