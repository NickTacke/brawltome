import type { BrawltomeModule } from '@brawltome/foundation'
import { initializeDiscovery } from './migrations/0001-initialize-discovery'
import { generalizeDiscovery } from './migrations/0002-generalize-discovery'
import { addSemanticMigrationEvidence } from './migrations/0003-add-semantic-migration-evidence'
import { addWordTerms } from './migrations/0004-add-word-terms'
import { validateWordTerms } from './migrations/0005-validate-word-terms'

export {
  type ClanDiscoveryProjectionJobDependencies,
  createClanDiscoveryProjectionJob,
} from './jobs/clan-discovery-projection-job'
export {
  createDiscoveryReconciliationJob,
  type DiscoveryReconciliationJobDependencies,
} from './jobs/discovery-reconciliation-job'
export {
  createPlayerDiscoveryProjectionJob,
  type PlayerDiscoveryProjectionJobDependencies,
} from './jobs/player-discovery-projection-job'
export * from './model'
export { createPostgresDiscovery, type PostgresDiscovery } from './postgres'

const migrations = [
  initializeDiscovery,
  generalizeDiscovery,
  addSemanticMigrationEvidence,
  addWordTerms,
  validateWordTerms,
] as const

export const discoveryModule = {
  name: 'discovery',
  dependsOn: ['refresh-operations'],
  migrations,
} satisfies BrawltomeModule
