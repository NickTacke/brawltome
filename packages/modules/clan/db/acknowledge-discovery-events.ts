import type { Database } from '@brawltome/foundation'
import { and, inArray, isNull, lt, sql } from 'drizzle-orm'
import { discoveryOutbox } from './tables'

const deliveredTrimBatch = 1_000

async function trimDeliveredEvents(database: Database): Promise<void> {
  const dayOldDeliveredEvents = database.db
    .select({ eventId: discoveryOutbox.eventId })
    .from(discoveryOutbox)
    .where(lt(discoveryOutbox.deliveredAt, sql`clock_timestamp() - interval '1 day'`))
    .limit(deliveredTrimBatch)

  await database.db.delete(discoveryOutbox).where(inArray(discoveryOutbox.eventId, dayOldDeliveredEvents))
}

/** Marks events delivered once discovery has applied them. */
export async function acknowledgeDiscoveryEvents(database: Database, eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return

  await database.db
    .update(discoveryOutbox)
    .set({ deliveredAt: sql`clock_timestamp()` })
    .where(and(inArray(discoveryOutbox.eventId, eventIds), isNull(discoveryOutbox.deliveredAt)))

  // delivered events are never read again; each acknowledgement trims a bounded batch of day-old ones, so the
  // outbox stays small without a separate maintenance job
  await trimDeliveredEvents(database)
}
