import type { Database } from '@brawltome/foundation'
import { count, isNull, min } from 'drizzle-orm'
import type { ClanDiscoverySnapshot } from '../domain/discovery-facts'
import { discoveryReadTransaction, readDiscoveryFacts, readDiscoverySourceVersion } from './read-discovery-facts'
import { discoveryOutbox } from './tables'

/** Every clan's facts at one source version, with the backlog of events not yet delivered. */
export async function readDiscoverySnapshot(database: Database): Promise<ClanDiscoverySnapshot> {
  return database.db.transaction(async (transaction) => {
    const [pending] = await transaction
      .select({ pendingEventCount: count(), oldestPendingAt: min(discoveryOutbox.createdAt) })
      .from(discoveryOutbox)
      .where(isNull(discoveryOutbox.deliveredAt))

    const sourceVersion = await readDiscoverySourceVersion(transaction)
    const facts = await readDiscoveryFacts(transaction)

    return {
      sourceVersion,
      facts,
      pendingEventCount: pending?.pendingEventCount ?? 0,
      oldestPendingAt: pending?.oldestPendingAt ?? null,
    }
  }, discoveryReadTransaction)
}
