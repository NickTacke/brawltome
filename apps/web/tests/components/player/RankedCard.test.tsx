import { describe, expect, test } from 'bun:test'
import type { PlayerRankedProfileContract } from '@brawltome/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { RankedCard } from '../../../src/components/player/RankedCard'

const currentSeason: PlayerRankedProfileContract = {
  brawlhallaId: 42,
  checkedAt: '2026-08-10T10:30:00Z',
  lastSuccessAt: '2026-08-10T10:00:00Z',
  freshness: 'fresh',
  freshForSeconds: 3_600,
  sparsePulse: {
    checkedAt: '2026-08-10T10:20:00Z',
    lastSuccessAt: '2026-08-10T10:20:00Z',
  },
  snapshot: {
    oneVsOne: {
      rating: 0,
      peakRating: 782,
      tier: 'Tin 0',
      wins: 0,
      games: 0,
      region: 'US-E',
      globalRank: null,
      regionRank: null,
    },
    rankedLegends: [],
    mainLegend: { legendId: 3, legendNameKey: 'bodvar', source: 'career' },
    fixedTeams: [],
    soloQueue: [],
    ratingHistory: [
      {
        rating: 0,
        peakRating: 782,
        tier: 'Tin 0',
        wins: 0,
        games: 0,
        recordedAt: '2026-08-10T10:00:00Z',
      },
      {
        rating: 50,
        peakRating: 782,
        tier: 'Tin 0',
        wins: 0,
        games: 0,
        recordedAt: '2026-08-10T09:00:00Z',
      },
    ],
    observedRatingDirection: {
      direction: 'down',
      ratingChange: -50,
      observationCount: 2,
      fromObservedAt: '2026-08-10T09:00:00Z',
      toObservedAt: '2026-08-10T10:00:00Z',
    },
  },
}

describe('RankedCard', () => {
  test('renders a coverage-qualified competitive summary without inventing zero-denominator rates', () => {
    const html = renderToStaticMarkup(<RankedCard currentSeason={currentSeason} />)

    expect(html).toContain('Competitive Snapshot')
    expect(html).toContain('aria-label="Current and peak rating"')
    expect(html).toContain('>0</span>')
    expect(html).toContain('Win rate unavailable until at least one game is observed')
    expect(html).not.toContain('Current rating</dt>')
    expect(html).not.toContain('Win rate</dt>')
    expect(html).not.toContain('tabindex="0"')
    expect(html).not.toContain('0.00%')
    expect(html).toContain('BrawlTome-observed direction')
    expect(html).toContain('Down 50 rating')
    expect(html).toContain('up to 365 retained BrawlTome complete-ranked observations')
    expect(html).toContain('Sparse pulse overlays are excluded')
    expect(html).toContain('at least one supported 1v1 or fixed-team scalar')
    expect(html).toContain('Career-derived main legend')
    expect(html).not.toContain('Total Glory')
    expect(html).not.toContain('Elo Reset')
    for (const unsupportedClaim of ['should', 'improve', 'because', 'caused']) {
      expect(html.toLowerCase()).not.toContain(unsupportedClaim)
    }
  })

  test('omits unavailable competitive facts after one concise explanation', () => {
    const unavailable: PlayerRankedProfileContract = {
      ...currentSeason,
      lastSuccessAt: null,
      freshness: 'unavailable',
      sparsePulse: null,
      snapshot: null,
    }
    const html = renderToStaticMarkup(<RankedCard currentSeason={unavailable} />)

    expect(html).toContain('Competitive Snapshot')
    expect(html).toContain('Complete Current Season ranked facts have not been successfully observed')
    expect(html).toContain('omitted rather than shown as zero')
    expect(html).not.toContain('Current rating</dt>')
    expect(html).not.toContain('Win rate</dt>')
  })
})
