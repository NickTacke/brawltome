import { initializeDiscovery } from './migrations/0001-initialize-discovery'

export { createPostgresDiscovery, type PostgresDiscovery } from './postgres'

export const discoveryMigrationInventory = [initializeDiscovery] as const
