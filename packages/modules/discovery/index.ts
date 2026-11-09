import type { BrawltomeModule } from '@brawltome/foundation'
import { createDiscoveryProcedures } from './api/procedures'
import { initializeDiscovery } from './migrations/0001-initialize-discovery'
import { generalizeDiscovery } from './migrations/0002-generalize-discovery'
import { addSemanticMigrationEvidence } from './migrations/0003-add-semantic-migration-evidence'
import { addWordTerms } from './migrations/0004-add-word-terms'
import { validateWordTerms } from './migrations/0005-validate-word-terms'

export {
  type ClanDiscoveryProjectionJobDependencies,
  createClanDiscoveryProjectionJob,
} from './jobs/clan-discovery-projection-job'
export { discoveryReconciliationContract } from './jobs/discovery-reconciliation-contract'
export {
  createDiscoveryReconciliationJob,
  type DiscoveryReconciliationJobDependencies,
} from './jobs/discovery-reconciliation-job'
export {
  createPlayerDiscoveryProjectionJob,
  type PlayerDiscoveryProjectionJobDependencies,
} from './jobs/player-discovery-projection-job'
export { clanDiscoveryProjectionContract, playerDiscoveryProjectionContract } from './jobs/projection-contract'
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
  // a literal, so the API router can serve the procedures under this name with their types
  name: 'discovery' as const,
  dependsOn: ['queue'],
  migrations,
  routes: createDiscoveryProcedures,
} satisfies BrawltomeModule
