import type { Sql } from '@brawltome/foundation'
import type { ReconcileObservationWatermark } from '@brawltome/queue'

// a queue-only test database keeps this table in the queue's schema; only player's migration moves it
export const testWatermark: ReconcileObservationWatermark = {
  async isSuperseded(sql: Sql, observedAt: Date): Promise<boolean> {
    const [previous] = await sql<{ observed_at: Date }[]>`
      SELECT observed_at FROM queue.primary_monitoring_reconciliation WHERE singleton FOR UPDATE
    `

    return previous !== undefined && previous.observed_at.getTime() >= observedAt.getTime()
  },

  async record(sql: Sql, observedAt: Date): Promise<void> {
    await sql`
      INSERT INTO queue.primary_monitoring_reconciliation (singleton, observed_at)
      VALUES (true, ${observedAt})
      ON CONFLICT (singleton) DO UPDATE SET observed_at = EXCLUDED.observed_at
    `
  },
}
