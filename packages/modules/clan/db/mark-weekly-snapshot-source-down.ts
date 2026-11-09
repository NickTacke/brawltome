import type { Database } from '@brawltome/foundation'
import { eq, sql } from 'drizzle-orm'
import { weeklySnapshotRuns } from './tables'

/** Notes that guilds keep failing in a row, unless that's already noted, and says how long it has gone on. */
export async function markWeeklySnapshotSourceDown(database: Database, weekStarting: string): Promise<number> {
  const [run] = await database.db
    .update(weeklySnapshotRuns)
    .set({ sourceDownSince: sql`COALESCE(${weeklySnapshotRuns.sourceDownSince}, clock_timestamp())` })
    .where(eq(weeklySnapshotRuns.weekStarting, weekStarting))
    .returning({
      downForMs: sql<number>`(extract(epoch FROM clock_timestamp() - ${weeklySnapshotRuns.sourceDownSince}) * 1000)::float8`,
    })

  if (!run) throw new Error(`mark weekly snapshot source down for week ${weekStarting}: the run row is missing`)

  return run.downForMs
}
