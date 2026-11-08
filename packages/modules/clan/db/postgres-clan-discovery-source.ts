import type { Database } from '@brawltome/foundation'
import type { ClanDiscoverySource } from '../domain/discovery-facts'
import { acknowledgeDiscoveryEvents } from './acknowledge-discovery-events'
import { countPendingDiscoveryEvents } from './count-pending-discovery-events'
import { readDiscoverySnapshot } from './read-discovery-snapshot'
import { readPendingDiscoveryEvents } from './read-pending-discovery-events'
import { replayDeliveredDiscoveryEvents } from './replay-delivered-discovery-events'

/** The discovery outbox reads bound to one database, as the discovery module consumes them. */
export function createPostgresClanDiscoverySource(database: Database): ClanDiscoverySource {
  return {
    pendingEvents: (limit) => readPendingDiscoveryEvents(database, limit),
    acknowledgeEvents: (eventIds) => acknowledgeDiscoveryEvents(database, eventIds),
    replayDeliveredEvents: (eventIds) => replayDeliveredDiscoveryEvents(database, eventIds),
    snapshot: () => readDiscoverySnapshot(database),
    lag: () => countPendingDiscoveryEvents(database),
  }
}

export type PostgresClanDiscoverySource = ReturnType<typeof createPostgresClanDiscoverySource>
