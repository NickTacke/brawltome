import { describe, expect, test } from 'bun:test'
import type { Lease, OperationFailure, QueueWorker, SourceAdmissionPort } from '@brawltome/queue'
import { runJobOnce } from '@brawltome/queue/testing'
import { createTelemetry } from '@brawltome/telemetry'
import type { ClanRefreshEffect } from '../../domain/refresh-effect'
import type { ClanRefreshPayload } from '../../jobs/clan-refresh-contract'
import { type ClanRefreshJobDependencies, createClanRefreshJob } from '../../jobs/clan-refresh-job'

type Renewal = { outcome: 'renewed'; leaseExpiresAt: Date } | { outcome: 'lease-lost' }

function clanLease(clanId: number, staleSections: ClanRefreshPayload['staleSections'], attemptNumber = 1) {
  const lease: Lease<unknown> = {
    operationId: crypto.randomUUID(),
    effectOperationId: crypto.randomUUID(),
    effectCreatedAt: new Date().toISOString(),
    operationKey: `clan:${clanId}`,
    kind: 'clan-refresh',
    workClass: 'interactive',
    payload: { clanId, staleSections },
    provenance: { source: 'test' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber,
    maxAttempts: 3,
    scheduleWindowAt: null,
  }

  return lease
}

function renewedLease(): Renewal {
  return { outcome: 'renewed', leaseExpiresAt: new Date(Date.now() + 60_000) }
}

function createQueueSpy(lease: Lease<unknown>, nextRenewal: () => Renewal = renewedLease) {
  const committed: string[] = []
  const deferred: { failure: OperationFailure; retryDelayMs: number }[] = []
  const failed: { failure: OperationFailure; retryDelayMs: number }[] = []
  let completions = 0

  const queue = {
    claim: async () => lease,
    renew: async () => 'renewed' as const,
    renewWithAuthority: async () => nextRenewal(),
    beginInteractiveSection: async () => 'execute' as const,
    commitInteractiveSection: async (_lease: Lease<unknown>, section: string) => {
      committed.push(section)

      return 'transitioned' as const
    },
    complete: async () => {
      completions++

      return 'transitioned' as const
    },
    defer: async (_lease: Lease<unknown>, failure: OperationFailure, retryDelayMs: number) => {
      deferred.push({ failure, retryDelayMs })

      return 'transitioned' as const
    },
    fail: async (_lease: Lease<unknown>, failure: OperationFailure, retryDelayMs: number) => {
      failed.push({ failure, retryDelayMs })

      return 'transitioned' as const
    },
  } as unknown as QueueWorker

  return { queue, committed, deferred, failed, completions: () => completions }
}

function guildStats(clanId: number) {
  return {
    guild_id: clanId,
    name: 'Clan',
    create_date: 1660000000,
    xp: '10',
    legacy_xp: '10',
    notice: '',
    tags: [],
    discord_invite_code: '',
    guild_points: '10',
    is_recruiting: false,
  }
}

function createClanStore(overrides: Partial<ClanRefreshJobDependencies['clans']> = {}) {
  const prepared: ClanRefreshEffect[] = []
  const revoked: ClanRefreshEffect[] = []

  const clans: ClanRefreshJobDependencies['clans'] = {
    prepareRefreshEffect: async (effect) => {
      prepared.push(effect)

      return 'execute'
    },
    revokeRefreshEffect: async (effect) => {
      revoked.push(effect)
    },
    publishProfile: async () => 'applied',
    publishRoster: async () => 'applied',
    recordProfileCheck: async () => true,
    recordRosterCheck: async () => true,
    ...overrides,
  }

  return { clans, prepared, revoked }
}

function sourceAdmission(admission: Awaited<ReturnType<SourceAdmissionPort['admitSource']>>): SourceAdmissionPort {
  return {
    admitSource: async () => admission,
    pauseSource: async () => {},
  }
}

const admitted = sourceAdmission({ outcome: 'admitted' })

// the sources only reach the admission check; the section fails or publishes around it
function admittingSource(admitSource: Parameters<ClanRefreshJobDependencies['createAdmittedSource']>[0]) {
  return {
    getGuildStatsV1: async () => {
      await admitSource('brawlhalla-v1')

      return guildStats(77)
    },
    getGuildMembersV1: async () => {
      await admitSource('brawlhalla-v1')

      return null
    },
  }
}

describe('clan refresh job', () => {
  test('defers clan source admission without consuming its execution attempt', async () => {
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })
    const { queue, deferred, failed } = createQueueSpy(clanLease(77, ['profile'], 3))
    const { clans } = createClanStore()
    const job = createClanRefreshJob({ clans, createAdmittedSource: admittingSource })

    await runJobOnce(queue, job, {
      leaseMs: 1_000,
      retryDelayMs: 10,
      telemetry,
      sourceAdmission: sourceAdmission({ outcome: 'rate-limited', retryAfterSeconds: 37 }),
    })

    expect(deferred).toEqual([
      {
        failure: { code: 'source_rate_limited', message: 'Source admission is rate limited', retryable: true },
        retryDelayMs: 37_000,
      },
    ])

    expect(failed).toEqual([])
    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')

    expect(failures?.series[0]?.labels.failure_category).toBe('admission_deferred')
  })

  test('lost renewal mid-section revokes authority and does not commit', async () => {
    let renewals = 0

    const { queue, committed } = createQueueSpy(clanLease(77, ['profile']), () => {
      renewals++

      return renewals === 1 ? renewedLease() : { outcome: 'lease-lost' }
    })

    const { clans, revoked } = createClanStore()

    const job = createClanRefreshJob({
      clans,
      createAdmittedSource: () => ({
        // publishing would succeed, so only the lost lease can keep this from committing
        getGuildStatsV1: async () => {
          await new Promise((resolve) => setTimeout(resolve, 15))

          return guildStats(77)
        },
        getGuildMembersV1: async () => null,
      }),
    })

    expect(
      await runJobOnce(queue, job, { leaseMs: 1_000, renewEveryMs: 1, retryDelayMs: 10, sourceAdmission: admitted }),
    ).toBe('lease_lost')

    expect(revoked).toHaveLength(1)
    expect(revoked[0]).toMatchObject({ section: 'profile', leaseToken: 1, leaseExpiresAt: new Date(0) })
    expect(committed).toEqual([])
  })

  test('preserves a genuine section failure when another section is source-limited', async () => {
    const { queue, deferred, failed } = createQueueSpy(clanLease(78, ['profile', 'roster'], 3))
    const { clans } = createClanStore()

    const job = createClanRefreshJob({
      clans,
      createAdmittedSource: (admitSource) => ({
        getGuildStatsV1: async () => {
          throw new Error('generic profile failure')
        },
        getGuildMembersV1: async () => {
          await admitSource('brawlhalla-v1')

          return null
        },
      }),
    })

    await runJobOnce(queue, job, {
      leaseMs: 1_000,
      retryDelayMs: 10,
      sourceAdmission: sourceAdmission({ outcome: 'rate-limited', retryAfterSeconds: 41 }),
    })

    expect(failed).toEqual([
      {
        failure: { code: 'clan_refresh_failed', message: 'generic profile failure', retryable: true },
        retryDelayMs: 10,
      },
    ])

    expect(deferred).toEqual([])
  })

  test('fails with clan_refresh_failed when a section throws', async () => {
    const { queue, failed } = createQueueSpy(clanLease(77, ['profile']))

    const { clans } = createClanStore({
      prepareRefreshEffect: async () => {
        throw new Error('execution failed')
      },
    })

    const job = createClanRefreshJob({ clans, createAdmittedSource: admittingSource })

    await runJobOnce(queue, job, { leaseMs: 1_000, retryDelayMs: 10, sourceAdmission: admitted })

    expect(failed.map(({ failure }) => failure.code)).toEqual(['clan_refresh_failed'])
  })

  test('binds each section to the expiry of its own renewal before calling the source', async () => {
    const lease = clanLease(77, ['profile'])
    const leaseExpiresAt = new Date(Date.now() + 60_000)
    const steps: string[] = []

    const { queue, committed, completions } = createQueueSpy(lease, () => ({ outcome: 'renewed', leaseExpiresAt }))

    const { clans, prepared } = createClanStore()

    const synced: ClanRefreshJobDependencies['clans'] = {
      ...clans,
      prepareRefreshEffect: async (effect) => {
        steps.push('prepare')

        return clans.prepareRefreshEffect(effect)
      },
    }

    const job = createClanRefreshJob({
      clans: synced,
      createAdmittedSource: () => ({
        getGuildStatsV1: async () => {
          steps.push('source')

          return guildStats(77)
        },
        getGuildMembersV1: async () => null,
      }),
    })

    expect(await runJobOnce(queue, job, { leaseMs: 10_000, retryDelayMs: 10, sourceAdmission: admitted })).toBe(
      'succeeded',
    )

    expect(steps.indexOf('prepare')).toBeLessThan(steps.indexOf('source'))

    expect(prepared[0]).toEqual({
      operationId: lease.effectOperationId,
      section: 'profile',
      leaseToken: 1,
      leaseExpiresAt,
    })

    expect(committed).toEqual(['profile'])
    expect(completions()).toBe(1)
  })

  test('fences the section when the lease authority was taken', async () => {
    const { queue, failed } = createQueueSpy(clanLease(77, ['profile']))

    const { clans } = createClanStore({ prepareRefreshEffect: async () => 'fenced' })
    const job = createClanRefreshJob({ clans, createAdmittedSource: admittingSource })

    await runJobOnce(queue, job, { leaseMs: 1_000, retryDelayMs: 10, sourceAdmission: admitted })

    expect(failed.map(({ failure }) => failure)).toEqual([
      { code: 'clan_refresh_failed', message: 'profile refresh lease was fenced', retryable: true },
    ])
  })
})
