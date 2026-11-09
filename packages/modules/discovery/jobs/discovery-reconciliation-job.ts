import { defineJob, type JobDefinition, type Lease } from '@brawltome/refresh-operations'
import type { ProjectionOwner } from '../model'
import { discoveryClaimLockKey } from './claim-lock-key'
import { discoveryReconciliationContract, type ReconciliationPayload } from './discovery-reconciliation-contract'

export type DiscoveryReconciliationJobDependencies = {
  reconcile(owner: ProjectionOwner, effectOperationId: string, isLeaseActive: () => Promise<boolean>): Promise<unknown>
  reconciliationEffectApplied(effectOperationId: string): Promise<boolean>
  leaseActive(lease: Lease<unknown>): Promise<boolean>
}

export function createDiscoveryReconciliationJob(
  dependencies: DiscoveryReconciliationJobDependencies,
): JobDefinition<ReconciliationPayload> {
  const { reconcile, reconciliationEffectApplied, leaseActive } = dependencies

  return defineJob<ReconciliationPayload>({
    ...discoveryReconciliationContract,
    failureCode: 'discovery_reconciliation_failed',
    claimLockKey: discoveryClaimLockKey,
    // reconciliation has no in-between: once its effect landed there is nothing left to retry
    async effectState(_transaction, lease) {
      const isApplied = await reconciliationEffectApplied(lease.effectOperationId)

      return isApplied ? 'acknowledged' : 'none'
    },
    async run(lease, tools) {
      await reconcile(lease.payload.owner, lease.effectOperationId, () => leaseActive(lease))

      const transition = await tools.queue.complete(lease)

      return transition === 'lease-lost' ? 'lease_lost' : 'succeeded'
    },
  })
}
