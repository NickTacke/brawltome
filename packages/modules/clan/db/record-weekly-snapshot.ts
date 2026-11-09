import { eq, sql } from 'drizzle-orm'
import { excluded } from './excluded'
import { weeklySnapshotRuns, weeklySnapshots } from './tables'
import type { Transaction } from './transaction'

export type WeeklySnapshotRecord = {
  weekStarting: string
  clanId: number
  // null when the clan is skipped this week; the run still moves past it
  guildPoints: string | null
  sourceRank: number | null
}

/** Saves a clan's points for the week and moves the run past it, in the caller's transaction. */
export async function recordWeeklySnapshot(transaction: Transaction, record: WeeklySnapshotRecord): Promise<void> {
  const { weekStarting, clanId, guildPoints, sourceRank } = record

  if (guildPoints !== null) {
    await transaction
      .insert(weeklySnapshots)
      .values({ weekStarting, clanId, guildPoints, sourceRank })
      .onConflictDoUpdate({
        target: [weeklySnapshots.weekStarting, weeklySnapshots.clanId],
        set: { guildPoints: excluded(weeklySnapshots.guildPoints), sourceRank: excluded(weeklySnapshots.sourceRank) },
      })
  }

  await transaction
    .update(weeklySnapshotRuns)
    .set({ lastClanId: sql`GREATEST(${weeklySnapshotRuns.lastClanId}, ${clanId})` })
    .where(eq(weeklySnapshotRuns.weekStarting, weekStarting))
}
