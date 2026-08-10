import { initializeStatisticsCohortTracer } from './migrations/0001-initialize-cohort-tracer'
import { addFullLaunchCohort } from './migrations/0002-full-launch-cohort'

export { createPostgresStatistics, type PostgresStatistics } from './postgres'
export { decodeLifetimeEvidence, decodeRankedEvidence } from './source'

export const statisticsMigrationInventory = [initializeStatisticsCohortTracer, addFullLaunchCohort] as const
