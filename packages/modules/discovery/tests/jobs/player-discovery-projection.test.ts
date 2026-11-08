import { describe, expect, test } from 'bun:test'
import { type EffectState, SourceAdmissionLimitedError } from '@brawltome/refresh-operations'
import { runJobOnce } from '@brawltome/refresh-operations/testing'
import { createPlayerDiscoveryProjectionJob } from '../../jobs/player-discovery-projection-job'
import { createQueueSpy, discoveryLease } from './job-fixtures'

const kind = 'player-discovery-projection'

function projectionLease(maxAttempts = 3) {
  return discoveryLease({ kind, payload: { batchSize: 100 }, maxAttempts })
}

function failingJob(effectState: () => Promise<EffectState>, deliveryError: unknown = new Error('delivery failed')) {
  return createPlayerDiscoveryProjectionJob({
    deliverPending: async () => {
      throw deliveryError
    },
    projectionEffectState: effectState,
    leaseActive: async () => true,
  })
}

describe('player discovery projection job', () => {
  test('executes player projection work through the durable projection class', async () => {
    const lease = projectionLease()
    const { queue, completions } = createQueueSpy([lease])
    let executed = false

    const job = createPlayerDiscoveryProjectionJob({
      deliverPending: async (batchSize, effectOperationId) => {
        expect(batchSize).toBe(100)
        expect(effectOperationId).toBe(lease.effectOperationId)
        executed = true
      },
      projectionEffectState: async () => 'none',
      leaseActive: async () => true,
    })

    expect(job.workClasses).toEqual(['projection'])
    expect(await runJobOnce(queue, job)).toBe('succeeded')

    expect(executed).toBe(true)
    expect(completions()).toBe(1)
  })

  test('hands delivery a fence that asks whether this lease is still active', async () => {
    const lease = projectionLease()
    const { queue } = createQueueSpy([lease])
    const checkedLeases: unknown[] = []

    const job = createPlayerDiscoveryProjectionJob({
      deliverPending: async (_batchSize, _effectOperationId, isLeaseActive) => {
        expect(await isLeaseActive()).toBe(false)
      },
      projectionEffectState: async () => 'none',
      leaseActive: async (checked) => {
        checkedLeases.push(checked.operationId)

        return false
      },
    })

    await runJobOnce(queue, job)

    expect(checkedLeases).toEqual([lease.operationId])
  })

  test('retries projection reconciliation failures without consuming the final attempt', async () => {
    const { queue, failures, appliedRetries } = createQueueSpy([projectionLease(1)])

    const job = failingJob(async () => {
      throw new Error('receipt lookup unavailable')
    }, new Error('owner acknowledgment failed'))

    expect(await runJobOnce(queue, job)).toBe('retry')

    expect(appliedRetries()).toBe(1)
    expect(failures).toEqual([])
  })

  test('fails with player_discovery_projection_failed when nothing landed', async () => {
    const { queue, failures } = createQueueSpy([projectionLease()])

    await runJobOnce(
      queue,
      failingJob(async () => 'none'),
    )

    expect(failures.map(({ code }) => code)).toEqual(['player_discovery_projection_failed'])
  })

  test('completes when the failed attempt turns out to be acknowledged', async () => {
    const { queue, completions, failures } = createQueueSpy([projectionLease()])

    expect(
      await runJobOnce(
        queue,
        failingJob(async () => 'acknowledged'),
      ),
    ).toBe('succeeded')

    expect(completions()).toBe(1)
    expect(failures).toEqual([])
  })

  test('retries an applied effect without spending the attempt', async () => {
    const { queue, failures, appliedRetries } = createQueueSpy([projectionLease()])

    expect(
      await runJobOnce(
        queue,
        failingJob(async () => 'applied'),
      ),
    ).toBe('retry')

    expect(appliedRetries()).toBe(1)
    expect(failures).toEqual([])
  })

  test('waits for the source before asking whether the effect landed', async () => {
    const { queue, deferrals, appliedRetries } = createQueueSpy([projectionLease()])
    let effectStateReads = 0

    const job = failingJob(async () => {
      effectStateReads++

      return 'applied'
    }, new SourceAdmissionLimitedError(30))

    expect(await runJobOnce(queue, job)).toBe('retry')

    expect(deferrals.map(({ code }) => code)).toEqual(['source_rate_limited'])
    expect(appliedRetries()).toBe(0)
    expect(effectStateReads).toBe(0)
  })

  test('reads the effect state by effect operation and takes the discovery claim lock', async () => {
    const readIds: string[] = []

    const job = createPlayerDiscoveryProjectionJob({
      deliverPending: async () => {},
      projectionEffectState: async (effectOperationId) => {
        readIds.push(effectOperationId)

        return 'applied'
      },
      leaseActive: async () => true,
    })

    const state = await job.effectState?.({} as never, {
      operationId: 'operation',
      effectOperationId: 'effect',
      payload: { batchSize: 1 },
    })

    expect(state).toBe('applied')
    expect(readIds).toEqual(['effect'])
    expect(job.claimLockKey?.('effect')).toBe('discovery-effect:effect')
  })
})
