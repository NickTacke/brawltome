import { describe, expect, test } from 'bun:test'
import type { PlayerRankedProfileContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlayerProfileHierarchy } from '../../../src/components/player/PlayerProfile/PlayerProfileHierarchy'

const unavailableRanked: PlayerRankedProfileContract = {
  brawlhallaId: 42,
  checkedAt: '2026-08-10T10:00:00Z',
  lastSuccessAt: null,
  freshness: 'unavailable',
  freshForSeconds: 3_600,
  sparsePulse: null,
  snapshot: null,
}

const career = {
  brawlhallaId: 42,
  checkedAt: '2026-08-10T10:00:00Z',
  lastSuccessAt: '2026-08-10T10:00:00Z',
  freshness: 'fresh' as const,
  freshForSeconds: 43_200,
  snapshot: {
    guild: { guildId: 2_616_365, guildName: 'Son of God' },
    account: { xp: 100, level: 2, xpPercentage: 0.5 },
    combat: {
      games: 10,
      wins: 4,
      matchTime: 7_200,
      damageBomb: '0',
      damageMine: '0',
      damageSpikeball: '0',
      damageSidekick: '0',
      snowballHits: 0,
      bombKos: 0,
      mineKos: 0,
      spikeballKos: 0,
      sidekickKos: 0,
      snowballKos: 0,
    },
    legends: [],
    weapons: [],
  },
}

describe('PlayerProfileHierarchy', () => {
  test('passes canonical career data to the V2-style header', () => {
    const html = renderToStaticMarkup(
      <PlayerProfileHierarchy
        player={{
          brawlhallaId: 42,
          name: 'Canonical Player',
          aliases: [],
          clan: { clanId: 7, clanName: 'Guild Name' },
          currentSeason: unavailableRanked,
          career,
        }}
        refreshing={false}
        careerRefreshing={false}
      />,
    )

    expect(html).toContain('Playtime:')
    expect(html).not.toContain('Lifetime playtime:')
    expect(html).toContain('2h')
    expect(html).toContain('Guild:')
    expect(html).toContain('Son of God')
  })

  test('renders one canonical viewer-neutral profile hierarchy', () => {
    const html = renderToStaticMarkup(
      <PlayerProfileHierarchy
        player={{
          brawlhallaId: 42,
          name: 'Canonical Player',
          bestLegendNameKey: 'bodvar',
          legacyRating: 1800,
          aliases: [],
          clan: null,
          currentSeason: unavailableRanked,
          career: null,
        }}
        refreshing
        careerRefreshing={false}
      />,
    )

    const identity = html.indexOf('Canonical Player')
    const ranked = html.indexOf('Ranked Performance')
    const combat = html.indexOf('Combat Record')

    expect(identity).toBeGreaterThanOrEqual(0)
    expect(identity).toBeLessThan(ranked)
    expect(ranked).toBeGreaterThanOrEqual(0)
    expect(combat).toBeGreaterThan(ranked)
    expect(html).toContain('grid grid-cols-1 lg:grid-cols-2 gap-6')
    expect(html).toContain('Unranked')
    expect(html).not.toContain('V2 snapshot')
    expect(html).not.toContain('1800')
    expect(html).not.toContain('Rating unavailable')
    expect(html).not.toContain('Current-season wins and losses are unavailable.')
    expect(html).toContain('Career outcomes have not been observed.')
    expect(html).not.toContain('0 Wins')
    expect(html).not.toContain('Competitive Snapshot')
    expect(html).not.toContain('Current Season</h2>')
    expect(html).not.toContain('Career Statistics</h2>')
    expect(html).toContain('Checking for updates')
    expect(html).toContain('rounded-2xl">b</span>')
    expect(html.toLowerCase()).not.toContain('live data')
    expect(html).not.toContain('isOwnProfile')
    expect(html).not.toContain('owner-only')
  })

  test('falls back to frozen V2 career and legend statistics when canonical career is absent', () => {
    const html = renderToStaticMarkup(
      <PlayerProfileHierarchy
        player={{
          brawlhallaId: 42,
          name: 'Legacy Player',
          bestLegendNameKey: 'bodvar',
          aliases: [],
          clan: null,
          currentSeason: unavailableRanked,
          career: null,
          xp: 5_000,
          level: 10,
          xpPercentage: 0.25,
          totalGames: 200,
          totalWins: 120,
          matchTimeTotal: 7_200,
          statsLastUpdated: '2026-08-01T09:00:00Z',
          statsLegends: [
            {
              legendId: 3,
              legendNameKey: 'bodvar',
              xp: 3_000,
              level: 8,
              xpPercentage: 0.5,
              games: 120,
              wins: 60,
              matchTime: 3_600,
            },
          ],
        }}
        refreshing={false}
        careerRefreshing={false}
      />,
    )

    expect(html).toContain('Account Level')
    expect(html).toContain('>10<')
    expect(html).toContain('>200<')
    expect(html).toContain('120 Wins')
    expect(html).toContain('80 Losses')
    expect(html).toContain('Legend Statistics')
    expect(html).toContain('Playtime:')
    expect(html).toContain('2h')
  })

  test('does not mutate V2 legend order while rendering the XP sort', () => {
    const statsLegends = [
      { legendId: 3, legendNameKey: 'bodvar', xp: 100 },
      { legendId: 4, legendNameKey: 'cassidy', xp: 200 },
    ]
    renderToStaticMarkup(
      <PlayerProfileHierarchy
        player={{
          brawlhallaId: 42,
          name: 'Legacy Player',
          aliases: [],
          clan: null,
          currentSeason: unavailableRanked,
          career: null,
          statsLegends,
        }}
        refreshing={false}
        careerRefreshing={false}
      />,
    )

    expect(statsLegends.map(({ legendId }) => legendId)).toEqual([3, 4])
  })

  test('treats canonical measured zeros and empty legends as authoritative over frozen V2 statistics', () => {
    const zeroCareer = {
      ...career,
      snapshot: {
        ...career.snapshot,
        account: { xp: 0, level: 0, xpPercentage: 0 },
        combat: { ...career.snapshot.combat, games: 0, wins: 0 },
      },
    }
    const html = renderToStaticMarkup(
      <PlayerProfileHierarchy
        player={{
          brawlhallaId: 42,
          name: 'Canonical Player',
          aliases: [],
          clan: null,
          currentSeason: unavailableRanked,
          career: zeroCareer,
          xp: 999,
          level: 99,
          totalGames: 999,
          totalWins: 999,
          statsLegends: [{ legendId: 3, legendNameKey: 'bodvar', xp: 999 }],
        }}
        refreshing={false}
        careerRefreshing={false}
      />,
    )

    expect(html).toContain('>0<')
    expect(html).toContain('0 Wins')
    expect(html).toContain('0 Losses')
    expect(html).not.toContain('>99<')
    expect(html).not.toContain('>999<')
    expect(html).not.toContain('Legend Statistics')
  })
})
