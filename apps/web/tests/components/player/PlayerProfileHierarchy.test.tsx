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
    const competitive = html.indexOf('Competitive Snapshot')
    const currentSeason = html.indexOf('Current Season</h2>')
    const career = html.indexOf('Career Statistics</h2>')

    expect(identity).toBeGreaterThanOrEqual(0)
    expect(identity).toBeLessThan(competitive)
    expect(competitive).toBeLessThan(currentSeason)
    expect(currentSeason).toBeLessThan(career)
    expect(html.match(/Competitive Snapshot/g)).toHaveLength(1)
    expect(html.match(/Current Season<\/h2>/g)).toHaveLength(1)
    expect(html.match(/Career Statistics<\/h2>/g)).toHaveLength(1)
    expect(html.match(/Complete Current Season ranked facts have not been successfully observed/g)).toHaveLength(1)
    expect(html).toContain('No additional Current Season details are available.')
    expect(html).toContain('Checking for updates')
    expect(html.toLowerCase()).not.toContain('live data')
    expect(html).not.toContain('isOwnProfile')
    expect(html).not.toContain('owner-only')
  })
})
