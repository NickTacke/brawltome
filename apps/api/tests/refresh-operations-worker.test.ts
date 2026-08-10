import { describe, expect, test } from 'bun:test'
import type { AdmissionConfig, OperationFailure, OperationLease } from '@brawltome/refresh-operations'
import { runOneRefreshOperation } from '../src/refresh-operations-worker'

const admission: AdmissionConfig = {
  totalConcurrency: 2,
  interactiveReservation: 1,
  classConcurrency: {
    interactive: 2,
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
  backgroundWeights: {
    'primary-monitoring': 1,
    leaderboard: 1,
    'global-statistics': 1,
    projection: 1,
    maintenance: 1,
  },
}

describe('refresh operations worker source retry', () => {
  test('executes player projection work through the durable projection class', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      operationKey: 'discovery:players:test',
      kind: 'player-discovery-projection',
      workClass: 'projection',
      payload: { batchSize: 100 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    let executed = false
    let completed = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => {
        completed = true
        return 'transitioned' as const
      },
      fail: async () => 'transitioned' as const,
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      executePlayerProjection: async (claimed) => {
        expect(claimed).toBe(lease)
        executed = true
      },
    })

    expect(executed).toBe(true)
    expect(completed).toBe(true)
  })

  test('retries projection reconciliation failures without consuming the final attempt', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      operationKey: 'discovery:players:failed-reconciliation',
      kind: 'player-discovery-projection',
      workClass: 'projection',
      payload: { batchSize: 100 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 1,
      scheduleWindowAt: null,
    }
    let retried = false
    let failed = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => 'transitioned' as const,
      retryAppliedPlayerProjection: async () => {
        retried = true
        return 'transitioned' as const
      },
      fail: async () => {
        failed = true
        return 'transitioned' as const
      },
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      executePlayerProjection: async () => {
        throw new Error('owner acknowledgment failed')
      },
      playerProjectionEffectState: async () => {
        throw new Error('receipt lookup unavailable')
      },
    })

    expect(retried).toBe(true)
    expect(failed).toBe(false)
  })

  test('preserves source admission Retry-After for clan failures', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      operationKey: 'clan:77',
      kind: 'clan-refresh',
      workClass: 'interactive',
      payload: { clanId: 77, staleSections: ['profile'] },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    const observed: { failed?: { failure: OperationFailure; retryDelayMs: number } } = {}
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      renewWithAuthority: async () => ({ outcome: 'renewed', leaseExpiresAt: new Date(Date.now() + 60_000) }) as const,
      beginInteractiveSection: async () => 'execute' as const,
      commitInteractiveSection: async () => 'transitioned' as const,
      complete: async () => 'transitioned' as const,
      fail: async (_lease: OperationLease, failure: OperationFailure, retryDelayMs: number) => {
        observed.failed = { failure, retryDelayMs }
        return 'transitioned' as const
      },
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'rate-limited', retryAfterSeconds: 37 }),
      },
      syncClanLeaseAuthority: async () => {},
      executeClanSection: async (_lease, _section, admitSourceCall) => {
        await admitSourceCall('brawlhalla-v1')
      },
    })

    expect(observed.failed).toEqual({
      failure: { code: 'source_rate_limited', message: 'Source admission is rate limited', retryable: true },
      retryDelayMs: 37_000,
    })
  })

  test('revokes active clan authority and skips publication completion after renewal loss', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      operationKey: 'clan:renewal-loss',
      kind: 'clan-refresh',
      workClass: 'interactive',
      payload: { clanId: 79, staleSections: ['profile'] },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    let renewals = 0
    let revoked = false
    let committed = false
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      renewWithAuthority: async () => {
        renewals++
        return renewals === 1
          ? ({ outcome: 'renewed', leaseExpiresAt: new Date(Date.now() + 60_000) } as const)
          : ({ outcome: 'lease-lost' } as const)
      },
      beginInteractiveSection: async () => 'execute' as const,
      commitInteractiveSection: async () => {
        committed = true
        return 'transitioned' as const
      },
      complete: async () => 'transitioned' as const,
      fail: async () => 'transitioned' as const,
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      renewEveryMs: 1,
      retryDelayMs: 10,
      admission,
      sourceAdmission: { admitSource: async () => ({ outcome: 'admitted', deduplicated: false }) },
      syncClanLeaseAuthority: async () => {},
      revokeClanLeaseAuthority: async () => {
        revoked = true
      },
      executeClanSection: async () => {
        await new Promise((resolve) => setTimeout(resolve, 15))
      },
    })

    expect(revoked).toBe(true)
    expect(committed).toBe(false)
  })

  test('prefers the maximum retry-aware failure after an earlier generic section failure', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      operationKey: 'clan:78',
      kind: 'clan-refresh',
      workClass: 'interactive',
      payload: { clanId: 78, staleSections: ['profile', 'roster'] },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: null,
    }
    const observed: { failed?: { failure: OperationFailure; retryDelayMs: number } } = {}
    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      renewWithAuthority: async () => ({ outcome: 'renewed', leaseExpiresAt: new Date(Date.now() + 60_000) }) as const,
      beginInteractiveSection: async () => 'execute' as const,
      commitInteractiveSection: async () => 'transitioned' as const,
      complete: async () => 'transitioned' as const,
      fail: async (_lease: OperationLease, failure: OperationFailure, retryDelayMs: number) => {
        observed.failed = { failure, retryDelayMs }
        return 'transitioned' as const
      },
    }

    await runOneRefreshOperation(operations as never, 'worker', {
      leaseMs: 1_000,
      retryDelayMs: 10,
      admission,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'rate-limited', retryAfterSeconds: 41 }),
      },
      syncClanLeaseAuthority: async () => {},
      executeClanSection: async (_lease, section, admitSourceCall) => {
        if (section === 'profile') throw new Error('generic profile failure')
        await admitSourceCall('brawlhalla-v1')
      },
    })

    expect(observed.failed).toEqual({
      failure: { code: 'source_rate_limited', message: 'Source admission is rate limited', retryable: true },
      retryDelayMs: 41_000,
    })
  })
})
