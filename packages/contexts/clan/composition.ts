import { initializeClans } from './migrations/0001-initialize-clans'
import { addClanDiscoveryFacts } from './migrations/0002-add-discovery-facts'
import { addV2ClanImportEvidence } from './migrations/0003-add-v2-import-evidence'

export {
  createPostgresClans,
  type LegacyClanMigrationEvidence,
  type PostgresClans,
} from './postgres'
export { createPostgresClanDiscoverySource, type PostgresClanDiscoverySource } from './discovery-postgres'
export { importLegacyClans } from './legacy-import'

export const clanMigrationInventory = [initializeClans, addClanDiscoveryFacts, addV2ClanImportEvidence] as const
