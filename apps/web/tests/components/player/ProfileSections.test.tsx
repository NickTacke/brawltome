import { describe, expect, test } from 'bun:test'
import type { PlayerRankedProfileContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProfileSections } from '../../../src/components/player/PlayerProfile/ProfileSections'

function rankedProfile(withDetails: boolean): PlayerRankedProfileContract {
  return {
    brawlhallaId: 42,
    checkedAt: '2026-08-10T10:00:00Z',
    lastSuccessAt: '2026-08-10T10:00:00Z',
    freshness: 'fresh',
    freshForSeconds: 3_600,
    sparsePulse: null,
    snapshot: {
      oneVsOne: {
        rating: 1_600,
        peakRating: 1_650,
        tier: 'Gold 4',
        wins: 5,
        games: 10,
        region: 'US-E',
        globalRank: null,
        regionRank: null,
      },
      rankedLegends: withDetails
        ? [
            {
              legendId: 3,
              legendNameKey: 'bodvar',
              rating: 1_600,
              peakRating: 1_650,
              tier: 'Gold 4',
              wins: 5,
              games: 10,
            },
          ]
        : [],
      mainLegend: null,
      fixedTeams: [],
      soloQueue: [],
      ratingHistory: withDetails
        ? [
            {
              rating: 1_600,
              peakRating: 1_650,
              tier: 'Gold 4',
              wins: 5,
              games: 10,
              recordedAt: '2026-08-10T10:00:00Z',
            },
            {
              rating: 1_550,
              peakRating: 1_600,
              tier: 'Gold 3',
              wins: 4,
              games: 8,
              recordedAt: '2026-08-09T10:00:00Z',
            },
          ]
        : [],
      observedRatingDirection: withDetails
        ? {
            direction: 'up',
            ratingChange: 50,
            observationCount: 2,
            fromObservedAt: '2026-08-09T10:00:00Z',
            toObservedAt: '2026-08-10T10:00:00Z',
          }
        : null,
    },
  }
}

describe('ProfileSections', () => {
  test('keeps explicit Current Season and Career hierarchy while omitting unsupported deep sections', () => {
    const html = renderToStaticMarkup(
      <ProfileSections
        identity={{ brawlhallaId: 42, name: 'Canonical Player' }}
        currentSeason={rankedProfile(false)}
        career={null}
        rankedTeams={[]}
        careerRefreshing={false}
      />,
    )

    expect(html.indexOf('Current Season')).toBeLessThan(html.indexOf('Career Statistics'))
    expect(html).toContain('Rating history will appear after two complete observations.')
    expect(html).not.toContain('<details')
    expect(html).not.toContain('Competitive Snapshot')
  })

  test('keeps supported rating history in the primary scan path', () => {
    const html = renderToStaticMarkup(
      <ProfileSections
        identity={{ brawlhallaId: 42, name: 'Canonical Player' }}
        currentSeason={rankedProfile(true)}
        career={null}
        rankedTeams={[]}
        careerRefreshing={false}
      />,
    )

    expect(html).toContain('<section id="current-season" aria-labelledby="current-season-heading"')
    expect(html).not.toContain('<details')
    expect(html).not.toContain('<summary')
    expect(html).toContain('Ranked Legends')
    expect(html).toContain('/images/legends/avatars/bodvar.png')
    expect(html).toContain('Rating History')
  })
})
