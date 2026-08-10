import { describe, expect, it } from 'bun:test'
import { buildCommands, isNumericPlayerId } from '../../../src/components/CommandPalette/utils'

const NAV_ITEMS = [
  { label: 'Home', href: '/', icon: () => null, iconWeight: 'Linear' as const },
  { label: 'Leaderboard', href: '/leaderboard', icon: () => null, iconWeight: 'Linear' as const },
]

describe('buildCommands', () => {
  it('returns nav commands when not in search mode', () => {
    const result = buildCommands({
      isSearchMode: false,
      navItems: NAV_ITEMS,
      playerResults: [],
      clanResults: [],
    })
    expect(result).toHaveLength(2)
    expect(result[0].kind).toBe('nav')
    expect(result[0].id).toBe('nav-/')
    expect(result[0].label).toBe('Home')
    expect(result[0].href).toBe('/')
    expect(result[1].kind).toBe('nav')
    expect(result[1].href).toBe('/leaderboard')
  })

  it('returns player + clan commands when in search mode', () => {
    const result = buildCommands({
      isSearchMode: true,
      navItems: NAV_ITEMS,
      playerResults: [
        {
          brawlhallaId: 1,
          name: 'Alice',
          region: 'us-e',
          rating: 1500,
          viewCount: 1,
          bestLegendNameKey: 'bodvar',
          matchedAlias: null,
        },
      ],
      clanResults: [{ clanId: 99, clanName: 'Test Clan', clanXp: '10', memberCount: 1 }],
    })
    expect(result).toHaveLength(2)
    expect(result[0].kind).toBe('player')
    expect(result[0].id).toBe('p-1')
    expect(result[0].href).toBe('/player/1')
    expect(result[1].kind).toBe('clan')
    expect(result[1].id).toBe('c-99')
    expect(result[1].href).toBe('/clan/99')
  })

  it('returns empty array when in search mode with no results', () => {
    const result = buildCommands({
      isSearchMode: true,
      navItems: NAV_ITEMS,
      playerResults: [],
      clanResults: [],
    })
    expect(result).toEqual([])
  })

  it('returns players before clans when both present', () => {
    const result = buildCommands({
      isSearchMode: true,
      navItems: NAV_ITEMS,
      playerResults: [
        {
          brawlhallaId: 1,
          name: 'Alice',
          region: null,
          rating: null,
          viewCount: 0,
          bestLegendNameKey: null,
          matchedAlias: null,
        },
      ],
      clanResults: [{ clanId: 99, clanName: 'Clan', clanXp: '0', memberCount: 0 }],
    })
    expect(result.map((c) => c.kind)).toEqual(['player', 'clan'])
  })
})

describe('isNumericPlayerId', () => {
  it('accepts 5-digit numeric strings', () => {
    expect(isNumericPlayerId('12345')).toBe(true)
  })

  it('accepts longer numeric strings', () => {
    expect(isNumericPlayerId('1234567890')).toBe(true)
  })

  it('rejects strings shorter than 5 digits', () => {
    expect(isNumericPlayerId('1234')).toBe(false)
  })

  it('rejects non-numeric strings', () => {
    expect(isNumericPlayerId('abc')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isNumericPlayerId('')).toBe(false)
  })

  it('rejects mixed alphanumeric', () => {
    expect(isNumericPlayerId('12345abc')).toBe(false)
  })

  it('accepts trimmed input with surrounding whitespace', () => {
    expect(isNumericPlayerId('  12345  ')).toBe(true)
  })
})
