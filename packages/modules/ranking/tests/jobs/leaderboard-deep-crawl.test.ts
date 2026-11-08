import { describe, expect, test } from 'bun:test'
import type { OperationFailure, OperationLease } from '@brawltome/refresh-operations'
import { defaultDeepCrawlSlicePages } from '../../jobs/leaderboard-deep-crawl-job'
import { LeaderboardDeepCrawlYield } from '../../jobs/leaderboard-failure'
import type { LeaderboardPlayerStanding } from '../../jobs/player-propagation'
import { LeaderboardSourceError } from '../../v1-leaderboard-source'
import { runLeaderboardJobOnce } from './leaderboard-job-fixtures'

function deepCrawlLease(): OperationLease {
  return {
    operationId: crypto.randomUUID(),
    effectOperationId: crypto.randomUUID(),
    effectCreatedAt: new Date().toISOString(),
    operationKey: 'leaderboard-deep-crawl:failure-code',
    kind: 'leaderboard-deep-crawl',
    workClass: 'leaderboard',
    payload: { region: 'AUS', intervalMs: 3_600_000 },
    provenance: { source: 'test' },
    leaseOwner: 'worker',
    leaseToken: 1,
    attemptNumber: 1,
    maxAttempts: 3,
    scheduleWindowAt: null,
  }
}

describe('leaderboard deep crawl job', () => {
  test('deep crawls every page of a region and writes standings in chunks without publishing', async () => {
    const lease: OperationLease = {
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: 'rankings:1v1:deep:AUS:1',
      kind: 'leaderboard-deep-crawl',
      workClass: 'leaderboard',
      payload: { region: 'AUS', intervalMs: 3 * 60 * 60 * 1000 },
      provenance: { source: 'leaderboard-deep-crawl-schedule' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    }

    type Progress = { windowAt: Date; nextPage: number; totalPages: number }

    const run = async (
      totalPages: number,
      input: {
        failOnPage?: number
        failure?: LeaderboardSourceError
        slicePages?: number
        saved?: Progress
        pageDelayMs?: number
      } = {},
    ) => {
      const waits: number[] = []
      const fetched: number[] = []
      const nameWrites: number[] = []
      const standingWrites: LeaderboardPlayerStanding[][] = []
      const transitions: string[] = []
      let progress: Progress | null = input.saved ?? null

      await runLeaderboardJobOnce(
        {
          claim: async () => lease,
          renew: async () => 'renewed' as const,
          complete: async () => {
            transitions.push('complete')

            return 'transitioned' as const
          },
          defer: async (_lease: OperationLease, failure: OperationFailure) => {
            transitions.push(`defer:${failure.code}`)

            return 'transitioned' as const
          },
          fail: async (_lease: OperationLease, failure: OperationFailure) => {
            transitions.push(`fail:${failure.code}`)

            return 'transitioned' as const
          },
        },
        lease,
        {
          slicePages: input.slicePages ?? defaultDeepCrawlSlicePages,
          pageDelayMs: input.pageDelayMs ?? 0,
          waitForSourceRetry: async (delayMs: number) => {
            waits.push(delayMs)
          },
          progress: {
            read: async () => progress,
            save: async (saved) => {
              progress = { windowAt: saved.windowAt, nextPage: saved.nextPage, totalPages: saved.totalPages }
            },
          },
          sourceAdmission: {
            admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
          },
          publication: {
            publishGeneration: async () => {
              throw new Error('the deep crawl must not publish a generation')
            },
            recordCollectionFailure: async () => 'recorded' as const,
          },
          playerNames: {
            applyLeaderboardNames: async ({ players }) => {
              nameWrites.push(players.length)

              return { changed: 0 }
            },
          },
          rankedStandings: {
            applyLeaderboardRanked: async ({ players }) => {
              standingWrites.push(players)

              return { changed: players.length }
            },
          },
          source: {
            fetchPage: async ({ mode, region, page }) => {
              expect(mode).toBe('1v1')
              expect(region).toBe('AUS')
              fetched.push(page)
              if (page === input.failOnPage) throw input.failure

              if (totalPages === 0) return { rankings: [], totalPages: 0 }

              return {
                totalPages,
                rankings: [
                  {
                    identity: { type: 'one-vs-one-player', player: { id: page, username: `Player ${page}` } },
                    rating: 1_900,
                    best_rating: 2_000,
                    rank: page,
                    wins: 3,
                    losses: 2,
                    region: 'AUS',
                    tier: 'Platinum 5',
                  },
                ],
              }
            },
          },
        },
      )

      return { fetched, nameWrites, standingWrites, transitions, progress, waits }
    }

    const crawl = await run(45)

    expect(crawl.fetched).toEqual(Array.from({ length: 45 }, (_, index) => index + 1))
    expect(crawl.nameWrites).toEqual([20, 20, 5])
    expect(crawl.standingWrites.map((chunk) => chunk.length)).toEqual([20, 20, 5])

    expect(crawl.standingWrites[0][0]).toEqual({
      brawlhallaId: 1,
      region: 'AUS',
      rating: 1_900,
      peakRating: 2_000,
      tier: 'Platinum 5',
      wins: 3,
      games: 5,
    })

    expect(crawl.transitions).toEqual(['complete'])
    expect(crawl.progress).toMatchObject({ nextPage: 46, totalPages: 45 })

    const empty = await run(0)

    expect(empty).toMatchObject({ fetched: [1], nameWrites: [], transitions: ['complete'] })

    // A malformed deep page is skipped rather than failing the region.
    const skipped = await run(45, {
      failOnPage: 30,
      failure: new LeaderboardSourceError('source_contract_invalid', 'rating exceeds best_rating', false),
    })

    expect(skipped.nameWrites).toEqual([20, 20, 4])
    expect(skipped.transitions).toEqual(['complete'])

    // A leaderboard that shrank mid-crawl ends it.
    const shrank = await run(45, {
      failOnPage: 31,
      failure: new LeaderboardSourceError('source_contract_invalid', 'requested page 31 exceeds total_pages 30', false),
    })

    expect(shrank.fetched.at(-1)).toBe(31)
    expect(shrank.nameWrites).toEqual([20, 10])
    expect(shrank.transitions).toEqual(['complete'])

    // An unavailable source defers; a bad first page still fails.
    const unavailable = await run(45, {
      failOnPage: 3,
      failure: new LeaderboardSourceError('source_unavailable', 'maintenance', true),
    })

    expect(unavailable.transitions).toEqual(['defer:source_unavailable'])

    const badFirst = await run(45, {
      failOnPage: 1,
      failure: new LeaderboardSourceError('source_contract_invalid', 'bad page', false),
    })

    expect(badFirst.transitions).toEqual(['fail:source_contract_invalid'])

    // The page delay paces the crawl between pages, not after the last one.
    const paced = await run(5, { pageDelayMs: 400 })

    expect(paced.waits).toEqual([400, 400, 400, 400])
    expect(paced.transitions).toEqual(['complete'])

    // Slices yield the leaderboard slot and the next attempt resumes where the last chunk stopped.
    const firstSlice = await run(100, { slicePages: 40 })

    expect(firstSlice.fetched).toEqual(Array.from({ length: 40 }, (_, index) => index + 1))
    expect(firstSlice.transitions).toEqual(['defer:deep_crawl_yield'])
    expect(firstSlice.progress).toMatchObject({ nextPage: 41, totalPages: 100 })
    const resumed = await run(100, { slicePages: 100, saved: firstSlice.progress as Progress })

    expect(resumed.fetched[0]).toBe(41)
    expect(resumed.fetched).toHaveLength(60)
    expect(resumed.transitions).toEqual(['complete'])
  })

  test('deep crawls solo 2v2 and 2v2 into their own observations without touching names', async () => {
    const leaseFor = (mode: 'solo2v2' | '2v2'): OperationLease => ({
      operationId: crypto.randomUUID(),
      effectOperationId: crypto.randomUUID(),
      effectCreatedAt: new Date().toISOString(),
      operationKey: `rankings:${mode}:deep:EU:1`,
      kind: 'leaderboard-deep-crawl',
      workClass: 'leaderboard',
      payload: { mode, region: 'EU', intervalMs: 60 * 60 * 1000 },
      provenance: { source: 'leaderboard-deep-crawl-schedule' },
      leaseOwner: 'worker',
      leaseToken: 1,
      attemptNumber: 1,
      maxAttempts: 3,
      scheduleWindowAt: new Date().toISOString(),
    })

    const run = async (mode: 'solo2v2' | '2v2', totalPages = 1) => {
      const writes: string[] = []
      const modes: string[] = []
      let saved: { mode: string } | undefined

      await runLeaderboardJobOnce(
        {
          claim: async () => leaseFor(mode),
          renew: async () => 'renewed' as const,
          complete: async () => 'transitioned' as const,
          fail: async () => 'transitioned' as const,
        },
        leaseFor(mode),
        {
          progress: {
            read: async () => null,
            save: async (progress) => {
              saved = progress
            },
          },
          sourceAdmission: {
            admitSource: async () => ({ outcome: 'admitted', deduplicated: false }),
          },
          playerNames: {
            applyLeaderboardNames: async () => {
              writes.push('names')

              return { changed: 0 }
            },
          },
          rankedStandings: {
            applyLeaderboardRanked: async () => {
              writes.push('1v1')

              return { changed: 0 }
            },
          },
          teamModes: {
            applyLeaderboardSoloQueue: async ({ players }) => {
              writes.push(`solo:${players.length}`)

              return { changed: players.length }
            },
            applyLeaderboardTeams: async ({ teams }) => {
              writes.push(
                `teams:${teams.map(({ brawlhallaIdOne, brawlhallaIdTwo }) => `${brawlhallaIdOne}+${brawlhallaIdTwo}`)}`,
              )

              return { changed: teams.length }
            },
          },
          source: {
            fetchPage: async ({ mode: requested, region }) => {
              modes.push(requested)
              expect(region).toBe('EU')

              return {
                totalPages,
                rankings: [
                  {
                    identity:
                      requested === '2v2'
                        ? {
                            type: 'fixed-two-vs-two-team',
                            players: [
                              { id: 5, username: 'Stale One' },
                              { id: 6, username: 'Stale Two' },
                            ],
                          }
                        : { type: 'solo-two-vs-two-player', player: { id: 5, username: 'Stale Solo' } },
                    rating: 1_700,
                    best_rating: 1_750,
                    rank: 1,
                    wins: 3,
                    losses: 1,
                    region: 'EU',
                    tier: 'Platinum 1',
                  },
                ],
              }
            },
          },
        },
      )

      return { writes, modes, saved }
    }

    expect(await run('solo2v2')).toEqual({
      writes: ['solo:1'],
      modes: ['solo2v2'],
      saved: expect.objectContaining({ mode: 'solo2v2' }),
    })

    expect(await run('2v2')).toEqual({
      writes: ['teams:5+6'],
      modes: ['2v2'],
      saved: expect.objectContaining({ mode: '2v2' }),
    })
  })

  test('leaderboard-deep-crawl fails with leaderboard_deep_crawl_failed', async () => {
    const lease = deepCrawlLease()
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

    expect(failures.map(({ code }) => code)).toEqual(['leaderboard_deep_crawl_failed'])
  })

  test('a deep-crawl yield defers with code deep_crawl_yield and no delay', async () => {
    const lease = deepCrawlLease()
    const deferrals: Array<{ code: string; retryDelayMs: number }> = []
    let failed = false

    const operations = {
      claim: async () => lease,
      renew: async () => 'renewed' as const,
      defer: async (_lease: OperationLease, failure: OperationFailure, retryDelayMs: number) => {
        deferrals.push({ code: failure.code, retryDelayMs })

        return 'transitioned' as const
      },
      fail: async () => {
        failed = true

        return 'transitioned' as const
      },
    }

    await runLeaderboardJobOnce(operations, lease, {
      source: {
        fetchPage: async () => {
          throw new LeaderboardDeepCrawlYield()
        },
      },
    })

    expect(deferrals).toEqual([{ code: 'deep_crawl_yield', retryDelayMs: 0 }])
    expect(failed).toBe(false)
  })
})
