import type { Database } from '@brawltome/foundation'
import type { HeldLease } from '@brawltome/queue'
import { eq, sql } from 'drizzle-orm'
import { weeklySnapshotRuns } from './tables'
import { type WeeklySnapshotWriteResult, writeUnderLease } from './weekly-snapshot-lease'

/** Notes that guilds keep failing in a row, unless that's already noted, and says how long it has gone on. */
export async function markWeeklySnapshotSourceDown(
  database: Database,
  lease: HeldLease,
  weekStarting: string,
): Promise<WeeklySnapshotWriteResult<number>> {
  return writeUnderLease(database, lease, async (transaction) => {
    const [run] = await transaction
      .update(weeklySnapshotRuns)
      .set({ sourceDownSince: sql`COALESCE(${weeklySnapshotRuns.sourceDownSince}, clock_timestamp())` })
      .where(eq(weeklySnapshotRuns.weekStarting, weekStarting))
      .returning({
        downForMs: sql<number>`(extract(epoch FROM clock_timestamp() - ${weeklySnapshotRuns.sourceDownSince}) * 1000)::float8`,
      })

    if (!run) throw new Error(`mark weekly snapshot source down for week ${weekStarting}: the run row is missing`)

    return run.downForMs
  })
}
