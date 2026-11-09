import { describe, expect, test } from 'bun:test'
import type { OperationFailure, OperationLease } from '@brawltome/queue'
import { createTelemetry } from '@brawltome/telemetry'
import type { LeaderboardPlayerStanding } from '../../jobs/player-propagation'
import { LeaderboardSourceError } from '../../v1-leaderboard-source'
import { runLeaderboardJobOnce } from './leaderboard-job-fixtures'

const collectionKinds = ['leaderboard-1v1', 'leaderboard-2v2', 'leaderboard-solo-2v2', 'leaderboard-3v3'] as const

function collectionLeaseOfKind(kind: (typeof collectionKinds)[number]): OperationLease {
  return {
    operationId: crypto.randomUUID(),
    effectOperationId: crypto.randomUUID(),
    effectCreatedAt: new Date().toISOString(),
    operationKey: `${kind}:failure-code`,
    kind,
    workClass: 'leaderboard',
    payload: { pageDepth: 1, intervalMs: 900_000 },
    provenance: { source: 'test' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber: 1,
    maxAttempts: 3,
    scheduleWindowAt: null,
  }
}

describe('leaderboard collection job', () => {
  test('records leaderboard source calls without correlation IDs in labels', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:telemetry',
      kind: 'leaderboard-1v1',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 60_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }

    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })

    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => 'transitioned' as const,
      fail: async () => 'transitioned' as const,
    }

    await runLeaderboardJobOnce(operations, lease, {
      telemetry,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
      },
      publication: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      source: {
        fetchPage: async () => ({ rankings: [], totalPages: 1 }),
      },
    })

    const sourceMetrics = telemetry.metrics.snapshot().find(({ name }) => name === 'source_calls_total')

    expect(sourceMetrics?.series[0]?.labels).toEqual({ domain: 'brawlhalla-v1', outcome: 'succeeded' })
    expect(JSON.stringify(sourceMetrics)).not.toContain(lease.operationId)
  })

  test('waits for leaderboard source admission and resumes without refetching collected pages', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:admission-wait',
      kind: 'leaderboard-1v1',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 3_600_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 7,
      attemptNumber: 2,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }

    const reservations: string[] = []
    const waits: number[] = []
    let sourceCalls = 0

    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => 'transitioned' as const,
      fail: async () => 'transitioned' as const,
    }

    await runLeaderboardJobOnce(operations, lease, {
      sourceAdmission: {
        admitSource: async ({ reservationKey }) => {
          reservations.push(reservationKey)

          return reservations.length === 1
            ? ({ outcome: 'rate-limited', retryAfterSeconds: 12 } as const)
            : ({ outcome: 'admitted', deduplicated: false } as const)
        },
      },
      waitForSourceAdmission: async (retryAfterMs) => {
        waits.push(retryAfterMs)
      },
      publication: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      source: {
        fetchPage: async ({ region }) => {
          sourceCalls += 1
          const id = sourceCalls

          return {
            rankings: [
              {
                identity: { type: 'one-vs-one-player', player: { id, username: `Player ${id}` } },
                rating: 2_100,
                best_rating: 2_100,
                rank: 1,
                wins: 1,
                losses: 0,
                region,
                tier: 'Diamond',
              },
            ],
            totalPages: 1,
          }
        },
      },
    })

    expect(waits).toEqual([12_000])
    expect(sourceCalls).toBe(9)
    expect(reservations[0]).toBe(`${lease.operationId}:7:1v1:US-E:1`)
    expect(reservations[1]).toBe(reservations[0])
  })

  test('retries a transient leaderboard page failure in place through fresh source admission', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:page-retry',
      kind: 'leaderboard-3v3',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 4,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }

    const reservations: string[] = []
    const retryWaits: number[] = []
    const calls: string[] = []
    let completed = false
    let deferred = false

    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      complete: async () => {
        completed = true

        return 'transitioned' as const
      },
      defer: async () => {
        deferred = true

        return 'transitioned' as const
      },
      fail: async () => 'transitioned' as const,
    }

    await runLeaderboardJobOnce(operations, lease, {
      sourceAdmission: {
        admitSource: async ({ reservationKey }) => {
          reservations.push(reservationKey)

          return { outcome: 'admitted', deduplicated: false }
        },
      },
      waitForSourceRetry: async (delayMs) => {
        retryWaits.push(delayMs)
      },
      publication: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      source: {
        fetchPage: async ({ region }) => {
          calls.push(region)
          if (region === 'EU' && calls.filter((called) => called === 'EU').length === 1) {
            throw new LeaderboardSourceError('source_transport_failed', 'socket reset', true)
          }

          if (region === 'SEA' && calls.filter((called) => called === 'SEA').length <= 2) {
            throw new LeaderboardSourceError('source_unavailable', 'V1 leaderboard returned 504', true)
          }

          const id = calls.length

          return {
            rankings: [
              {
                identity: { type: 'three-vs-three-player', player: { id, username: `Player ${id}` } },
                rating: 2_100,
                best_rating: 2_100,
                rank: 1,
                wins: 1,
                losses: 0,
                region,
                tier: 'Diamond',
              },
            ],
            totalPages: 1,
          }
        },
      },
    })

    expect(completed).toBe(true)
    expect(deferred).toBe(false)
    expect(calls).toHaveLength(12)
    expect(retryWaits).toEqual([500, 500, 2_000])
    expect(reservations).toHaveLength(12)
    expect(new Set(reservations).size).toBe(12)
    expect(reservations).toContain(`${lease.operationId}:4:3v3:EU:1:retry-1`)
    expect(reservations).toContain(`${lease.operationId}:4:3v3:SEA:1:retry-2`)
  })

  test('leaves leaderboard rate limits to durable backoff instead of retrying in place', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:rate-limited',
      kind: 'leaderboard-1v1',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }

    let sourceCalls = 0
    let deferred: OperationFailure | undefined

    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      defer: async (_lease: OperationLease, failure: OperationFailure) => {
        deferred = failure

        return 'transitioned' as const
      },
      fail: async () => 'transitioned' as const,
    }

    await runLeaderboardJobOnce(operations, lease, {
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
      },
      waitForSourceRetry: async () => {},
      publication: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      source: {
        fetchPage: async () => {
          sourceCalls += 1
          throw new LeaderboardSourceError('source_rate_limited', 'V1 leaderboard returned 429', true)
        },
      },
    })

    expect(sourceCalls).toBe(1)
    expect(deferred).toMatchObject({ code: 'source_rate_limited' })
  })

  test('defers retryable leaderboard source outages without consuming the final attempt', async () => {
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })

    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:source-outage',
      kind: 'leaderboard-3v3',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 3,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }

    let deferredMs: number | undefined
    let failed = false
    let sourceCalls = 0

    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      defer: async (_lease: OperationLease, _failure: OperationFailure, retryDelayMs: number) => {
        deferredMs = retryDelayMs

        return 'transitioned' as const
      },
      fail: async () => {
        failed = true

        return 'transitioned' as const
      },
    }

    await runLeaderboardJobOnce(operations, lease, {
      retryTimings: { retryDelayMs: 10, sourceUnavailableRetryMs: 60_000 },
      telemetry,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
      },
      publication: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      waitForSourceRetry: async () => {},
      source: {
        fetchPage: async () => {
          sourceCalls += 1
          throw new LeaderboardSourceError('source_unavailable', 'V1 leaderboard returned 502', true)
        },
      },
    })

    expect(sourceCalls).toBe(3)
    expect(deferredMs).toBe(60_000)
    expect(failed).toBe(false)
    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')

    expect(failures?.series[0]?.labels.failure_category).toBe('source_unavailable')
  })

  test('defers inconsistent leaderboard identity without consuming the final attempt', async () => {
    const telemetry = createTelemetry({ service: 'worker', drainIntervalMs: 0 })

    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'leaderboard:inconsistent-team',
      kind: 'leaderboard-2v2',
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 3,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }

    let deferred: { failure: OperationFailure; retryDelayMs: number } | undefined

    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      defer: async (_lease: OperationLease, failure: OperationFailure, retryDelayMs: number) => {
        deferred = { failure, retryDelayMs }

        return 'transitioned' as const
      },
    }

    await runLeaderboardJobOnce(operations, lease, {
      retryTimings: { retryDelayMs: 10, sourceUnavailableRetryMs: 1_000 },
      telemetry,
      sourceAdmission: {
        admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
      },
      publication: {
        publishGeneration: async () => 'published' as const,
        recordCollectionFailure: async () => 'recorded' as const,
      },
      source: {
        fetchPage: async () => {
          throw new LeaderboardSourceError(
            'source_data_inconsistent',
            'rankings[0].players must contain distinct player IDs',
            true,
          )
        },
      },
    })

    expect(deferred).toEqual({
      failure: {
        code: 'source_data_inconsistent',
        message: 'rankings[0].players must contain distinct player IDs',
        retryable: true,
      },
      retryDelayMs: 60_000,
    })

    const failures = telemetry.metrics.snapshot().find(({ name }) => name === 'refresh_failures_total')

    expect(failures?.series[0]?.labels.failure_category).toBe('source_unavailable')
  })

  test('propagates published leaderboard player names without failing the publication', async () => {
    const leaseFor = (kind: 'leaderboard-1v1' | 'leaderboard-2v2'): OperationLease => ({
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: `leaderboard:names:${kind}`,
      kind,
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    })

    const run = async (
      lease: OperationLease,
      published: 'published' | 'already-published' | 'effect-conflict',
      applyLeaderboardNames: (input: {
        observedAt: Date
        players: Array<{ brawlhallaId: number; name: string }>
      }) => Promise<{ changed: number }>,
      applyLeaderboardRanked: (input: {
        observedAt: Date
        players: Array<{ brawlhallaId: number; rating: number }>
      }) => Promise<{ changed: number }> = async () => ({ changed: 0 }),
    ) => {
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

      await runLeaderboardJobOnce(operations, lease, {
        sourceAdmission: {
          admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
        },
        publication: {
          publishGeneration: async () => published,
          recordCollectionFailure: async () => 'recorded' as const,
        },
        playerNames: { applyLeaderboardNames },
        rankedStandings: { applyLeaderboardRanked },
        source: {
          fetchPage: async ({ region }) => {
            const base = (regionIndex.get(region) ?? 0) * 10 + 1

            return {
              rankings: [
                {
                  identity:
                    lease.kind === 'leaderboard-2v2'
                      ? {
                          type: 'fixed-two-vs-two-team',
                          players: [
                            { id: base, username: `First ${base}` },
                            { id: base + 1, username: `Second ${base + 1}` },
                          ],
                        }
                      : { type: 'one-vs-one-player', player: { id: base, username: `Solo ${base}` } },
                  rating: 2_100,
                  best_rating: 2_100,
                  rank: 1,
                  wins: 1,
                  losses: 0,
                  region,
                  tier: 'Diamond',
                },
              ],
              totalPages: 1,
            }
          },
        },
      })

      return completed
    }

    const regionIndex = new Map(['US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'].map((r, i) => [r, i]))

    const applied: Array<{ observedAt: Date; players: Array<{ brawlhallaId: number; name: string }> }> = []

    const record = async (input: { observedAt: Date; players: Array<{ brawlhallaId: number; name: string }> }) => {
      applied.push(input)

      return { changed: input.players.length }
    }

    expect(await run(leaseFor('leaderboard-2v2'), 'published', record)).toBe(true)
    expect(applied).toHaveLength(1)
    expect(applied[0].observedAt).toBeInstanceOf(Date)
    expect(applied[0].players).toHaveLength(18)
    expect(applied[0].players).toContainEqual({ brawlhallaId: 1, name: 'First 1' })
    expect(applied[0].players).toContainEqual({ brawlhallaId: 2, name: 'Second 2' })

    expect(await run(leaseFor('leaderboard-1v1'), 'already-published', record)).toBe(true)
    expect(applied).toHaveLength(2)
    expect(applied[1].players).toHaveLength(9)
    expect(applied[1].players).toContainEqual({ brawlhallaId: 81, name: 'Solo 81' })

    await run(leaseFor('leaderboard-1v1'), 'effect-conflict', record)
    expect(applied).toHaveLength(2)

    expect(
      await run(leaseFor('leaderboard-1v1'), 'published', async () => {
        throw new Error('players database unavailable')
      }),
    ).toBe(true)
  })

  test('propagates published 1v1 standings without failing the publication', async () => {
    const standings: Array<{ observedAt: Date; players: LeaderboardPlayerStanding[] }> = []

    const recordStandings = async (input: { observedAt: Date; players: LeaderboardPlayerStanding[] }) => {
      standings.push(input)

      return { changed: input.players.length }
    }

    const noNames = async () => ({ changed: 0 })

    const lease = (kind: 'leaderboard-1v1' | 'leaderboard-2v2'): OperationLease => ({
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: `leaderboard:standings:${kind}`,
      kind,
      workClass: 'leaderboard',
      payload: { pageDepth: 1, intervalMs: 900_000 },
      provenance: { source: 'test' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    })

    const regionIndex = new Map(['US-E', 'US-W', 'EU', 'SEA', 'AUS', 'BRZ', 'JPN', 'ME', 'SA'].map((r, i) => [r, i]))

    const run = (
      operationLease: OperationLease,
      applyLeaderboardRanked: typeof recordStandings | (() => Promise<never>),
    ) => {
      let completed = false

      return runLeaderboardJobOnce(
        {
          claim: async () => operationLease,
          renew: async () => 'renewed' as const,
          complete: async () => {
            completed = true

            return 'transitioned' as const
          },
          fail: async () => 'transitioned' as const,
        },
        operationLease,
        {
          sourceAdmission: {
            admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
          },
          publication: {
            publishGeneration: async () => 'published' as const,
            recordCollectionFailure: async () => 'recorded' as const,
          },
          playerNames: { applyLeaderboardNames: noNames },
          rankedStandings: { applyLeaderboardRanked },
          source: {
            fetchPage: async ({ region }) => {
              const id = (regionIndex.get(region) ?? 0) * 10 + 1

              return {
                rankings: [
                  {
                    identity:
                      operationLease.kind === 'leaderboard-2v2'
                        ? {
                            type: 'fixed-two-vs-two-team',
                            players: [
                              { id, username: `First ${id}` },
                              { id: id + 1, username: `Second ${id + 1}` },
                            ],
                          }
                        : { type: 'one-vs-one-player', player: { id, username: `Solo ${id}` } },
                    rating: 1_973,
                    best_rating: 2_039,
                    rank: 1,
                    wins: 39,
                    losses: 30,
                    region,
                    tier: 'Diamond',
                  },
                ],
                totalPages: 1,
              }
            },
          },
        },
      ).then(() => completed)
    }

    expect(await run(lease('leaderboard-2v2'), recordStandings)).toBe(true)
    expect(standings).toHaveLength(0)

    expect(await run(lease('leaderboard-1v1'), recordStandings)).toBe(true)
    expect(standings).toHaveLength(1)
    expect(standings[0].players).toHaveLength(9)

    expect(standings[0].players).toContainEqual({
      brawlhallaId: 41,
      region: 'AUS',
      rating: 1_973,
      peakRating: 2_039,
      tier: 'Diamond',
      wins: 39,
      games: 69,
    })

    expect(
      await run(lease('leaderboard-1v1'), async () => {
        throw new Error('players database unavailable')
      }),
    ).toBe(true)
  })

  test.each(collectionKinds)('%s fails with leaderboard_collection_failed', async (kind) => {
    const lease = collectionLeaseOfKind(kind)
    const failures: OperationFailure[] = []

    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      fail: async (_lease: OperationLease, failure: OperationFailure) => {
        failures.push(failure)

        return 'transitioned' as const
      },
    }

    await runLeaderboardJobOnce(operations, lease, {
      source: {
        fetchPage: async () => {
          throw new Error('execution failed')
        },
      },
    })

    expect(failures.map(({ code }) => code)).toEqual(['leaderboard_collection_failed'])
  })

  test('waits the configured source delay when it is longer than a minute', async () => {
    const lease = collectionLeaseOfKind('leaderboard-3v3')
    let deferredMs: number | undefined

    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      defer: async (_lease: OperationLease, _failure: OperationFailure, retryDelayMs: number) => {
        deferredMs = retryDelayMs

        return 'transitioned' as const
      },
      fail: async () => 'transitioned' as const,
    }

    await runLeaderboardJobOnce(operations, lease, {
      retryTimings: { retryDelayMs: 10, sourceUnavailableRetryMs: 300_000 },
      source: {
        fetchPage: async () => {
          throw new LeaderboardSourceError('source_rate_limited', 'V1 leaderboard returned 429', true)
        },
      },
    })

    expect(deferredMs).toBe(300_000)
  })

  test('a lost lease stops the collection before anything is published', async () => {
    const lease = collectionLeaseOfKind('leaderboard-1v1')
    let publishCalls = 0

    const operations = {
      claim: async () => lease,
      renew: async () => 'lease-lost' as const,
      fail: async () => 'transitioned' as const,
    }

    const outcome = await runLeaderboardJobOnce(operations, lease, {
      publication: {
        publishGeneration: async () => {
          publishCalls += 1

          return 'published'
        },
        recordCollectionFailure: async () => 'recorded',
      },
      source: { fetchPage: async () => ({ rankings: [], totalPages: 1 }) },
    })

    expect(outcome).toBe('lease_lost')
    expect(publishCalls).toBe(0)
  })
})
