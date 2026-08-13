import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RatingChart } from '../../../src/components/player/RatingChart'
import { ChartTooltip } from '../../../src/components/player/RatingChart/ChartTooltip'

describe('RatingChart', () => {
  test('provides an accessible observation list and pressed-state season controls', () => {
    const html = renderToStaticMarkup(
      <RatingChart
        data={[
          {
            rating: 1_600,
            peakRating: 1_650,
            tier: 'Gold 4',
            wins: 5,
            games: 10,
            recordedAt: '2026-04-01T10:00:00Z',
          },
          {
            rating: 1_550,
            peakRating: 1_600,
            tier: 'Gold 3',
            wins: 0,
            games: 0,
            recordedAt: '2026-03-20T10:00:00Z',
          },
        ]}
      />,
    )

    expect(html).toContain('<figure aria-labelledby="rating-history-heading"')
    expect(html).toContain('id="rating-history-heading"')
    expect(html).not.toContain('rating-history-coverage')
    expect(html).not.toContain('<figcaption')
    expect(html).not.toContain('canonical V0 snapshots')
    expect(html).not.toContain('legacy V2 history')
    expect(html).toContain('<ol class="sr-only">')
    expect(html).toContain('Rating 1550, peak 1600, win rate unavailable')
    expect(html).toContain('Rating 1600, peak 1650, 5 wins in 10 games')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-pressed="false"')
    expect(html.toLowerCase()).not.toContain('live rating')
    expect(html.toLowerCase()).not.toContain('complete elo history')
  })

  test('does not render a zero win rate for an observation with no games', () => {
    const html = renderToStaticMarkup(
      <ChartTooltip
        active
        payload={
          [
            {
              payload: {
                rating: 1_550,
                peakRating: 1_600,
                tier: 'Gold 3',
                wins: 0,
                games: 0,
                recordedAt: '2026-03-20T10:00:00Z',
                date: 'Mar 20, 2026',
                timestamp: 1,
              },
            },
          ] as never
        }
      />,
    )

    expect(html).toContain('Win rate unavailable')
    expect(html).not.toContain('0.0%')
  })
})
