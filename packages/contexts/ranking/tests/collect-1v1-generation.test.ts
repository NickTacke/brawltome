import { describe, expect, test } from 'bun:test'
import {
  LeaderboardCandidateError,
  type LeaderboardGenerationCandidate,
  type RankingPublicationAuthorization,
  type RankingPublicationStore,
  collectAndPublish1v1Generation,
} from '../leaderboard'
import { type RegionalLeaderboardScope, regionalLeaderboardScopes } from '../v1-leaderboard-source'

const authorization: RankingPublicationAuthorization = {
  operationId: 'operation-id',
  operationKey: 'leaderboard:window:1',
  leaseOwner: 'worker-a',
  leaseToken: 1,
  scheduleWindowAt: null,
}

function row(region: RegionalLeaderboardScope, id: number, rank = 1, rating = 2000) {
  return {
    id,
    username: `Player ${id}`,
    rating,
    best_rating: rating + 50,
    rank,
    wins: 20,
    losses: 10,
    region,
    tier: 'Diamond',
  }
}

function publicationRecorder() {
  const published: LeaderboardGenerationCandidate[] = []
  const failures: Array<{ code: string; message: string }> = []
  const publication: RankingPublicationStore = {
    async publish1v1Generation(_authorization, candidate) {
      published.push(candidate)
      return 'published'
    },
    async record1v1CollectionFailure(_authorization, failure) {
      failures.push(failure)
      return 'recorded'
    },
  }
  return { publication, published, failures }
}

describe('collectAndPublish1v1Generation', () => {
  test('collects exactly nine regional candidates and builds one deterministic same-generation Global', async () => {
    const calls: Array<{ region: RegionalLeaderboardScope; page: number }> = []
    const recorder = publicationRecorder()
    await collectAndPublish1v1Generation({
      authorization,
      source: {
        async fetchPage(input) {
          calls.push(input)
          const index = regionalLeaderboardScopes.indexOf(input.region)
          const id = input.region === 'EU' ? 100 : index === 0 ? 100 : index + 1
          const rating = input.region === 'EU' ? 2300 : 2000 - index
          return { rankings: [row(input.region, id, 1, rating)], totalPages: 1 }
        },
      },
      publication: recorder.publication,
      clock: () => new Date('2026-08-09T12:00:00Z'),
    })

    expect(calls).toEqual(regionalLeaderboardScopes.map((region) => ({ region, page: 1 })))
    expect(calls.some(({ region }) => region === ('all' as never))).toBe(false)
    expect(recorder.published).toHaveLength(1)
    const candidate = recorder.published[0]
    expect(candidate.snapshots.size).toBe(10)
    expect(candidate.snapshots.get('EU')?.[0]).toMatchObject({ standing: 1, sourceRank: 1, brawlhallaId: 100 })
    expect(candidate.snapshots.get('all')?.[0]).toMatchObject({
      standing: 1,
      sourceRank: 1,
      brawlhallaId: 100,
      region: 'EU',
      rating: 2300,
    })
    expect(candidate.snapshots.get('all')).toHaveLength(8)
  })

  test('fetches every configured bounded page for all nine regions', async () => {
    const calls: Array<{ region: RegionalLeaderboardScope; page: number }> = []
    const recorder = publicationRecorder()
    await collectAndPublish1v1Generation({
      authorization,
      pageDepth: 2,
      source: {
        async fetchPage(input) {
          calls.push(input)
          const regionOffset = regionalLeaderboardScopes.indexOf(input.region) * 1_000
          return {
            rankings:
              input.page === 1
                ? Array.from({ length: 50 }, (_, index) => row(input.region, regionOffset + index + 1, index + 1))
                : [row(input.region, regionOffset + 51, 51)],
            totalPages: 2,
          }
        },
      },
      publication: recorder.publication,
    })
    expect(calls).toHaveLength(18)
    expect(recorder.published[0].snapshots.get('EU')).toHaveLength(51)
  })

  test('does not record source failure when atomic publication storage fails', async () => {
    const recorder = publicationRecorder()
    recorder.publication.publish1v1Generation = async () => {
      throw new Error('database unavailable during publication')
    }
    await expect(
      collectAndPublish1v1Generation({
        authorization,
        source: {
          async fetchPage({ region }) {
            return { rankings: [row(region, regionalLeaderboardScopes.indexOf(region) + 1)], totalPages: 1 }
          },
        },
        publication: recorder.publication,
      }),
    ).rejects.toThrow('database unavailable')
    expect(recorder.failures).toHaveLength(0)
  })

  test('rejects metadata drift and records failure without publishing a partial generation', async () => {
    const recorder = publicationRecorder()
    await expect(
      collectAndPublish1v1Generation({
        authorization,
        pageDepth: 2,
        source: {
          async fetchPage({ region, page }) {
            const first = Array.from({ length: 50 }, (_, index) => row(region, 10_000 + index, index + 1))
            return page === 1
              ? { rankings: first, totalPages: 3 }
              : { rankings: [row(region, 20_000, 51)], totalPages: 4 }
          },
        },
        publication: recorder.publication,
      }),
    ).rejects.toBeInstanceOf(LeaderboardCandidateError)
    expect(recorder.published).toHaveLength(0)
    expect(recorder.failures).toEqual([
      expect.objectContaining({ code: 'leaderboard_candidate_invalid', message: expect.stringContaining('changed') }),
    ])
  })

  test('rejects duplicate IDs, ranks, and cross-page ordering', async () => {
    for (const secondRow of [row('US-E', 1, 2), row('US-E', 2, 1), row('US-E', 2, 0)]) {
      const recorder = publicationRecorder()
      await expect(
        collectAndPublish1v1Generation({
          authorization,
          source: {
            async fetchPage({ region }) {
              return {
                rankings: region === 'US-E' ? [row(region, 1, 1), { ...secondRow, region }] : [row(region, 100, 1)],
                totalPages: 1,
              }
            },
          },
          publication: recorder.publication,
        }),
      ).rejects.toBeInstanceOf(LeaderboardCandidateError)
      expect(recorder.published).toHaveLength(0)
    }
  })
})
