import { describe, expect, test } from 'bun:test'
import { metaLegendsSchema } from '../src/meta-legends'

const season = { season: 42, startsAt: '2026-09-23T14:00:00.000Z' }
const diana = { legendNameKey: 'diana', games: 4200, playerCount: 140, winRate: 0.56, gameShare: 0.051 }
const unknownLegend = { legendNameKey: 'new legend', games: 30, playerCount: 2, winRate: 0.5, gameShare: 0.0004 }
const meta = { ...season, legends: [diana, unknownLegend] }

describe('meta legends contract', () => {
  test('accepts the season and each legend with its games, players, win rate and share, unknown legends included', () => {
    expect(metaLegendsSchema.parse(meta)).toEqual(meta)
  })

  test('accepts a season with no high rated players yet, and no known season', () => {
    const empty = { ...season, legends: [] }

    expect(metaLegendsSchema.parse(empty)).toEqual(empty)
    expect(metaLegendsSchema.parse(null)).toBeNull()
  })

  test('rejects a win rate or share above one, a legend with no players and an unknown field', () => {
    expect(() => metaLegendsSchema.parse({ ...meta, legends: [{ ...diana, winRate: 1.2 }] })).toThrow()
    expect(() => metaLegendsSchema.parse({ ...meta, legends: [{ ...diana, playerCount: 0 }] })).toThrow()
    expect(() => metaLegendsSchema.parse({ ...meta, extra: true })).toThrow()
    expect(() => metaLegendsSchema.parse({ ...meta, legends: [{ ...diana, gameShare: 1.2 }] })).toThrow()
  })
})
