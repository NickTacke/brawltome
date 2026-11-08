import type { Database } from '@brawltome/foundation'
import { isNull } from 'drizzle-orm'
import type { ClanDiscoveryEvent } from '../domain/discovery-facts'
import { readDiscoveryFacts, readDiscoverySourceVersion } from './read-discovery-facts'
import { readOnlySnapshot } from './read-only-snapshot'
import { discoveryOutbox } from './tables'

const maximumEventLimit = 1_000

/**
 * The oldest undelivered outbox events, each with the current facts of its clan. A clan without a stored profile
 * has a null fact, which tells discovery to drop it.
 */
export async function readPendingDiscoveryEvents(database: Database, limit: number): Promise<ClanDiscoveryEvent[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumEventLimit) {
    throw new Error(`Clan discovery event limit must be between 1 and ${maximumEventLimit}`)
  }

  return database.db.transaction(async (transaction) => {
    const events = await transaction
      .select({ eventId: discoveryOutbox.eventId, clanId: discoveryOutbox.clanId })
      .from(discoveryOutbox)
      .where(isNull(discoveryOutbox.deliveredAt))
      .orderBy(discoveryOutbox.createdAt, discoveryOutbox.eventId)
      .limit(limit)

    const clanIds = [...new Set(events.map(({ clanId }) => clanId))]
    const facts = await readDiscoveryFacts(transaction, clanIds)
    const factsByClanId = new Map(facts.map((fact) => [fact.clanId, fact]))
    const sourceVersion = await readDiscoverySourceVersion(transaction)

    return events.map((event) => ({ ...event, sourceVersion, fact: factsByClanId.get(event.clanId) ?? null }))
  }, readOnlySnapshot)
}
