import { describe, expect, test } from 'bun:test'
import { runJobOnce } from '@brawltome/refresh-operations/testing'
import { createMemorySink, createTelemetry } from '@brawltome/telemetry'
import { createClanDiscoveryProjectionJob } from '../../jobs/clan-discovery-projection-job'
import { createDiscoveryReconciliationJob } from '../../jobs/discovery-reconciliation-job'
import { createQueueSpy, discoveryLease } from './job-fixtures'

function clanLease() {
  return discoveryLease({ kind: 'clan-discovery-projection', payload: { batchSize: 100 } })
}

describe('clan discovery projection job', () => {
  test('executes clan projection and owner reconciliation before the leaderboard fallback', async () => {
    const leases = [clanLease(), discoveryLease({ kind: 'discovery-reconciliation', payload: { owner: 'clan' } })]
    const operationIds = leases.map(({ operationId }) => operationId)
    const executed: string[] = []
    const sink = createMemorySink()
    const telemetry = createTelemetry({ service: 'worker', sink, drainIntervalMs: 0 })
    const { queue } = createQueueSpy(leases)

    const clanJob = createClanDiscoveryProjectionJob({
      deliverPending: async () => {
        executed.push('clan-discovery-projection')
      },
      projectionEffectState: async () => 'none',
      leaseActive: async () => true,
    })

    const reconciliationJob = createDiscoveryReconciliationJob({
      reconcile: async (owner) => {
        executed.push(`discovery-reconciliation:${owner}`)
      },
      reconciliationEffectApplied: async () => false,
      leaseActive: async () => true,
    })

    await runJobOnce(queue, clanJob, { telemetry })
    await runJobOnce(queue, reconciliationJob, { telemetry })

    await telemetry.flush(50)

    expect(executed).toEqual(['clan-discovery-projection', 'discovery-reconciliation:clan'])
    expect(sink.records.some(({ attributes }) => attributes?.kind === 'clan-discovery-projection')).toBe(true)
    expect(sink.records.some(({ attributes }) => attributes?.kind === 'discovery-reconciliation')).toBe(true)
    const metrics = JSON.stringify(telemetry.metrics.snapshot())

    expect(metrics).toContain('clan-discovery-projection')
    expect(metrics).toContain('discovery-reconciliation')
    for (const operationId of operationIds) expect(metrics).not.toContain(operationId)
  })

  test('fails with clan_discovery_projection_failed when nothing landed', async () => {
    const { queue, failures } = createQueueSpy([clanLease()])

    const job = createClanDiscoveryProjectionJob({
      deliverPending: async () => {
        throw new Error('delivery failed')
      },
      projectionEffectState: async () => 'none',
      leaseActive: async () => true,
    })

    await runJobOnce(queue, job)

    expect(failures.map(({ code }) => code)).toEqual(['clan_discovery_projection_failed'])
  })

  test('retries an applied effect and takes the discovery claim lock', async () => {
    const { queue, appliedRetries } = createQueueSpy([clanLease()])

    const job = createClanDiscoveryProjectionJob({
      deliverPending: async () => {
        throw new Error('owner acknowledgment failed')
      },
      projectionEffectState: async () => 'applied',
      leaseActive: async () => true,
    })

    expect(await runJobOnce(queue, job)).toBe('retry')

    expect(appliedRetries()).toBe(1)
    expect(job.claimLockKey?.('effect')).toBe('discovery-effect:effect')
  })
})
