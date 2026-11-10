import { describe, expect, test } from 'bun:test'
import { mostPlayedLegendsSchema } from '../src/most-played-legends'

const season = { season: 42, startsAt: '2026-09-23T14:00:00.000Z' }
const mordex = { legendNameKey: 'mordex', games: 120, share: 0.6 }
const unknownLegend = { legendNameKey: 'new legend', games: 80, share: 0.4 }
const counts = { ...season, playerCount: 2, legends: [mordex, unknownLegend] }

describe('most played legends contract', () => {
  test('accepts the season, its player count and each legend share, unknown legends included', () => {
    expect(mostPlayedLegendsSchema.parse(counts)).toEqual(counts)
  })

  test('accepts a season nobody has been seen playing, and no known season', () => {
    const empty = { ...season, playerCount: 0, legends: [] }

    expect(mostPlayedLegendsSchema.parse(empty)).toEqual(empty)
    expect(mostPlayedLegendsSchema.parse(null)).toBeNull()
  })

  test('rejects a share above one, a legend with no games and an unknown field', () => {
    expect(() => mostPlayedLegendsSchema.parse({ ...counts, legends: [{ ...mordex, share: 1.2 }] })).toThrow()
    expect(() => mostPlayedLegendsSchema.parse({ ...counts, legends: [{ ...mordex, games: 0 }] })).toThrow()
    expect(() => mostPlayedLegendsSchema.parse({ ...counts, extra: true })).toThrow()
  })
})
