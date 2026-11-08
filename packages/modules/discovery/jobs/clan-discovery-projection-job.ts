import type { JobDefinition } from '@brawltome/refresh-operations'
import { createProjectionJob, type ProjectionJobDependencies, type ProjectionPayload } from './projection-job'

export type ClanDiscoveryProjectionJobDependencies = ProjectionJobDependencies

export function createClanDiscoveryProjectionJob(
  dependencies: ClanDiscoveryProjectionJobDependencies,
): JobDefinition<ProjectionPayload> {
  return createProjectionJob(
    { kind: 'clan-discovery-projection', failureCode: 'clan_discovery_projection_failed' },
    dependencies,
  )
}
