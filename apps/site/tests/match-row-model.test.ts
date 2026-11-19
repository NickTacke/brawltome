import { describe, expect, test } from 'bun:test'
import type { MatchSummaryContract } from '@brawltome/contracts'
import { queueLabel, resultFor, rowViewOf, shortAgo } from '../src/components/matches/match-row-model'

type Line = { slot: number; id: number; team?: number; deaths: number; isWinner: boolean; score?: number | null }

function matchOf(lines: Line[], overrides: Partial<MatchSummaryContract> = {}): MatchSummaryContract {
  return {
    id: '6f9a7f4e-3c1d-4b2a-9e8f-1a2b3c4d5e6f',
    patch: '11.01',
    mapName: 'Mishima Dojo',
    modeName: 'Stock',
    isRanked: true,
    isCustom: false,
    queue: 'ranked',
    hasTeams: false,
    stocks: 3,
    durationMs: 90_000,
    parsedAt: '2026-11-18T21:00:00.000Z',
    mapPictureUrl: null,
    players: lines.map((line) => ({
      slot: line.slot,
      brawlhallaId: line.id,
      name: `Player ${line.id}`,
      team: line.team ?? 0,
      legendId: 3,
      legendName: 'Ember',
      legendKey: 'ember',
      kos: 0,
      deaths: line.deaths,
      damageDealt: 100,
      score: line.score ?? null,
      isWinner: line.isWinner,
    })),
    ...overrides,
  }
}

const oneVsOne = matchOf([
  { slot: 1, id: 11, deaths: 3, isWinner: false },
  { slot: 2, id: 22, deaths: 1, isWinner: true },
])

describe('a match row', () => {
  test('puts the winners first when the visitor didn’t play, with the stocks each side took', () => {
    const view = rowViewOf(oneVsOne, null)

    expect(view).toMatchObject({ kind: 'versus', firstScore: 3, secondScore: 1 })
    expect(view.kind === 'versus' && view.first.map((player) => player.brawlhallaId)).toEqual([22])
  })

  test('puts the visitor’s side first in a match they played, win or lose', () => {
    const view = rowViewOf(oneVsOne, 11)

    expect(view).toMatchObject({ kind: 'versus', firstScore: 1, secondScore: 3 })
    expect(resultFor(oneVsOne, 11)).toEqual({ kind: 'lost' })
    expect(resultFor(oneVsOne, 22)).toEqual({ kind: 'won' })
    expect(resultFor(oneVsOne, 99)).toBeNull()
  })

  test('keeps a 2v2 team together on one side', () => {
    const twos = matchOf(
      [
        { slot: 1, id: 11, team: 1, deaths: 3, isWinner: false },
        { slot: 2, id: 12, team: 2, deaths: 1, isWinner: true },
        { slot: 3, id: 13, team: 1, deaths: 3, isWinner: false },
        { slot: 4, id: 14, team: 2, deaths: 2, isWinner: true },
      ],
      { hasTeams: true },
    )

    const view = rowViewOf(twos, 13)

    expect(view.kind === 'versus' && view.first.map((player) => player.brawlhallaId)).toEqual([11, 13])
    expect(queueLabel(twos)).toBe('Ranked 2v2')
  })

  test('places a timed free for all by score and gives the visitor their place', () => {
    const freeForAll = matchOf(
      [
        { slot: 1, id: 11, deaths: 4, isWinner: false, score: 38 },
        { slot: 2, id: 12, deaths: 1, isWinner: true, score: 85 },
        { slot: 3, id: 13, deaths: 3, isWinner: false, score: 52 },
      ],
      { isRanked: false, queue: 'other', isCustom: true, stocks: null },
    )

    const view = rowViewOf(freeForAll, 13)

    expect(view.kind === 'freeForAll' && view.placed.map((player) => player.brawlhallaId)).toEqual([12, 13, 11])
    expect(resultFor(freeForAll, 13)).toEqual({ kind: 'place', place: 2 })
    expect(queueLabel(freeForAll)).toBe('Custom FFA')
  })

  test('a match both sides won is a draw', () => {
    const drawn = matchOf([
      { slot: 1, id: 11, deaths: 2, isWinner: true },
      { slot: 2, id: 22, deaths: 2, isWinner: true },
    ])

    expect(resultFor(drawn, 11)).toEqual({ kind: 'draw' })
  })
})

describe('how long ago', () => {
  const now = new Date('2026-11-18T22:00:00.000Z')

  test('reads as short as a list can show it', () => {
    expect(shortAgo('2026-11-18T21:59:30.000Z', now)).toBe('now')
    expect(shortAgo('2026-11-18T21:48:00.000Z', now)).toBe('12m')
    expect(shortAgo('2026-11-18T19:00:00.000Z', now)).toBe('3h')
    expect(shortAgo('2026-11-16T22:00:00.000Z', now)).toBe('2d')
    expect(shortAgo('2026-10-28T22:00:00.000Z', now)).toBe('3w')
  })
})
