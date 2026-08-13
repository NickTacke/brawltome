import { describe, expect, test } from 'bun:test'
import {
  LeaderboardCandidateError,
  type LeaderboardGenerationCandidate,
  LeaderboardLeaseLostError,
  type LeaderboardScope,
  type RankingPublicationAuthorization,
  type RankingPublicationStore,
  collectAndPublishLeaderboardGeneration,
} from '../leaderboard'
import {
  type LeaderboardMode,
  type RegionalLeaderboardScope,
  type SourceLeaderboardIdentity,
  type SourceLeaderboardRow,
  regionalLeaderboardScopes,
} from '../v1-leaderboard-source'

const authorization: RankingPublicationAuthorization = {
  operationId: 'operation-id',
  operationKey: 'leaderboard:window:1',
  operationKind: 'leaderboard-1v1',
  leaseOwner: 'worker-a',
  leaseToken: 1,
  scheduleWindowAt: null,
}

function identity(mode: LeaderboardMode, id: number, teammateId = id + 10_000): SourceLeaderboardIdentity {
  const player = { id, username: `Player ${id}` }
  if (mode === '1v1') return { type: 'one-vs-one-player', player }
  if (mode === 'solo2v2') return { type: 'solo-two-vs-two-player', player }
  if (mode === '3v3') return { type: 'three-vs-three-player', player }
  return {
    type: 'fixed-two-vs-two-team',
    players: [player, { id: teammateId, username: `Player ${teammateId}` }],
  }
}

function row(
  region: RegionalLeaderboardScope,
  mode: LeaderboardMode,
  id: number,
  rank = 1,
  rating = 2000,
): SourceLeaderboardRow {
  return {
    identity: identity(mode, id),
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
  const failures: Array<{ mode: LeaderboardMode; scope: LeaderboardScope; code: string; message: string }> = []
  const publication: RankingPublicationStore = {
    async publishGeneration(_authorization, candidate) {
      published.push(candidate)
      return 'published'
    },
    async recordCollectionFailure(_authorization, failure) {
      failures.push(failure)
      return 'recorded'
    },
  }
  return { publication, published, failures }
}

function auth(mode: LeaderboardMode): RankingPublicationAuthorization {
  const suffix = mode === 'solo2v2' ? 'solo-2v2' : mode
  return {
    ...authorization,
    operationKind: `leaderboard-${suffix}` as RankingPublicationAuthorization['operationKind'],
  }
}

describe('collectAndPublishLeaderboardGeneration', () => {
  for (const mode of ['1v1', '2v2', 'solo2v2', '3v3'] as const) {
    test(`publishes one complete same-generation ${mode} candidate with explicit identities`, async () => {
      const calls: Array<{ mode: LeaderboardMode; region: RegionalLeaderboardScope; page: number }> = []
      const recorder = publicationRecorder()
      await collectAndPublishLeaderboardGeneration({
        mode,
        authorization: auth(mode),
        source: {
          async fetchPage(input) {
            calls.push(input)
            const index = regionalLeaderboardScopes.indexOf(input.region)
            return { rankings: [row(input.region, mode, index + 1, 1, 2300 - index)], totalPages: 1 }
          },
        },
        publication: recorder.publication,
      })
      expect(calls).toEqual(regionalLeaderboardScopes.map((region) => ({ mode, region, page: 1 })))
      expect(recorder.published[0]).toMatchObject({ mode })
      expect(recorder.published[0].snapshots.size).toBe(10)
      expect(recorder.published[0].snapshots.get('EU')?.[0]).toMatchObject({
        standing: 1,
        sourceRank: 1,
        identity: expect.objectContaining({ type: identity(mode, 1).type }),
      })
    })
  }

  test('collects 1v1 pages until every statistics bracket has enough regional candidates', async () => {
    const calls: Array<{ region: RegionalLeaderboardScope; page: number }> = []
    const recorder = publicationRecorder()
    await collectAndPublishLeaderboardGeneration({
      mode: '1v1',
      authorization: auth('1v1'),
      pageDepth: 20,
      source: {
        async fetchPage({ region, page }) {
          calls.push({ region, page })
          const regionOffset = regionalLeaderboardScopes.indexOf(region) * 10_000
          const rankings = Array.from({ length: 50 }, (_, index) => {
            const rank = (page - 1) * 50 + index + 1
            return row(region, '1v1', regionOffset + rank, rank, page <= 3 ? 2_100 : 1_800)
          })
          return { rankings, totalPages: 10 }
        },
      },
      publication: recorder.publication,
    })

    expect(calls).toHaveLength(regionalLeaderboardScopes.length * 6)
    expect(recorder.published[0].pageDepth).toBe(6)
    expect(recorder.published[0].scopePageDepths).toMatchObject({ all: 6, EU: 6, 'US-E': 6 })
    expect(recorder.published[0].snapshots.get('EU')).toHaveLength(300)
  })

  test('collects past Valhallan and unknown-tier boundary pages for other modes', async () => {
    const calls: Array<{ region: RegionalLeaderboardScope; page: number }> = []
    const recorder = publicationRecorder()
    await collectAndPublishLeaderboardGeneration({
      mode: 'solo2v2',
      authorization: auth('solo2v2'),
      pageDepth: 20,
      source: {
        async fetchPage({ region, page }) {
          calls.push({ region, page })
          const regionOffset = regionalLeaderboardScopes.indexOf(region) * 10_000
          const rankings = Array.from({ length: 50 }, (_, index) => {
            const rank = (page - 1) * 50 + index + 1
            const result = row(region, 'solo2v2', regionOffset + rank, rank)
            result.tier = page === 1 ? 'Valhallan' : page === 2 && index === 0 ? null : 'Diamond'
            return result
          })
          return { rankings, totalPages: 5 }
        },
      },
      publication: recorder.publication,
    })

    expect(calls).toHaveLength(regionalLeaderboardScopes.length * 3)
    expect(recorder.published[0].pageDepth).toBe(3)
  })

  test('rejects a capped collection that has not reached its adaptive boundary', async () => {
    const recorder = publicationRecorder()
    await expect(
      collectAndPublishLeaderboardGeneration({
        mode: '1v1',
        authorization: auth('1v1'),
        pageDepth: 2,
        source: {
          async fetchPage({ region, page }) {
            const regionOffset = regionalLeaderboardScopes.indexOf(region) * 10_000
            return {
              rankings: Array.from({ length: 50 }, (_, index) => {
                const rank = (page - 1) * 50 + index + 1
                return row(region, '1v1', regionOffset + rank, rank, 2_100)
              }),
              totalPages: 10,
            }
          },
        },
        publication: recorder.publication,
      }),
    ).rejects.toBeInstanceOf(LeaderboardCandidateError)
    expect(recorder.published).toHaveLength(0)
    expect(recorder.failures).toEqual([
      expect.objectContaining({ mode: '1v1', scope: 'US-E', code: 'leaderboard_candidate_invalid' }),
    ])
  })

  test('canonicalizes fixed teams, permits one player in different teams, and deduplicates only identical teams globally', async () => {
    const recorder = publicationRecorder()
    await collectAndPublishLeaderboardGeneration({
      mode: '2v2',
      authorization: auth('2v2'),
      source: {
        async fetchPage({ region }) {
          const regionIndex = regionalLeaderboardScopes.indexOf(region)
          const first = row(region, '2v2', 7, 1, 2400 - regionIndex)
          first.identity = identity('2v2', 7, region === 'EU' || region === 'US-E' ? 8 : 100 + regionIndex)
          return { rankings: [first], totalPages: 1 }
        },
      },
      publication: recorder.publication,
    })
    const global = recorder.published[0].snapshots.get('all') ?? []
    expect(global).toHaveLength(8)
    expect(
      global.filter(
        ({ identity }) => identity.type === 'fixed-two-vs-two-team' && identity.players[0].brawlhallaId === 7,
      ),
    ).toHaveLength(8)
  })

  test('preserves regional source rank while deriving deterministic Global standing', async () => {
    const recorder = publicationRecorder()
    await collectAndPublishLeaderboardGeneration({
      mode: '3v3',
      authorization: auth('3v3'),
      source: {
        async fetchPage({ region }) {
          const index = regionalLeaderboardScopes.indexOf(region)
          return { rankings: [row(region, '3v3', index + 1, index + 10, 2400 - index)], totalPages: 1 }
        },
      },
      publication: recorder.publication,
    })
    expect(recorder.published[0].snapshots.get('all')?.[0]).toMatchObject({ standing: 1, sourceRank: 10 })
  })

  test('rejects identity/rank/order/page drift and records one mode-scoped failure without publishing', async () => {
    const recorder = publicationRecorder()
    await expect(
      collectAndPublishLeaderboardGeneration({
        mode: 'solo2v2',
        authorization: auth('solo2v2'),
        pageDepth: 2,
        source: {
          async fetchPage({ region, page }) {
            return page === 1
              ? {
                  rankings: Array.from({ length: 50 }, (_, index) => {
                    const result = row(region, 'solo2v2', index + 1, index + 1)
                    result.tier = 'Valhallan'
                    return result
                  }),
                  totalPages: 3,
                }
              : { rankings: [row(region, 'solo2v2', 51, 51)], totalPages: 4 }
          },
        },
        publication: recorder.publication,
      }),
    ).rejects.toBeInstanceOf(LeaderboardCandidateError)
    expect(recorder.published).toHaveLength(0)
    expect(recorder.failures).toEqual([
      expect.objectContaining({ mode: 'solo2v2', scope: 'US-E', code: 'leaderboard_candidate_invalid' }),
    ])
  })

  test('records the regional scope whose source fetch fails', async () => {
    const recorder = publicationRecorder()
    await expect(
      collectAndPublishLeaderboardGeneration({
        mode: '3v3',
        authorization: auth('3v3'),
        source: {
          async fetchPage({ region }) {
            if (region === 'BRZ') throw new Error('regional source unavailable')
            return { rankings: [row(region, '3v3', regionalLeaderboardScopes.indexOf(region) + 1)], totalPages: 1 }
          },
        },
        publication: recorder.publication,
      }),
    ).rejects.toThrow('regional source unavailable')
    expect(recorder.published).toHaveLength(0)
    expect(recorder.failures).toEqual([
      expect.objectContaining({ mode: '3v3', scope: 'BRZ', code: 'leaderboard_collection_failed' }),
    ])
  })

  test('stops immediately without failure recording when a page reports lease loss', async () => {
    const recorder = publicationRecorder()
    let sourceCalls = 0
    await expect(
      collectAndPublishLeaderboardGeneration({
        mode: '1v1',
        authorization: auth('1v1'),
        source: {
          async fetchPage({ region }) {
            sourceCalls++
            if (region === 'US-W') throw new LeaderboardLeaseLostError()
            return { rankings: [row(region, '1v1', regionalLeaderboardScopes.indexOf(region) + 1)], totalPages: 1 }
          },
        },
        publication: recorder.publication,
      }),
    ).rejects.toBeInstanceOf(LeaderboardLeaseLostError)
    expect(sourceCalls).toBe(2)
    expect(recorder.failures).toHaveLength(0)
    expect(recorder.published).toHaveLength(0)
  })

  test('does not record a source failure when atomic publication storage fails', async () => {
    const recorder = publicationRecorder()
    recorder.publication.publishGeneration = async () => {
      throw new Error('database unavailable during publication')
    }
    await expect(
      collectAndPublishLeaderboardGeneration({
        mode: '1v1',
        authorization: auth('1v1'),
        source: {
          async fetchPage({ region }) {
            return { rankings: [row(region, '1v1', regionalLeaderboardScopes.indexOf(region) + 1)], totalPages: 1 }
          },
        },
        publication: recorder.publication,
      }),
    ).rejects.toThrow('database unavailable')
    expect(recorder.failures).toHaveLength(0)
  })
})
