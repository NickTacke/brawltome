import type { Database } from '@brawltome/foundation'
import { eq } from 'drizzle-orm'
import { weeklySnapshotRuns } from './tables'

export type WeeklySnapshotRun = { lastClanId: number; isCompleted: boolean }

/** Starts a week's run, or finds the one an earlier attempt left, so the job carries on after the last stored clan. */
export async function beginWeeklySnapshot(database: Database, weekStarting: string): Promise<WeeklySnapshotRun> {
  await database.db.insert(weeklySnapshotRuns).values({ weekStarting }).onConflictDoNothing()

  const [run] = await database.db
    .select({ lastClanId: weeklySnapshotRuns.lastClanId, completedAt: weeklySnapshotRuns.completedAt })
    .from(weeklySnapshotRuns)
    .where(eq(weeklySnapshotRuns.weekStarting, weekStarting))

  if (!run) throw new Error(`begin weekly snapshot for week ${weekStarting}: the run row is missing`)

  return { lastClanId: run.lastClanId, isCompleted: run.completedAt !== null }
}
