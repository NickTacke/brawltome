import type { Database } from '@brawltome/foundation'
import { eq, sql } from 'drizzle-orm'
import { excluded } from './excluded'
import { weeklySnapshotRuns, weeklySnapshots } from './tables'

export type WeeklySnapshotRecord = {
  weekStarting: string
  clanId: number
  // null when the clan is skipped this week; the run still moves past it
  guildPoints: string | null
}

/** Saves a clan's points for the week and moves the run past it, together, so a retry can't lose or repeat a clan. */
export async function recordWeeklySnapshot(database: Database, record: WeeklySnapshotRecord): Promise<void> {
  const { weekStarting, clanId, guildPoints } = record

  await database.db.transaction(async (transaction) => {
    if (guildPoints !== null) {
      await transaction
        .insert(weeklySnapshots)
        .values({ weekStarting, clanId, guildPoints })
        .onConflictDoUpdate({
          target: [weeklySnapshots.weekStarting, weeklySnapshots.clanId],
          set: { guildPoints: excluded(weeklySnapshots.guildPoints) },
        })
    }

    await transaction
      .update(weeklySnapshotRuns)
      .set({ lastClanId: sql`GREATEST(${weeklySnapshotRuns.lastClanId}, ${clanId})` })
      .where(eq(weeklySnapshotRuns.weekStarting, weekStarting))
  })
}
