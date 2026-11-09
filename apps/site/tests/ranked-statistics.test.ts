import { describe, expect, test } from 'bun:test'
import type { PlayerRankedSummaryContract } from '@brawltome/contracts'
import {
  averageRating,
  axisTicks,
  type Band,
  bandSummary,
  nextReadout,
  type Readout,
  rankedRecord,
  ratedMembers,
  ratingBands,
  tallestBandCount,
  topRated,
  winRateColour,
  winRatePercent,
} from '../src/components/guild/ranked-statistics'
import type { RankedMember } from '../src/components/guild/roster'

const dayMs = 24 * 60 * 60 * 1000
const now = new Date('2026-11-09T12:00:00.000Z')

function daysAgo(days: number): string {
  return new Date(now.getTime() - days * dayMs).toISOString()
}

function summary(overrides: Partial<PlayerRankedSummaryContract> = {}): PlayerRankedSummaryContract {
  return { brawlhallaId: 1, rating: 2000, wins: 6, games: 10, mainLegend: null, updatedAt: daysAgo(1), ...overrides }
}

function member(brawlhallaId: number, elo: number | null): RankedMember {
  return {
    brawlhallaId,
    name: `Player${brawlhallaId}`,
    rank: 'Member',
    joinDate: null,
    xp: '1',
    guildPoints: null,
    placement: brawlhallaId,
    displayName: `Player${brawlhallaId}`,
    roleGroup: 'member',
    mainLegend: null,
    elo,
  }
}

const bandA: Band = { from: 2000, count: 2 }
const bandB: Band = { from: 2050, count: 1 }

describe('ratingBands', () => {
  test('no ratings give no bands', () => {
    expect(ratingBands([])).toEqual([])
  })

  test('counts ratings in 50 elo bands', () => {
    expect(ratingBands([2005, 2049, 2050])).toEqual([
      { from: 2000, count: 2 },
      { from: 2050, count: 1 },
    ])
  })

  test('a band between two rated players has a count of 0', () => {
    expect(ratingBands([2000, 2120])).toEqual([
      { from: 2000, count: 1 },
      { from: 2050, count: 0 },
      { from: 2100, count: 1 },
    ])
  })

  test('one rating gives one band', () => {
    expect(ratingBands([1834])).toEqual([{ from: 1800, count: 1 }])
  })

  test('the order of the ratings does not matter', () => {
    expect(ratingBands([2050, 2005])).toEqual(ratingBands([2005, 2050]))
  })
})

describe('tallestBandCount', () => {
  test('is 0 without bands', () => {
    expect(tallestBandCount([])).toBe(0)
  })

  test('finds the largest count', () => {
    expect(tallestBandCount([bandA, bandB])).toBe(2)
  })
})

describe('axisTicks', () => {
  test('marks every 500 elo inside the range', () => {
    expect(axisTicks(1400, 2600)).toEqual([1500, 2000, 2500])
  })

  test('leaves out a tick on the end of the range', () => {
    expect(axisTicks(1950, 2000)).toEqual([])
  })
})

describe('bandSummary', () => {
  test('one player is singular', () => {
    expect(bandSummary({ from: 2000, count: 1 })).toBe('2,000–2,049 · 1 player')
  })

  test('other counts are plural', () => {
    expect(bandSummary({ from: 2000, count: 0 })).toBe('2,000–2,049 · 0 players')
    expect(bandSummary({ from: 2000, count: 12 })).toBe('2,000–2,049 · 12 players')
  })
})

describe('nextReadout', () => {
  const empty: Readout = { slots: [null, null], activeSlot: null }

  test('the first band goes in the first slot', () => {
    expect(nextReadout(empty, bandA)).toEqual({ slots: [bandA, null], activeSlot: 0 })
  })

  test('writes the hidden slot and keeps the shown text', () => {
    const showingA: Readout = { slots: [bandA, null], activeSlot: 0 }

    expect(nextReadout(showingA, bandB)).toEqual({ slots: [bandA, bandB], activeSlot: 1 })
  })

  test('swaps back to the first slot from the second', () => {
    const showingB: Readout = { slots: [bandA, bandB], activeSlot: 1 }

    expect(nextReadout(showingB, bandA)).toEqual({ slots: [bandA, bandB], activeSlot: 0 })
  })

  test('returns the same object for the active band', () => {
    const showingA: Readout = { slots: [bandA, null], activeSlot: 0 }

    expect(nextReadout(showingA, { from: 2000, count: 2 })).toBe(showingA)
  })

  test('shows a band again after the readout was hidden', () => {
    const hidden: Readout = { slots: [bandA, null], activeSlot: null }

    expect(nextReadout(hidden, bandA).activeSlot).toBe(0)
  })

  test('leaves the old readout alone', () => {
    const showingA: Readout = { slots: [bandA, null], activeSlot: 0 }

    nextReadout(showingA, bandB)

    expect(showingA).toEqual({ slots: [bandA, null], activeSlot: 0 })
  })
})

describe('rankedRecord', () => {
  test('sums the rows that count', () => {
    const rows = [summary({ wins: 6, games: 10 }), summary({ wins: 1, games: 4 })]

    expect(rankedRecord(rows, now)).toEqual({ wins: 7, games: 14, players: 2 })
  })

  test('no rows give an empty record', () => {
    expect(rankedRecord([], now)).toEqual({ wins: 0, games: 0, players: 0 })
  })

  test('a row updated 31 days ago is skipped', () => {
    expect(rankedRecord([summary({ updatedAt: daysAgo(31) })], now).players).toBe(0)
  })

  test('a row without an update time is skipped', () => {
    expect(rankedRecord([summary({ updatedAt: null })], now).players).toBe(0)
  })

  test('a row without games is skipped', () => {
    expect(rankedRecord([summary({ wins: 0, games: 0 })], now).players).toBe(0)
  })

  test('a row updated exactly 30 days ago counts', () => {
    expect(rankedRecord([summary({ updatedAt: daysAgo(30) })], now).players).toBe(1)
  })

  test('a row one millisecond past 30 days is skipped', () => {
    const justTooOld = new Date(now.getTime() - 30 * dayMs - 1).toISOString()

    expect(rankedRecord([summary({ updatedAt: justTooOld })], now).players).toBe(0)
  })
})

describe('winRatePercent', () => {
  test('is hidden under 5 players', () => {
    expect(winRatePercent({ wins: 5, games: 10, players: 4 })).toBeNull()
  })

  test('is shown from 5 players', () => {
    expect(winRatePercent({ wins: 5, games: 10, players: 5 })).toBe(50)
  })

  test('is hidden without games', () => {
    expect(winRatePercent({ wins: 0, games: 0, players: 5 })).toBeNull()
  })

  test('rounds to the one decimal the page shows', () => {
    expect(winRatePercent({ wins: 5996, games: 10000, players: 5 })).toBe(60)
  })
})

describe('winRateColour', () => {
  test('60% or more is green', () => {
    expect(winRateColour(60)).toBe('text-emerald-400')
  })

  test('50% or more is blue', () => {
    expect(winRateColour(59.9)).toBe('text-primary')
    expect(winRateColour(50)).toBe('text-primary')
  })

  test('below 50% is grey', () => {
    expect(winRateColour(49.9)).toBe('text-soft')
  })
})

describe('rated members', () => {
  test('members without an elo are left out', () => {
    expect(ratedMembers([member(1, 2000), member(2, null)]).map(({ brawlhallaId }) => brawlhallaId)).toEqual([1])
  })

  test('a rating no player can have is left out', () => {
    const rated = ratedMembers([member(1, 2000), member(2, 2_147_483_647)])

    expect(rated.map(({ brawlhallaId }) => brawlhallaId)).toEqual([1])
  })

  test('the average is rounded', () => {
    expect(averageRating(ratedMembers([member(1, 2000), member(2, 2001)]))).toBe(2001)
  })

  test('the top list is ordered by elo and stops at five', () => {
    const members = [1500, 1900, 2100, 1700, 2000, 1600].map((elo, index) => member(index + 1, elo))

    expect(topRated(ratedMembers(members)).map(({ elo }) => elo)).toEqual([2100, 2000, 1900, 1700, 1600])
  })

  test('one rated member is a top list of one', () => {
    expect(topRated(ratedMembers([member(1, 2000)]))).toHaveLength(1)
  })
})
