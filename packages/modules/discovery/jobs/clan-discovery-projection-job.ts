import type { JobDefinition } from '@brawltome/queue'
import { clanDiscoveryProjectionContract } from './projection-contract'
import { createProjectionJob, type ProjectionJobDependencies, type ProjectionPayload } from './projection-job'

export type ClanDiscoveryProjectionJobDependencies = ProjectionJobDependencies

export function createClanDiscoveryProjectionJob(
  dependencies: ClanDiscoveryProjectionJobDependencies,
): JobDefinition<ProjectionPayload> {
  return createProjectionJob(
    { contract: clanDiscoveryProjectionContract, failureCode: 'clan_discovery_projection_failed' },
    dependencies,
  )
}
