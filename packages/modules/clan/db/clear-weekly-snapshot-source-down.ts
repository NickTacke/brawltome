import type { Database } from '@brawltome/foundation'
import { eq } from 'drizzle-orm'
import { weeklySnapshotRuns } from './tables'

/** Forgets the failing guilds once one answers, so the next run of failures starts its own clock. */
export async function clearWeeklySnapshotSourceDown(database: Database, weekStarting: string): Promise<void> {
  await database.db
    .update(weeklySnapshotRuns)
    .set({ sourceDownSince: null })
    .where(eq(weeklySnapshotRuns.weekStarting, weekStarting))
}
