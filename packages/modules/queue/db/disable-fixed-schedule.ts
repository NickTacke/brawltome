import type { Database } from '@brawltome/foundation'
import { and, eq, sql } from 'drizzle-orm'
import { lockScheduleKey } from './schedule-lock'
import { schedules } from './tables'

export type DisableFixedScheduleInput = {
  scheduleKey: string
  kind: 'ranking-retention' | 'leaderboard-deep-crawl'
}

export async function disableFixedSchedule(
  database: Database,
  input: DisableFixedScheduleInput,
): Promise<{ outcome: 'disabled' | 'already-disabled' | 'absent' }> {
  return database.db.transaction(async (transaction) => {
    await lockScheduleKey(transaction, input.scheduleKey)

    const [existing] = await transaction
      .select({ id: schedules.id, enabled: schedules.enabled })
      .from(schedules)
      .where(and(eq(schedules.scheduleKey, input.scheduleKey), eq(schedules.kind, input.kind)))
      .for('update')

    if (!existing) return { outcome: 'absent' as const }

    if (!existing.enabled) return { outcome: 'already-disabled' as const }

    await transaction
      .update(schedules)
      .set({ enabled: false, updatedAt: sql`clock_timestamp()` })
      .where(eq(schedules.id, existing.id))

    return { outcome: 'disabled' as const }
  })
}
