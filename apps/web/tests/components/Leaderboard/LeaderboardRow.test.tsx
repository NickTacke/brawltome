import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SoloLeaderboardRow, TeamLeaderboardRow } from '../../../src/components/Leaderboard/LeaderboardRow'

const metrics = {
  standing: 3,
  sourceRank: 7,
  region: 'EU' as const,
  rating: 2100,
  peakRating: null,
  tier: null,
  wins: 20,
  losses: 10,
  games: 30,
}

describe('validated leaderboard rows', () => {
  test('player modes render only the displayed standing and best legend avatar', () => {
    const html = renderToStaticMarkup(
      <SoloLeaderboardRow
        entry={{
          ...metrics,
          identity: {
            type: 'three-vs-three-player',
            player: { brawlhallaId: 42, name: 'Ada', bestLegendNameKey: 'bodvar' },
          },
        }}
      />,
    )
    expect(html).toContain('#3')
    expect(html).not.toContain('Source #')
    expect(html).toContain('aria-label="Ada best legend: bodvar"')
    expect(html).toContain('href="/player/42"')
    expect(html).toContain('Peak: ---')
  })

  test('fixed teams render both positive player links without source ranks', () => {
    const html = renderToStaticMarkup(
      <TeamLeaderboardRow
        entry={{
          ...metrics,
          identity: {
            type: 'fixed-two-vs-two-team',
            players: [
              { brawlhallaId: 42, name: 'Ada' },
              { brawlhallaId: 43, name: 'Bodvar' },
            ],
          },
        }}
      />,
    )
    expect(html).toContain('#3')
    expect(html).not.toContain('Source #')
    expect(html).toContain('href="/player/42"')
    expect(html).toContain('href="/player/43"')
  })

  test('defensively never creates a /player/0 link', () => {
    const html = renderToStaticMarkup(
      <SoloLeaderboardRow
        entry={{
          ...metrics,
          identity: {
            type: 'solo-two-vs-two-player',
            player: { brawlhallaId: 0, name: 'Sentinel' },
          },
        }}
      />,
    )
    expect(html).not.toContain('/player/0')
  })
})
