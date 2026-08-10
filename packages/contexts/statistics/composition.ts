import { initializeStatisticsCohortTracer } from './migrations/0001-initialize-cohort-tracer'
import { addFullLaunchCohort } from './migrations/0002-full-launch-cohort'
import { addLegendMetaPublications } from './migrations/0003-add-legend-meta-publications'

export { createPostgresStatistics, type PostgresStatistics } from './postgres'
export { decodeLifetimeEvidence, decodeRankedEvidence } from './source'

export const statisticsMigrationInventory = [
  initializeStatisticsCohortTracer,
  addFullLaunchCohort,
  addLegendMetaPublications,
] as const
