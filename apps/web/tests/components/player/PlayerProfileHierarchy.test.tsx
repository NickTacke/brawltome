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

describe('PlayerProfileHierarchy', () => {
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
    expect(html).toContain('V2 snapshot')
    expect(html).toContain('1800')
    expect(html).toContain('Current-season wins and losses are unavailable.')
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
})
