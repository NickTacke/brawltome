import type { BrawltomeModule } from '@brawltome/foundation'
import { createEsportsProcedures } from './api/procedures'
import { createEsports } from './migrations/0001-create-esports'

export { failureBackoffMs, linkedTtlMs, noneTtlMs } from './domain'
export { type EsportsRefreshPayload, esportsRefreshContract } from './jobs/esports-refresh-contract'
export { createEsportsRefreshJob, type EsportsRefreshJobDependencies } from './jobs/esports-refresh-job'
export { type EsportsSetsBackfillPayload, esportsSetsBackfillContract } from './jobs/esports-sets-backfill-contract'
export { createEsportsSetsBackfillJob, type EsportsSetsBackfillJobDependencies } from './jobs/esports-sets-backfill-job'
export {
  type BrawltoolsClient,
  type BrawltoolsClientOptions,
  createBrawltoolsClient,
} from './source/brawltools-client'

const migrations = [createEsports] as const

export const esportsModule = {
  // a literal, so the API router can serve the procedures under this name with their types
  name: 'esports' as const,
  dependsOn: ['queue', 'player'],
  migrations,
  routes: createEsportsProcedures,
} satisfies BrawltomeModule
