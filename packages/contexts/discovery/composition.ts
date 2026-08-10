import { initializeDiscovery } from './migrations/0001-initialize-discovery'
import { generalizeDiscovery } from './migrations/0002-generalize-discovery'

export { createPostgresDiscovery, type PostgresDiscovery } from './postgres'

export const discoveryMigrationInventory = [initializeDiscovery, generalizeDiscovery] as const
