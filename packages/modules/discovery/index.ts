import type { BrawltomeModule } from '@brawltome/foundation'
import { initializeDiscovery } from './migrations/0001-initialize-discovery'
import { generalizeDiscovery } from './migrations/0002-generalize-discovery'
import { addSemanticMigrationEvidence } from './migrations/0003-add-semantic-migration-evidence'
import { addWordTerms } from './migrations/0004-add-word-terms'
import { validateWordTerms } from './migrations/0005-validate-word-terms'

export * from './model'
export { createPostgresDiscovery, type PostgresDiscovery } from './postgres'

export const discoveryMigrationInventory = [
  initializeDiscovery,
  generalizeDiscovery,
  addSemanticMigrationEvidence,
  addWordTerms,
  validateWordTerms,
] as const

export const discoveryModule = {
  name: 'discovery',
  dependsOn: [],
  migrations: discoveryMigrationInventory,
} satisfies BrawltomeModule
