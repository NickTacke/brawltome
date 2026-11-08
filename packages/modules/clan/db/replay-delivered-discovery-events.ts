import type { Database } from '@brawltome/foundation'
import { inArray } from 'drizzle-orm'
import { discoveryOutbox } from './tables'

/** Marks delivered events pending again, so discovery reads and applies them once more. */
export async function replayDeliveredDiscoveryEvents(database: Database, eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return

  await database.db.update(discoveryOutbox).set({ deliveredAt: null }).where(inArray(discoveryOutbox.eventId, eventIds))
}
