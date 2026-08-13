import { initializeDiscovery } from './migrations/0001-initialize-discovery'
import { generalizeDiscovery } from './migrations/0002-generalize-discovery'
import { addSemanticMigrationEvidence } from './migrations/0003-add-semantic-migration-evidence'

export { createPostgresDiscovery, type PostgresDiscovery } from './postgres'

export const discoveryMigrationInventory = [
  initializeDiscovery,
  generalizeDiscovery,
  addSemanticMigrationEvidence,
] as const
