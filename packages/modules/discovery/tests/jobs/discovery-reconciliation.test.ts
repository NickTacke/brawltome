import { describe, expect, test } from 'bun:test'
import { runJobOnce } from '@brawltome/queue/testing'
import { createDiscoveryReconciliationJob } from '../../jobs/discovery-reconciliation-job'
import { createQueueSpy, discoveryLease } from './job-fixtures'

function reconciliationLease(owner: 'player' | 'clan') {
  return discoveryLease({ kind: 'discovery-reconciliation', payload: { owner } })
}

function appliedChecks(isApplied: boolean) {
  return createDiscoveryReconciliationJob({
    reconcile: async () => {},
    reconciliationEffectApplied: async () => isApplied,
    leaseActive: async () => true,
  })
}

const effectLease = { operationId: 'operation', effectOperationId: 'effect', payload: { owner: 'player' as const } }

describe('discovery reconciliation job', () => {
  test('reconciles the lease owner and completes', async () => {
    const lease = reconciliationLease('player')
    const { queue, completions } = createQueueSpy([lease])
    const reconciled: Array<{ owner: string; effectOperationId: string }> = []

    const job = createDiscoveryReconciliationJob({
      reconcile: async (owner, effectOperationId) => {
        reconciled.push({ owner, effectOperationId })
      },
      reconciliationEffectApplied: async () => false,
      leaseActive: async () => true,
    })

    expect(job.workClasses).toEqual(['projection'])
    expect(await runJobOnce(queue, job)).toBe('succeeded')

    expect(reconciled).toEqual([{ owner: 'player', effectOperationId: lease.effectOperationId }])
    expect(completions()).toBe(1)
  })

  test('hands the reconcile a fence that asks whether this lease is still active', async () => {
    const lease = reconciliationLease('clan')
    const { queue } = createQueueSpy([lease])
    const checkedLeases: string[] = []

    const job = createDiscoveryReconciliationJob({
      reconcile: async (_owner, _effectOperationId, isLeaseActive) => {
        expect(await isLeaseActive()).toBe(true)
      },
      reconciliationEffectApplied: async () => false,
      leaseActive: async (checked) => {
        checkedLeases.push(checked.operationId)

        return true
      },
    })

    await runJobOnce(queue, job)

    expect(checkedLeases).toEqual([lease.operationId])
  })

  test('fails with discovery_reconciliation_failed when the reconcile throws', async () => {
    const { queue, failures } = createQueueSpy([reconciliationLease('player')])

    const job = createDiscoveryReconciliationJob({
      reconcile: async () => {
        throw new Error('reconcile failed')
      },
      reconciliationEffectApplied: async () => false,
      leaseActive: async () => true,
    })

    await runJobOnce(queue, job)

    expect(failures.map(({ code }) => code)).toEqual(['discovery_reconciliation_failed'])
  })

  test('a landed effect is acknowledged and anything else reads as none', async () => {
    expect(await appliedChecks(true).effectState?.({} as never, effectLease)).toBe('acknowledged')
    expect(await appliedChecks(false).effectState?.({} as never, effectLease)).toBe('none')
  })

  test('takes the discovery claim lock', () => {
    expect(appliedChecks(false).claimLockKey?.('effect')).toBe('discovery-effect:effect')
  })
})
