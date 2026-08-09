import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SoloLeaderboardRow } from '../../../src/components/Leaderboard/LeaderboardRow'

describe('SoloLeaderboardRow', () => {
  test('renders authoritative and source standings while preserving unknown legacy counts', () => {
    const html = renderToStaticMarkup(
      <SoloLeaderboardRow
        rank={3}
        entry={{
          brawlhallaId: 42,
          name: 'Ada',
          region: 'EU',
          rating: 2100,
          peakRating: null,
          tier: null,
          rank: 3,
          sourceRank: 7,
        }}
      />,
    )
    expect(html).toContain('#3')
    expect(html).toContain('Source #7')
    expect(html).toContain('Peak: ---')
    expect(html.match(/---/g)?.length).toBeGreaterThanOrEqual(4)
    expect(html).not.toContain('0.0%')
  })
})
