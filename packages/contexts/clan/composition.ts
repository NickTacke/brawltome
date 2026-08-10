import { initializeClans } from './migrations/0001-initialize-clans'
import { addClanDiscoveryFacts } from './migrations/0002-add-discovery-facts'

export { createPostgresClans, type PostgresClans } from './postgres'
export { createPostgresClanDiscoverySource, type PostgresClanDiscoverySource } from './discovery-postgres'
export { importLegacyClans } from './legacy-import'

export const clanMigrationInventory = [initializeClans, addClanDiscoveryFacts] as const
