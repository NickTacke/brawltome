import { initializeStatisticsCohortTracer } from './migrations/0001-initialize-cohort-tracer'

export { createPostgresStatistics, type PostgresStatistics } from './postgres'
export { decodeLifetimeEvidence, decodeRankedEvidence } from './source'

export const statisticsMigrationInventory = [initializeStatisticsCohortTracer] as const
