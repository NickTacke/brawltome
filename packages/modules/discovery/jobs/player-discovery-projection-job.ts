import type { JobDefinition } from '@brawltome/refresh-operations'
import { playerDiscoveryProjectionContract } from './projection-contract'
import { createProjectionJob, type ProjectionJobDependencies, type ProjectionPayload } from './projection-job'

export type PlayerDiscoveryProjectionJobDependencies = ProjectionJobDependencies

export function createPlayerDiscoveryProjectionJob(
  dependencies: PlayerDiscoveryProjectionJobDependencies,
): JobDefinition<ProjectionPayload> {
  return createProjectionJob(
    { contract: playerDiscoveryProjectionContract, failureCode: 'player_discovery_projection_failed' },
    dependencies,
  )
}
