import { describe, expect, test } from 'bun:test'
import { backgroundIn, createMapPictures } from '../map-picture'
import { recordOf } from '../match-lists'
import { type ResultLine, winningSlots } from '../match-result'

function line(slot: number, deaths: number, team = 0, score: number | null = null): ResultLine {
  return { slot, team, deaths, score }
}

describe('who won', () => {
  test('a stock 1v1 goes to the player who fell least', () => {
    expect(winningSlots([line(1, 3), line(2, 1)], false)).toEqual(new Set([2]))
  })

  test('a 2v2 counts falls by team, so both players of the winning team win', () => {
    const lines = [line(1, 3, 1), line(2, 2, 1), line(3, 1, 2), line(4, 3, 2)]

    expect(winningSlots(lines, true)).toEqual(new Set([3, 4]))
  })

  test('a self-destruct counts as a fall, so the result agrees with the falls and not the KOs', () => {
    // slot 1 took two KOs and fell three times, once on its own
    expect(winningSlots([line(1, 3), line(2, 2)], false)).toEqual(new Set([2]))
  })

  test('a timed free for all goes to the highest score', () => {
    const lines = [line(1, 4, 0, 38), line(2, 2, 0, 58), line(3, 3, 0, 52), line(4, 1, 0, 85)]

    expect(winningSlots(lines, false)).toEqual(new Set([4]))
  })

  test('a draw leaves both sides winning', () => {
    expect(winningSlots([line(1, 2), line(2, 2)], false)).toEqual(new Set([1, 2]))
  })
})

describe('a player’s record', () => {
  const at = new Date('2026-11-18T21:00:00.000Z')
  const later = new Date('2026-11-18T22:00:00.000Z')

  function recordLine(matchId: string, slot: number, brawlhallaId: number, deaths: number, legendId: number) {
    return {
      matchId,
      hasTeams: false,
      parsedAt: matchId === 'b' ? later : at,
      slot,
      brawlhallaId,
      team: 0,
      deaths,
      score: null,
      legendId,
      legendName: `LEGEND ${legendId}`,
    }
  }

  // a legend the game data doesn't know keeps the line's name, capitalised
  test('counts games, wins and each legend the player played, most played first', () => {
    const lines = [
      recordLine('a', 1, 7, 1, 930),
      recordLine('a', 2, 8, 3, 12),
      recordLine('b', 1, 7, 3, 930),
      recordLine('b', 2, 9, 1, 12),
      recordLine('c', 1, 9, 3, 40),
      recordLine('c', 2, 7, 0, 941),
    ]

    expect(recordOf(lines, 7)).toEqual({
      games: 3,
      wins: 2,
      lastParsedAt: later.toISOString(),
      legends: [
        { legendId: 930, legendName: 'Legend 930', legendKey: 'legend 930', games: 2, wins: 1 },
        { legendId: 941, legendName: 'Legend 941', legendKey: 'legend 941', games: 1, wins: 1 },
      ],
    })
  })

  test('a draw is not a win', () => {
    const drawn = [recordLine('a', 1, 7, 2, 930), recordLine('a', 2, 8, 2, 12)]

    expect(recordOf(drawn, 7)).toMatchObject({ games: 1, wins: 0 })
  })

  test('a player in no match has an empty record', () => {
    expect(recordOf([], 7)).toEqual({ games: 0, wins: 0, lastParsedAt: null, legends: [] })
  })
})

describe('a map’s picture', () => {
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

  test('is the background sheet the map file names', () => {
    const mapFile = { background: { asset: 'sheets/0a595e48e9f677f4.webp', width: 2048, height: 1151 } }

    expect(backgroundIn(encode(mapFile))).toBe('sheets/0a595e48e9f677f4.webp')
  })

  test('is none for a level without a background, a path outside the sheets, or a file that is not json', () => {
    expect(backgroundIn(encode({ layout: {} }))).toBeNull()
    expect(backgroundIn(encode({ background: { asset: '../matches/x/manifest.json' } }))).toBeNull()
    expect(backgroundIn(new TextEncoder().encode('{'))).toBeNull()
    expect(backgroundIn(null)).toBeNull()
  })
})

describe('map pictures for a page of matches', () => {
  const mapFiles = [{ patch: '11.01', mapId: 223, path: 'maps/aaaa.json' }]
  const background = { background: { asset: 'sheets/0a595e48e9f677f4.webp' } }

  // stands in for postgres: every query answers with the stored map files
  function fakeSql(queries: { count: number }) {
    return (() => {
      queries.count += 1

      return Promise.resolve(mapFiles)
    }) as unknown as Parameters<typeof createMapPictures>[0]['sql']
  }

  function artStore(get: () => Promise<Uint8Array | null>) {
    return { get, put: async () => undefined, delete: async () => undefined } as unknown as Parameters<
      typeof createMapPictures
    >[0]['artStore']
  }

  test('finds every map of a page in one query, then keeps what it found', async () => {
    const queries = { count: 0 }
    const bytes = new TextEncoder().encode(JSON.stringify(background))

    const pictures = createMapPictures({
      sql: fakeSql(queries),
      artStore: artStore(async () => bytes),
      artBaseUrl: 'https://art.test',
    })

    const page = [
      { patch: '11.01', mapId: 223 },
      { patch: '11.01', mapId: 223 },
    ]

    expect(await pictures(page)).toEqual(new Map([['11.01/223', 'https://art.test/sheets/0a595e48e9f677f4.webp']]))
    expect(await pictures(page)).toHaveProperty('size', 1)
    expect(queries.count).toBe(1)
  })

  test('a bucket that doesn’t answer leaves the map without a picture instead of failing the list', async () => {
    const pictures = createMapPictures({
      sql: fakeSql({ count: 0 }),
      artStore: artStore(async () => {
        throw new Error('bucket down')
      }),
      artBaseUrl: 'https://art.test',
    })

    expect(await pictures([{ patch: '11.01', mapId: 223 }])).toEqual(new Map())
  })
})
