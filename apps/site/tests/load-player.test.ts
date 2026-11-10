import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { loadPlayer } from '../src/server/load-player'

const apiUrl = 'http://api.test'
const observedAt = '2026-11-01T12:00:00.000Z'
const originalFetch = globalThis.fetch
const originalApiUrl = process.env.INTERNAL_API_URL
const originalSecret = process.env.INTERNAL_API_SECRET

// assigning undefined would store the text "undefined"
function restoreSetting(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

const reference = { brawlhallaId: 7, name: 'Seven', aliases: ['Old Seven'], bestLegendNameKey: 'bodvar' }
const clan = { clanId: 42, clanName: 'Valhalla' }
const seasons = [{ season: 39, startsAt: '1970-01-01T00:00:00.000Z' }]

const standing = { rating: 2100, peakRating: 2200, tier: 'Diamond', wins: 10, games: 20 }

const ranked = {
  brawlhallaId: 7,
  checkedAt: observedAt,
  lastSuccessAt: observedAt,
  freshness: 'fresh',
  freshForSeconds: 3600,
  sparsePulse: null,
  snapshot: {
    oneVsOne: { ...standing, region: 'EU', globalRank: null, regionRank: null },
    rankedLegends: [],
    mainLegend: null,
    fixedTeams: [],
    soloQueue: [],
    ratingHistory: [],
    observedRatingDirection: null,
  },
}

const valhallanEvidence = { oneVsOne: true, fixedTwoVsTwoTeams: [], soloTwoVsTwo: false }
const boardRanksPath = '/players/7/board-ranks?region=EU'
const boardRanks = { globalRank: 184, regionRank: 61 }

type Answers = Record<string, { status: number; body: unknown }>

function healthyAnswers(): Answers {
  return {
    '/players/7/reference': { status: 200, body: reference },
    '/players/7/ranked': { status: 200, body: ranked },
    '/players/7/career': { status: 200, body: null },
    '/players/7/clan': { status: 200, body: clan },
    '/players/7/valhallan-evidence': { status: 200, body: null },
    [boardRanksPath]: { status: 200, body: { globalRank: null, regionRank: null } },
    '/seasons': { status: 200, body: seasons },
  }
}

function stubApi(answers: Answers): string[] {
  const paths: string[] = []

  const stub = async (input: string | URL | Request) => {
    const path = String(input).replace(`${apiUrl}/v1`, '')
    const answer = answers[path] ?? { status: 404, body: {} }

    paths.push(path)

    return new Response(JSON.stringify(answer.body), { status: answer.status })
  }

  globalThis.fetch = mock(stub) as unknown as typeof fetch

  return paths
}

function failing(path: string): Answers {
  return { ...healthyAnswers(), [path]: { status: 503, body: { secret: 'upstream detail' } } }
}

describe('loadPlayer', () => {
  beforeEach(() => {
    process.env.INTERNAL_API_URL = apiUrl
    process.env.INTERNAL_API_SECRET = 'test-secret'
    spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    restoreSetting('INTERNAL_API_URL', originalApiUrl)
    restoreSetting('INTERNAL_API_SECRET', originalSecret)
    mock.restore()
  })

  test('reads every part of the page', async () => {
    const paths = stubApi(healthyAnswers())

    await loadPlayer(7)

    expect(paths.sort()).toEqual(Object.keys(healthyAnswers()).sort())
  })

  test('returns the player in the page shape', async () => {
    stubApi(healthyAnswers())

    const page = await loadPlayer(7)

    expect(page?.player).toMatchObject({ brawlhallaId: 7, name: 'Seven', aliases: ['Old Seven'], clan })
    expect(page?.player.bestLegendNameKey).toBe('bodvar')
    expect(page?.seasonStarts).toEqual(seasons)
  })

  test('returns null for a player nothing is known about', async () => {
    stubApi({ ...healthyAnswers(), '/players/7/reference': { status: 200, body: null } })

    expect(await loadPlayer(7)).toBeNull()
  })

  test('loads a player known only by name', async () => {
    stubApi({ ...healthyAnswers(), '/players/7/ranked': { status: 200, body: null } })

    const page = await loadPlayer(7)

    expect(page?.player.currentSeason).toBeNull()
    expect(page?.player.career).toBeNull()
  })

  test.each(['/players/7/reference', '/players/7/ranked', '/players/7/career'])(
    'a failed %s fails the page with a fixed message',
    async (path) => {
      stubApi(failing(path))

      expect(loadPlayer(7)).rejects.toThrow(/^load player 7: the player could not be read$/)
    },
  )

  test('a failed clan read leaves the player without a guild', async () => {
    stubApi(failing('/players/7/clan'))

    expect((await loadPlayer(7))?.player.clan).toBeNull()
  })

  test('a failed evidence read keeps the stored tier', async () => {
    stubApi(failing('/players/7/valhallan-evidence'))

    expect((await loadPlayer(7))?.player.currentSeason?.snapshot?.oneVsOne.tier).toBe('Diamond')
  })

  test('a failed season read leaves no seasons', async () => {
    stubApi(failing('/seasons'))

    expect((await loadPlayer(7))?.seasonStarts).toEqual([])
  })

  test("fills the ranks with the player's place on the boards", async () => {
    stubApi({ ...healthyAnswers(), [boardRanksPath]: { status: 200, body: boardRanks } })

    expect((await loadPlayer(7))?.player.currentSeason?.snapshot?.oneVsOne).toMatchObject(boardRanks)
  })

  test('a failed board ranks read leaves the player without ranks', async () => {
    stubApi(failing(boardRanksPath))

    const oneVsOne = (await loadPlayer(7))?.player.currentSeason?.snapshot?.oneVsOne

    expect(oneVsOne).toMatchObject({ rating: 2100, globalRank: null, regionRank: null })
  })

  test('asks for the global board alone when the profile has no region', async () => {
    const oneVsOne = { ...ranked.snapshot.oneVsOne, region: null }
    const withoutRegion = { ...ranked, snapshot: { ...ranked.snapshot, oneVsOne } }

    const paths = stubApi({
      ...healthyAnswers(),
      '/players/7/ranked': { status: 200, body: withoutRegion },
      '/players/7/board-ranks': { status: 200, body: { globalRank: 184, regionRank: null } },
    })

    const loaded = (await loadPlayer(7))?.player.currentSeason?.snapshot?.oneVsOne

    expect(paths).toContain('/players/7/board-ranks')
    expect(loaded).toMatchObject({ region: null, globalRank: 184, regionRank: null })
  })

  test('asks for no ranks when the player has no ranked data', async () => {
    const paths = stubApi({ ...healthyAnswers(), '/players/7/ranked': { status: 200, body: null } })

    await loadPlayer(7)

    expect(paths.filter((path) => path.includes('board-ranks'))).toEqual([])
  })

  test('applies valhallan evidence', async () => {
    stubApi({ ...healthyAnswers(), '/players/7/valhallan-evidence': { status: 200, body: valhallanEvidence } })

    expect((await loadPlayer(7))?.player.currentSeason?.snapshot?.oneVsOne.tier).toBe('Valhallan')
  })
})
