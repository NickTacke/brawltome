import {
  defineJob,
  type EffectState,
  type FailureDecision,
  isSourceFailure,
  type JobDefinition,
  type Lease,
} from '@brawltome/refresh-operations'
import { discoveryClaimLockKey } from './claim-lock-key'

export type ProjectionPayload = { batchSize: number }

export type ProjectionJobDependencies = {
  deliverPending(batchSize: number, effectOperationId: string, isLeaseActive: () => Promise<boolean>): Promise<unknown>
  projectionEffectState(effectOperationId: string): Promise<EffectState>
  leaseActive(lease: Lease<unknown>): Promise<boolean>
}

async function decideAppliedEffectFailure(
  lease: Lease<ProjectionPayload>,
  projectionEffectState: ProjectionJobDependencies['projectionEffectState'],
): Promise<FailureDecision | null> {
  let effectState: EffectState

  try {
    effectState = await projectionEffectState(lease.effectOperationId)
  } catch {
    return { action: 'retry-applied-effect' }
  }

  if (effectState === 'acknowledged') return { action: 'complete' }

  if (effectState === 'applied') return { action: 'retry-applied-effect' }

  return null
}

// delivers a bounded batch of pending events to the discovery projection; an effect that landed before a failure must
// not be dead-lettered or retried from scratch
export function createProjectionJob(
  identity: { kind: string; failureCode: string },
  dependencies: ProjectionJobDependencies,
): JobDefinition<ProjectionPayload> {
  const { deliverPending, projectionEffectState, leaseActive } = dependencies

  return defineJob<ProjectionPayload>({
    kind: identity.kind,
    workClasses: ['projection'],
    failureCode: identity.failureCode,
    // claim already shapes this payload
    parsePayload: (value) => value as ProjectionPayload,
    claimLockKey: discoveryClaimLockKey,
    effectState: (_transaction, lease) => projectionEffectState(lease.effectOperationId),
    async run(lease, tools) {
      await deliverPending(lease.payload.batchSize, lease.effectOperationId, () => leaseActive(lease))

      const transition = await tools.queue.complete(lease)

      return transition === 'lease-lost' ? 'lease_lost' : 'succeeded'
    },
    async decideFailure(error, lease) {
      // a source outage on a projection whose effect landed must still wait for the source
      if (isSourceFailure(error)) return null

      return decideAppliedEffectFailure(lease, projectionEffectState)
    },
  })
}
