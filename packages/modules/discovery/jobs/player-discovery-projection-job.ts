import type { JobDefinition } from '@brawltome/refresh-operations'
import { createProjectionJob, type ProjectionJobDependencies, type ProjectionPayload } from './projection-job'

export type PlayerDiscoveryProjectionJobDependencies = ProjectionJobDependencies

export function createPlayerDiscoveryProjectionJob(
  dependencies: PlayerDiscoveryProjectionJobDependencies,
): JobDefinition<ProjectionPayload> {
  return createProjectionJob(
    { kind: 'player-discovery-projection', failureCode: 'player_discovery_projection_failed' },
    dependencies,
  )
}
