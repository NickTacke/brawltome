import { describe, expect, it } from 'bun:test'
import { filterMembers, paginateMembers, sortMembers } from '../../../../src/components/clan/ClanProfile/utils'

const M = (
  id: number,
  extra: Partial<{ name: string; rating: number; xp: string; rank: string; joinDate: string }> = {},
) => ({
  brawlhallaId: id,
  name: extra.name ?? `m${id}`,
  rating: extra.rating ?? 0,
  xp: extra.xp ?? '0',
  rank: extra.rank ?? 'member',
  joinDate: extra.joinDate ?? '2024-01-01T00:00:00Z',
})

describe('paginateMembers', () => {
  it('returns first page', () => {
    const all = [M(1), M(2), M(3), M(4), M(5)]
    expect(paginateMembers(all, 1, 2)).toEqual([M(1), M(2)])
  })

  it('returns nth page', () => {
    const all = [M(1), M(2), M(3), M(4), M(5)]
    expect(paginateMembers(all, 2, 2)).toEqual([M(3), M(4)])
  })

  it('returns last partial page', () => {
    const all = [M(1), M(2), M(3), M(4), M(5)]
    expect(paginateMembers(all, 3, 2)).toEqual([M(5)])
  })

  it('returns empty for page beyond end', () => {
    const all = [M(1), M(2), M(3)]
    expect(paginateMembers(all, 5, 10)).toEqual([])
  })

  it('returns empty for empty input', () => {
    expect(paginateMembers([], 1, 10)).toEqual([])
  })
})

describe('filterMembers', () => {
  const members = [M(101, { name: 'Alice' }), M(202, { name: 'bob' }), M(303, { name: 'Charlie' })]

  it('returns all when search is empty', () => {
    expect(filterMembers(members, '')).toEqual(members)
  })

  it('matches by name case-insensitively', () => {
    expect(filterMembers(members, 'ALI')).toEqual([members[0]])
  })

  it('matches by partial id', () => {
    expect(filterMembers(members, '20')).toEqual([members[1]])
  })

  it('returns empty when nothing matches', () => {
    expect(filterMembers(members, 'zzz')).toEqual([])
  })

  it('matches a member without a name by ID only', () => {
    const nameless = { ...M(404), name: null }
    expect(filterMembers([nameless], '404')).toEqual([nameless])
    expect(filterMembers([nameless], 'player')).toEqual([])
  })
})

describe('sortMembers', () => {
  it('sorts by xp descending', () => {
    const all = [M(1, { xp: '10' }), M(2, { xp: '50' }), M(3, { xp: '30' })]
    expect(sortMembers(all, 'xp').map((m) => m.brawlhallaId)).toEqual([2, 3, 1])
  })

  it('sorts by rank value descending then by joinDate ascending', () => {
    const all = [
      M(1, { rank: 'recruit', joinDate: '2024-01-01T00:00:00Z' }),
      M(2, { rank: 'leader', joinDate: '2024-02-01T00:00:00Z' }),
      M(3, { rank: 'officer', joinDate: '2024-03-01T00:00:00Z' }),
      M(4, { rank: 'member', joinDate: '2024-04-01T00:00:00Z' }),
      M(5, { rank: 'member', joinDate: '2024-01-15T00:00:00Z' }),
    ]
    expect(sortMembers(all, 'default').map((m) => m.brawlhallaId)).toEqual([2, 3, 5, 4, 1])
  })

  it('sorts unavailable rank and join date after known members', () => {
    const unknown = { ...M(1), rank: null, joinDate: null }
    const known = M(2, { rank: 'member', joinDate: '2024-01-01T00:00:00Z' })
    expect(sortMembers([unknown, known], 'default').map((member) => member.brawlhallaId)).toEqual([2, 1])
  })

  it('does not mutate input', () => {
    const all = [M(1, { xp: '10' }), M(2, { xp: '50' })]
    const snapshot = [...all]
    sortMembers(all, 'xp')
    expect(all).toEqual(snapshot)
  })
})
