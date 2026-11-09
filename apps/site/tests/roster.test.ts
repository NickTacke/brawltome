import { describe, expect, test } from 'bun:test'
import type { PlayerRankedSummaryContract } from '@brawltome/contracts'
import {
  countByRole,
  filterMembers,
  type Member,
  rankMembers,
  sortMembers,
  topContributors,
} from '../src/components/guild/roster'

function member(brawlhallaId: number, overrides: Partial<Member> = {}): Member {
  return {
    brawlhallaId,
    name: `Player${brawlhallaId}`,
    rank: 'Member',
    joinDate: null,
    xp: '0',
    guildPoints: null,
    ...overrides,
  }
}

function summary(brawlhallaId: number, rating: number | null, mainLegend: string | null): PlayerRankedSummaryContract {
  return { brawlhallaId, rating, wins: 1, games: 2, mainLegend, updatedAt: null }
}

describe('rankMembers', () => {
  test('orders by xp, highest first, and numbers the placements', () => {
    const ranked = rankMembers([member(1, { xp: '5' }), member(2, { xp: '50' }), member(3, { xp: '9' })], [])

    expect(ranked.map(({ brawlhallaId, placement }) => [brawlhallaId, placement])).toEqual([
      [2, 1],
      [3, 2],
      [1, 3],
    ])
  })

  test('compares xp beyond the safe integer range exactly', () => {
    const ranked = rankMembers([member(1, { xp: '9007199254740992' }), member(2, { xp: '9007199254740993' })], [])

    expect(ranked[0]?.brawlhallaId).toBe(2)
  })

  test('a member without a summary has no elo or main legend', () => {
    const [ranked] = rankMembers([member(1)], [])

    expect(ranked?.elo).toBeNull()
    expect(ranked?.mainLegend).toBeNull()
  })

  test('a member with a summary gets its elo and main legend', () => {
    const [ranked] = rankMembers([member(1)], [summary(1, 2100, 'bodvar')])

    expect(ranked?.elo).toBe(2100)
    expect(ranked?.mainLegend).toBe('bodvar')
  })

  test('an unknown role is a member', () => {
    expect(rankMembers([member(1, { rank: 'Warlord' })], [])[0]?.roleGroup).toBe('member')
    expect(rankMembers([member(1, { rank: null })], [])[0]?.roleGroup).toBe('member')
  })

  test('known roles ignore case', () => {
    expect(rankMembers([member(1, { rank: 'LEADER' })], [])[0]?.roleGroup).toBe('leader')
  })

  test('repairs a broken name', () => {
    expect(rankMembers([member(1, { name: 'MÃ¼ller' })], [])[0]?.displayName).toBe('Müller')
  })

  test('a missing or blank name falls back to the id', () => {
    expect(rankMembers([member(7, { name: null })], [])[0]?.displayName).toBe('Player 7')
    expect(rankMembers([member(7, { name: '   ' })], [])[0]?.displayName).toBe('Player 7')
  })

  test('an empty guild has an empty roster', () => {
    expect(rankMembers([], [])).toEqual([])
  })
})

describe('topContributors', () => {
  test('an empty guild has no contributors', () => {
    expect(topContributors([])).toEqual([])
  })

  test('a guild under three members leaves the other slots out', () => {
    const ranked = rankMembers([member(1, { guildPoints: '10' }), member(2, { guildPoints: '20' })], [])

    expect(topContributors(ranked).map(({ brawlhallaId }) => brawlhallaId)).toEqual([2, 1])
  })

  test('stops at three and counts missing points as zero', () => {
    const members = [
      member(1, { guildPoints: null }),
      member(2, { guildPoints: '3' }),
      member(3, { guildPoints: '2' }),
      member(4, { guildPoints: '1' }),
    ]

    expect(topContributors(rankMembers(members, [])).map(({ brawlhallaId }) => brawlhallaId)).toEqual([2, 3, 4])
  })

  test('ties go to the higher xp placement', () => {
    const members = [member(1, { xp: '1', guildPoints: '5' }), member(2, { xp: '9', guildPoints: '5' })]

    expect(topContributors(rankMembers(members, []))[0]?.brawlhallaId).toBe(2)
  })
})

describe('roster views', () => {
  const roster = rankMembers(
    [
      member(1, { name: 'Alpha', rank: 'Leader', xp: '1' }),
      member(2, { name: 'Beta', rank: 'Officer', xp: '3' }),
      member(3, { name: 'Gamma', rank: 'Recruit', xp: '2' }),
    ],
    [summary(3, 1500, null)],
  )

  test('counts members per role', () => {
    expect(countByRole(roster)).toEqual({ leader: 1, officer: 1, member: 0, recruit: 1 })
  })

  test('filters by role and by name or id', () => {
    expect(filterMembers(roster, 'officer', '').map(({ brawlhallaId }) => brawlhallaId)).toEqual([2])
    expect(filterMembers(roster, 'all', ' GAM').map(({ brawlhallaId }) => brawlhallaId)).toEqual([3])
    expect(filterMembers(roster, 'all', '1').map(({ brawlhallaId }) => brawlhallaId)).toEqual([1])
  })

  test('sorts by role with the leader first', () => {
    const sorted = sortMembers(roster, { key: 'role', descending: true })

    expect(sorted.map(({ brawlhallaId }) => brawlhallaId)).toEqual([1, 2, 3])
  })

  test('members without an elo sort last when descending', () => {
    const sorted = sortMembers(roster, { key: 'elo', descending: true })

    expect(sorted[0]?.brawlhallaId).toBe(3)
  })
})
