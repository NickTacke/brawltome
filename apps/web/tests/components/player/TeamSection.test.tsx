import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TeamSection } from '../../../src/components/player/TeamSection'

describe('TeamSection', () => {
  test('keeps measured zero outcomes but renders zero-denominator rates as unavailable', () => {
    const html = renderToStaticMarkup(
      <TeamSection
        player={{ name: 'Canonical Player', rankedLastUpdated: '2026-08-10T10:00:00Z' }}
        brawlhallaId={42}
        rankedTeams={[
          {
            brawlhallaIdOne: 42,
            brawlhallaIdTwo: 43,
            teamName: 'Canonical Player + Partner',
            rating: 1_400,
            peakRating: 1_450,
            tier: 'Silver 4',
            wins: 0,
            games: 0,
            region: 'US-E',
            globalRank: null,
          },
        ]}
      />,
    )

    const visibleText = html.replace(/<[^>]+>/g, '')
    expect(html).toContain('<h3')
    expect(html).toContain('<h4')
    expect(html).toContain('Ranked 2v2')
    expect(visibleText).toContain('0/ 0')
    expect(html.match(/Unavailable/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).not.toContain('0.0%')
    expect(html).not.toContain('role="progressbar"')
  })
})
