import type { Database } from '@brawltome/foundation'
import { count, isNull } from 'drizzle-orm'
import { discoveryOutbox } from './tables'

/** How many outbox events discovery has yet to apply. */
export async function countPendingDiscoveryEvents(database: Database): Promise<number> {
  const [row] = await database.db
    .select({ pendingCount: count() })
    .from(discoveryOutbox)
    .where(isNull(discoveryOutbox.deliveredAt))

  return row?.pendingCount ?? 0
}
