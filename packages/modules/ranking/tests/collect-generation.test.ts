import { describe, expect, test } from 'bun:test'
import {
  collectAndPublishLeaderboardGeneration,
  type LeaderboardGenerationCandidate,
  LeaderboardLeaseLostError,
  type LeaderboardScope,
  type PublishedLeaderboardRow,
  type PublishedRegionalBoard,
  type RankingPublicationAuthorization,
  type RankingPublicationStore,
  regionPublicationKey,
} from '../leaderboard'
import {
  type LeaderboardMode,
  LeaderboardSourceError,
  type RegionalLeaderboardScope,
  regionalLeaderboardScopes,
  type SourceLeaderboardIdentity,
  type SourceLeaderboardRow,
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

// a 1v1 row as an earlier scan published it
function publishedRow(region: RegionalLeaderboardScope, id: number, rating = 1_900): PublishedLeaderboardRow {
  return {
    standing: 1,
    sourceRank: 1,
    identity: { type: 'one-vs-one-player', player: { brawlhallaId: id, name: `Player ${id}` } },
    region,
    rating,
    peakRating: rating,
    wins: 5,
    losses: 5,
    tier: 'Gold',
  }
}

// records each publication in order: the regions as they are collected, then the global board that closes the window
function publicationRecorder(earlierBoards: ReadonlyMap<RegionalLeaderboardScope, PublishedRegionalBoard> = new Map()) {
  const regions: LeaderboardGenerationCandidate[] = []
  const windows: LeaderboardGenerationCandidate[] = []
  const failures: Array<{ mode: LeaderboardMode; scope: LeaderboardScope; code: string; message: string }> = []

  const publication: RankingPublicationStore = {
    async readLatestRegionalBoards() {
      return earlierBoards
    },
    async publishRegion(_authorization, candidate) {
      regions.push(candidate)

      return 'published'
    },
    async publishGeneration(_authorization, candidate) {
      windows.push(candidate)

      return 'published'
    },
    async recordCollectionFailure(_authorization, failure) {
      failures.push(failure)

      return 'recorded'
    },
  }

  // the board each scope published in this scan
  const boards = () => new Map([...regions, ...windows].flatMap(({ snapshots }) => [...snapshots]))

  const regionPublication = (region: RegionalLeaderboardScope) => regions.find(({ snapshots }) => snapshots.has(region))

  return { publication, regions, windows, failures, boards, regionPublication }
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
    test(`publishes each ${mode} region and then the global board with explicit identities`, async () => {
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

      expect(recorder.regions.map(({ snapshots }) => [...snapshots.keys()])).toEqual(
        regionalLeaderboardScopes.map((region) => [region]),
      )

      expect(recorder.regions[0]).toMatchObject({ mode, operationKey: 'leaderboard:window:1:US-E' })

      expect(recorder.windows).toMatchObject([
        {
          mode,
          operationKey: 'leaderboard:window:1',
          staleRegions: [],
          snapshots: new Map([['all', expect.any(Array)]]),
        },
      ])

      expect(recorder.boards().size).toBe(10)

      expect(recorder.boards().get('EU')?.[0]).toMatchObject({
        standing: 1,
        sourceRank: 1,
        identity: expect.objectContaining({ type: identity(mode, 1).type }),
      })
    })
  }

  for (const mode of ['1v1', '2v2', 'solo2v2', '3v3'] as const) {
    test(`keeps the source order and rank of regional ${mode} boards and resolves missing tiers`, async () => {
      const recorder = publicationRecorder()

      await collectAndPublishLeaderboardGeneration({
        mode,
        authorization: auth(mode),
        source: {
          async fetchPage({ region }) {
            const offset = regionalLeaderboardScopes.indexOf(region) * 10_000
            const fallen = row(region, mode, offset + 1, 1, 1_900)

            fallen.best_rating = 2_300
            fallen.wins = 120
            fallen.tier = null
            const lowerWins = row(region, mode, offset + 2, 2, 2_400)

            lowerWins.wins = 20
            const higherWins = row(region, mode, offset + 3, 3, 2_400)

            higherWins.wins = 30

            return { rankings: [fallen, lowerWins, higherWins], totalPages: 1 }
          },
        },
        publication: recorder.publication,
      })

      expect(recorder.boards().get('EU')).toMatchObject([
        { standing: 1, sourceRank: 1, rating: 1_900, wins: 120, peakRating: 2_300, tier: 'Diamond' },
        { standing: 2, sourceRank: 2, rating: 2_400, wins: 20, tier: 'Diamond' },
        { standing: 3, sourceRank: 3, rating: 2_400, wins: 30, tier: 'Diamond' },
      ])
    })
  }

  test('leaves a visiting player where the source ranks them on a regional board', async () => {
    const recorder = publicationRecorder()

    await collectAndPublishLeaderboardGeneration({
      mode: '1v1',
      authorization: auth('1v1'),
      source: {
        async fetchPage({ region }) {
          const offset = regionalLeaderboardScopes.indexOf(region) * 10_000
          const visitor = { ...row(region, '1v1', offset + 3, 166, 2_700), region: 'US-E' as const }

          return {
            rankings: [row(region, '1v1', offset + 1, 1, 2_711), row(region, '1v1', offset + 2, 2, 2_615), visitor],
            totalPages: 1,
          }
        },
      },
      publication: recorder.publication,
    })

    expect(recorder.boards().get('EU')).toMatchObject([
      { standing: 1, sourceRank: 1, rating: 2_711 },
      { standing: 2, sourceRank: 2, rating: 2_615 },
      { standing: 166, sourceRank: 166, rating: 2_700, region: 'US-E' },
    ])
  })

  test('keeps a regional row seen twice at the rank of the stronger row', async () => {
    const recorder = publicationRecorder()

    await collectAndPublishLeaderboardGeneration({
      mode: '1v1',
      authorization: auth('1v1'),
      source: {
        async fetchPage({ region }) {
          const offset = regionalLeaderboardScopes.indexOf(region) * 10_000

          return {
            rankings: [
              row(region, '1v1', offset + 1, 1, 2_000),
              row(region, '1v1', offset + 2, 2, 1_990),
              row(region, '1v1', offset + 1, 3, 2_010),
            ],
            totalPages: 1,
          }
        },
      },
      publication: recorder.publication,
    })

    expect(recorder.boards().get('EU')).toMatchObject([
      { standing: 2, sourceRank: 2, rating: 1_990 },
      { standing: 3, sourceRank: 3, rating: 2_010 },
    ])
  })

  test('still orders the global board by rating and numbers it from one', async () => {
    const recorder = publicationRecorder()

    await collectAndPublishLeaderboardGeneration({
      mode: '1v1',
      authorization: auth('1v1'),
      source: {
        async fetchPage({ region }) {
          const index = regionalLeaderboardScopes.indexOf(region)

          return { rankings: [row(region, '1v1', index + 1, 1, 2_000 + index)], totalPages: 1 }
        },
      },
      publication: recorder.publication,
    })

    const lastRegionRating = 2_000 + regionalLeaderboardScopes.length - 1

    expect(recorder.boards().get('all')?.[0]).toMatchObject({ standing: 1, rating: lastRegionRating })
  })

  for (const mode of ['1v1', '3v3'] as const) {
    test(`publishes an empty ${mode} region as an empty regional snapshot`, async () => {
      const calls: RegionalLeaderboardScope[] = []
      const recorder = publicationRecorder()

      await collectAndPublishLeaderboardGeneration({
        mode,
        authorization: auth(mode),
        source: {
          async fetchPage({ region, page }) {
            calls.push(region)
            if (region === 'JPN') return { rankings: [], totalPages: 0 }

            return { rankings: [row(region, mode, regionalLeaderboardScopes.indexOf(region) + 1, page)], totalPages: 1 }
          },
        },
        publication: recorder.publication,
      })

      expect(recorder.failures).toEqual([])
      expect(calls.filter((region) => region === 'JPN')).toHaveLength(1)
      expect(recorder.boards().get('JPN')).toEqual([])
      expect(recorder.boards().get('all')).toHaveLength(8)
      expect(recorder.regionPublication('JPN')?.scopePageDepths).toEqual({ JPN: 1 })
    })
  }

  test('rejects an empty page from a non-empty region and publishes the other regions', async () => {
    const recorder = publicationRecorder()

    await collectAndPublishLeaderboardGeneration({
      mode: '3v3',
      authorization: auth('3v3'),
      source: {
        async fetchPage({ region }) {
          if (region === 'EU') return { rankings: [], totalPages: 1 }

          return { rankings: [row(region, '3v3', regionalLeaderboardScopes.indexOf(region) + 1)], totalPages: 1 }
        },
      },
      publication: recorder.publication,
    })

    expect(recorder.failures).toEqual([
      expect.objectContaining({
        scope: 'EU',
        code: 'leaderboard_candidate_invalid',
        message: '3v3/EU page 1 is empty',
      }),
    ])

    expect(recorder.regionPublication('EU')).toBeUndefined()
    expect(recorder.regions).toHaveLength(8)
    expect(recorder.windows).toMatchObject([{ staleRegions: ['EU'] }])
    expect(recorder.boards().get('all')).toHaveLength(8)
  })

  test('fails the window when no region has a ranked row', async () => {
    const recorder = publicationRecorder()

    await expect(
      collectAndPublishLeaderboardGeneration({
        mode: '3v3',
        authorization: auth('3v3'),
        source: { fetchPage: async () => ({ rankings: [], totalPages: 0 }) },
        publication: recorder.publication,
      }),
    ).rejects.toThrow('no ranked rows')

    expect(recorder.failures).toEqual([
      expect.objectContaining({ scope: 'all', code: 'leaderboard_candidate_invalid' }),
    ])

    expect(recorder.regions).toHaveLength(9)
    expect(recorder.windows).toHaveLength(0)
  })

  test('orders Global ties by wins before peak rating', async () => {
    const recorder = publicationRecorder()

    await collectAndPublishLeaderboardGeneration({
      mode: '1v1',
      authorization: auth('1v1'),
      source: {
        async fetchPage({ region }) {
          const index = regionalLeaderboardScopes.indexOf(region)
          const result = row(region, '1v1', index + 1, 1, 2_400)

          result.wins = region === 'EU' ? 30 : 20
          result.best_rating = region === 'US-E' ? 2_500 : 2_450

          return { rankings: [result], totalPages: 1 }
        },
      },
      publication: recorder.publication,
    })

    expect(recorder.boards().get('all')?.[0]).toMatchObject({
      region: 'EU',
      wins: 30,
      peakRating: 2_450,
    })
  })

  test('collects 1v1 pages to the source or configured depth', async () => {
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

    expect(calls).toHaveLength(regionalLeaderboardScopes.length * 10)
    expect(recorder.regionPublication('EU')).toMatchObject({ pageDepth: 20, scopePageDepths: { EU: 10 } })
    expect(recorder.regionPublication('US-E')?.scopePageDepths).toEqual({ 'US-E': 10 })
    expect(recorder.boards().get('EU')).toHaveLength(500)
  })

  test('collects Solo 2v2 to the source or configured depth', async () => {
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
            if (page === 2 && index === 0) result.rating = result.best_rating = 2_100

            if (page === 3 && index < 3) {
              result.rating = result.best_rating = 2_400
              result.wins = index === 0 ? 30 : 20
            }

            return result
          })

          return { rankings, totalPages: 5 }
        },
      },
      publication: recorder.publication,
    })

    expect(calls).toHaveLength(regionalLeaderboardScopes.length * 5)
    expect(recorder.regionPublication('EU')?.scopePageDepths).toEqual({ EU: 5 })

    expect(recorder.boards().get('EU')?.slice(100, 103)).toMatchObject([
      { standing: 101, sourceRank: 101, rating: 2_400, wins: 30, tier: 'Diamond' },
      { standing: 102, sourceRank: 102, rating: 2_400, wins: 20, tier: 'Diamond' },
      { standing: 103, sourceRank: 103, rating: 2_400, wins: 20, tier: 'Diamond' },
    ])

    expect(
      recorder
        .boards()
        .get('EU')
        ?.find(({ sourceRank }) => sourceRank === 51),
    ).toMatchObject({
      tier: 'Diamond',
      rating: 2_100,
    })
  })

  test('publishes a capped collection when adaptive statistics coverage remains insufficient', async () => {
    const recorder = publicationRecorder()

    await collectAndPublishLeaderboardGeneration({
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
    })

    expect(recorder.failures).toEqual([])
    expect(recorder.regionPublication('EU')).toMatchObject({ pageDepth: 2, scopePageDepths: { EU: 2 } })
    expect(recorder.windows).toMatchObject([{ pageDepth: 2 }])
    expect(recorder.boards().get('EU')).toHaveLength(100)
  })

  test('deduplicates repeated regional identities using rating then wins while preserving source rank', async () => {
    const recorder = publicationRecorder()

    await collectAndPublishLeaderboardGeneration({
      mode: 'solo2v2',
      authorization: auth('solo2v2'),
      pageDepth: 2,
      source: {
        async fetchPage({ region, page }) {
          const offset = regionalLeaderboardScopes.indexOf(region) * 10_000

          return {
            rankings: Array.from({ length: 50 }, (_, index) => {
              const rank = (page - 1) * 50 + index + 1
              const id = page === 2 && index === 0 ? offset + 1 : offset + rank
              const result = row(region, 'solo2v2', id, rank, id === offset + 1 ? 2_400 : 2_000)

              if (page === 2 && index === 0) result.wins = 30

              return result
            }),
            totalPages: 2,
          }
        },
      },
      publication: recorder.publication,
    })

    expect(recorder.boards().get('EU')).toHaveLength(99)

    expect(
      recorder
        .boards()
        .get('EU')
        ?.find(({ sourceRank }) => sourceRank === 51),
    ).toMatchObject({
      standing: 51,
      rating: 2_400,
      wins: 30,
    })

    expect(recorder.boards().get('EU')?.[0]).toMatchObject({ standing: 2, sourceRank: 2 })
  })

  test('preserves requested rosters and chooses the Global duplicate by wins before peak rating', async () => {
    const recorder = publicationRecorder()

    await collectAndPublishLeaderboardGeneration({
      mode: '1v1',
      authorization: auth('1v1'),
      source: {
        async fetchPage({ region }) {
          const duplicate = region === 'EU' || region === 'US-E'

          const result = row(
            duplicate ? 'US-E' : region,
            '1v1',
            duplicate ? 7 : regionalLeaderboardScopes.indexOf(region) + 100,
            1,
            2_400,
          )

          result.wins = region === 'EU' ? 30 : 20
          result.best_rating = region === 'US-E' ? 2_500 : 2_450

          return { rankings: [result], totalPages: 1 }
        },
      },
      publication: recorder.publication,
    })

    expect(recorder.boards().get('EU')).toMatchObject([{ region: 'US-E', wins: 30 }])
    expect(recorder.boards().get('US-E')).toMatchObject([{ region: 'US-E', wins: 20, peakRating: 2_500 }])

    expect(
      recorder
        .boards()
        .get('all')
        ?.filter(({ identity }) => identity.type === 'one-vs-one-player' && identity.player.brawlhallaId === 7),
    ).toMatchObject([{ standing: 1, region: 'US-E', wins: 30, peakRating: 2_450 }])
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

    const global = recorder.boards().get('all') ?? []

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

    expect(recorder.boards().get('all')?.[0]).toMatchObject({ standing: 1, sourceRank: 10 })
  })

  test('rejects identity/rank/order/page drift in every region and fails the window without publishing', async () => {
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
    ).rejects.toMatchObject({
      name: 'LeaderboardCandidateError',
      // The source resized mid-collection (total_pages 3 then 4): a retry re-collects a consistent leaderboard.
      retryable: true,
    })

    expect(recorder.regions).toHaveLength(0)
    expect(recorder.windows).toHaveLength(0)

    expect(recorder.failures).toEqual(
      regionalLeaderboardScopes.map((region) =>
        expect.objectContaining({ mode: 'solo2v2', scope: region, code: 'leaderboard_candidate_invalid' }),
      ),
    )
  })

  test('publishes the other regions when one region fails, and names it stale on the global board', async () => {
    const recorder = publicationRecorder()

    const result = await collectAndPublishLeaderboardGeneration({
      mode: '1v1',
      authorization: auth('1v1'),
      source: {
        async fetchPage({ region }) {
          if (region === 'US-E') {
            throw new LeaderboardSourceError('source_unavailable', 'V1 leaderboard returned 502 for 1v1/US-E', true)
          }

          return { rankings: [row(region, '1v1', regionalLeaderboardScopes.indexOf(region) + 1)], totalPages: 1 }
        },
      },
      publication: recorder.publication,
    })

    expect(result).toBe('published')

    expect(recorder.failures).toEqual([
      expect.objectContaining({ mode: '1v1', scope: 'US-E', code: 'source_unavailable' }),
    ])

    expect(recorder.regions.map(({ snapshots }) => [...snapshots.keys()][0])).toEqual(
      regionalLeaderboardScopes.filter((region) => region !== 'US-E'),
    )

    expect(recorder.windows).toMatchObject([{ staleRegions: ['US-E'] }])
    expect(recorder.boards().get('all')).toHaveLength(8)
  })

  test('carries a failed region from its last published board onto the global board', async () => {
    const earlierUsEast = publishedRow('US-E', 900, 2_500)

    const recorder = publicationRecorder(
      new Map([['US-E', { operationKey: 'leaderboard:window:0:US-E', rows: [earlierUsEast] }]]),
    )

    await collectAndPublishLeaderboardGeneration({
      mode: '1v1',
      authorization: auth('1v1'),
      source: {
        async fetchPage({ region }) {
          if (region === 'US-E') throw new LeaderboardSourceError('source_unavailable', 'V1 returned 502', true)

          return { rankings: [row(region, '1v1', regionalLeaderboardScopes.indexOf(region) + 1)], totalPages: 1 }
        },
      },
      publication: recorder.publication,
    })

    expect(recorder.regionPublication('US-E')).toBeUndefined()
    expect(recorder.windows).toMatchObject([{ staleRegions: ['US-E'] }])
    expect(recorder.boards().get('all')).toHaveLength(9)
    expect(recorder.boards().get('all')?.[0]).toMatchObject({ standing: 1, rating: 2_500, region: 'US-E' })
  })

  test("prefers a fresh region's row over a carried one for a player listed in both", async () => {
    // player 3 is EU's, also listed on US-E's last board with the rating they had hours ago
    const carriedRow = publishedRow('US-E', 3, 2_600)

    const recorder = publicationRecorder(
      new Map([['US-E', { operationKey: 'leaderboard:window:0:US-E', rows: [carriedRow] }]]),
    )

    await collectAndPublishLeaderboardGeneration({
      mode: '1v1',
      authorization: auth('1v1'),
      source: {
        async fetchPage({ region }) {
          if (region === 'US-E') throw new LeaderboardSourceError('source_unavailable', 'V1 returned 502', true)

          return {
            rankings: [row(region, '1v1', regionalLeaderboardScopes.indexOf(region) + 1, 1, 2_000)],
            totalPages: 1,
          }
        },
      },
      publication: recorder.publication,
    })

    const global = recorder.boards().get('all') ?? []

    const playerThree = global.filter(
      ({ identity }) => identity.type === 'one-vs-one-player' && identity.player.brawlhallaId === 3,
    )

    expect(global).toHaveLength(8)
    expect(playerThree).toMatchObject([{ rating: 2_000, region: 'EU' }])
  })

  test('a retry skips the regions its window already published', async () => {
    const calls: RegionalLeaderboardScope[] = []

    const recorder = publicationRecorder(
      new Map([
        [
          'US-E',
          { operationKey: regionPublicationKey(authorization.operationKey, 'US-E'), rows: [publishedRow('US-E', 901)] },
        ],
        ['US-W', { operationKey: 'leaderboard:window:0:US-W', rows: [publishedRow('US-W', 902)] }],
      ]),
    )

    await collectAndPublishLeaderboardGeneration({
      mode: '1v1',
      authorization: auth('1v1'),
      source: {
        async fetchPage({ region }) {
          calls.push(region)

          return { rankings: [row(region, '1v1', regionalLeaderboardScopes.indexOf(region) + 1)], totalPages: 1 }
        },
      },
      publication: recorder.publication,
    })

    expect(calls).toEqual(regionalLeaderboardScopes.filter((region) => region !== 'US-E'))
    expect(recorder.regions).toHaveLength(8)
    expect(recorder.windows).toMatchObject([{ staleRegions: [] }])

    const globalIds = recorder
      .boards()
      .get('all')
      ?.map(({ identity }) => (identity.type === 'one-vs-one-player' ? identity.player.brawlhallaId : 0))

    expect(globalIds).toContain(901)
    expect(globalIds).not.toContain(902)
  })

  test('stops on a rate limit and keeps the regions published before it', async () => {
    const recorder = publicationRecorder()

    await expect(
      collectAndPublishLeaderboardGeneration({
        mode: '1v1',
        authorization: auth('1v1'),
        source: {
          async fetchPage({ region }) {
            if (region === 'EU') throw new LeaderboardSourceError('source_rate_limited', 'V1 returned 429', true)

            return { rankings: [row(region, '1v1', regionalLeaderboardScopes.indexOf(region) + 1)], totalPages: 1 }
          },
        },
        publication: recorder.publication,
      }),
    ).rejects.toMatchObject({ code: 'source_rate_limited' })

    expect(recorder.regions.map(({ snapshots }) => [...snapshots.keys()][0])).toEqual(['US-E', 'US-W'])
    expect(recorder.failures).toEqual([expect.objectContaining({ scope: 'EU', code: 'source_rate_limited' })])
    expect(recorder.windows).toHaveLength(0)
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
    expect(recorder.regions).toHaveLength(1)
    expect(recorder.windows).toHaveLength(0)
  })

  test('does not record a source failure when publication storage fails', async () => {
    for (const failingStep of ['publishRegion', 'publishGeneration'] as const) {
      const recorder = publicationRecorder()

      recorder.publication[failingStep] = async () => {
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
    }
  })
})
